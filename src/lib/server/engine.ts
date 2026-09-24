import "server-only";
import {
  APICallError,
  generateImage,
  generateText,
  isStepCount,
  streamText,
  tool,
  type ModelMessage,
  type ToolSet,
  type UserContent,
} from "ai";
import { z } from "zod";
import { getConfig, getSecrets, type AppConfig, type ModelConfig, type ProviderSecrets } from "./settings";
import {
  canMixSearchAndFunctions,
  imageModel,
  languageModel,
  providerOptionsFor,
  resolveModel,
  resolveTaskModel,
  resolveVisionHelper,
  voiceErrorMessage,
  webSearchTools,
} from "./providers";
import { buildSystemPrompt } from "./prompt";
import {
  createChat,
  getBranch,
  getChatRow,
  insertMessage,
  updateChat,
  updateMessageBody,
} from "./repo/chats";
import { attachFileToChat, classify, getFileData, getFileInfo, listFiles, saveFile, setFileText } from "./repo/files";
import { addMemory, deleteMemory, getGpt, getProject, listMemories } from "./repo/misc";
import { loadUserInfo, type SessionUser } from "./auth";
import { HttpError, badRequest } from "./http";
import { newId } from "./crypto";
import { OPENROUTER_USAGE_KEY, recordHit } from "./ratelimit";
import type {
  Activity,
  Attachment,
  Canvas,
  ChatMessage,
  Gpt,
  MessageBody,
  MessageStatus,
  Project,
  Source,
  StreamEvent,
  ToolToggles,
} from "@/lib/shared/types";

export const chatRequestSchema = z.object({
  chatId: z.string().uuid().nullish(),
  parentId: z.string().uuid().nullish(),
  content: z.string().max(200_000).nullish(),
  attachments: z.array(z.string().uuid()).max(20).optional(),
  modelId: z.string().max(100).nullish(),
  tools: z
    .object({
      search: z.boolean().optional(),
      image: z.boolean().optional(),
      think: z.boolean().optional(),
      research: z.boolean().optional(),
      study: z.boolean().optional(),
      canvas: z.boolean().optional(),
    })
    .optional(),
  temporary: z.boolean().optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(200_000),
        attachments: z.array(z.string().uuid()).max(20).optional(),
      }),
    )
    .max(200)
    .optional(),
  projectId: z.string().uuid().nullish(),
  gptId: z.string().uuid().nullish(),
  voice: z.boolean().optional(),
  timezone: z.string().max(64).optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

interface HistoryItem {
  role: "user" | "assistant";
  text: string;
  attachments: Attachment[];
  images?: Attachment[];
  canvas?: Canvas;
}

const MAX_ATTEMPTS = 3;

/**
 * Something a tool already did during this reply (saved a memory, made an image, wrote the canvas).
 * If the reply is retried, these are kept and shown again, never repeated, and the model is told
 * they're done so it just answers.
 */
interface DoneAction {
  kind: "memory" | "image" | "canvas";
  note: string;
  activity?: Activity;
  image?: Attachment;
  canvas?: Canvas;
}

/** What to say if the model did the action but then wrote nothing, even after retries. */
function doneFallbackText(done: DoneAction[]): string {
  if (done.some((d) => d.kind === "image")) return "Here's your image.";
  if (done.some((d) => d.kind === "canvas")) return "I've updated the canvas.";
  return "Got it — I'll remember that.";
}

class EmptyReplyError extends Error {
  constructor() {
    super("empty response");
  }
}

/** Retry anything except problems another try can't fix (bad key, no credits, unknown model, our own checks). */
function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return false;
  if (APICallError.isInstance(err)) {
    const s = err.statusCode;
    return !(s === 401 || s === 402 || s === 403 || s === 404 || s === 413);
  }
  return true;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });
}

function friendlyError(err: unknown, cfg: ModelConfig | null): string {
  const who = cfg ? `${cfg.name}` : "The model";
  if (err instanceof HttpError) return err.message;
  if (err instanceof EmptyReplyError) return `${who} returned an empty response. Try again or pick another model.`;
  if (APICallError.isInstance(err)) {
    const status = err.statusCode;
    if (status === 401 || status === 403)
      return `${who}: the API key was rejected (${status}). An admin should check Settings → API keys.`;
    if (status === 402) return `${who}: the account is out of credits or billing isn't set up.`;
    if (status === 404) return `${who}: this model ID wasn't found. An admin can fix it in Settings → Models.`;
    if (status === 429) return `${who} is rate limited or out of quota right now. Try again in a moment or pick another model.`;
    if (status && status >= 500) return `${who} is having trouble right now (tried ${MAX_ATTEMPTS} times). Try again in a moment or pick another model.`;
    const detail = (err.message || "").slice(0, 300);
    return `${who} returned an error${status ? ` (${status})` : ""}: ${detail}`;
  }
  // Mid-stream provider errors ("Upstream error…", overloads) after all retries.
  return `${who} is having trouble right now (tried ${MAX_ATTEMPTS} times). Try again in a moment or pick another model.`;
}

async function loadAttachments(userId: string, ids: string[] | undefined): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const id of ids ?? []) {
    const info = await getFileInfo(userId, id); // throws if not the user's file
    out.push({ id: info.id, name: info.name, mime: info.mime, size: info.size });
  }
  return out;
}

const RICH_WINDOW = 6; // only the latest user turns carry full images/PDFs (keeps cost down)

/** Describes an image for a chat model that can't see. Returns "" if the helper fails. */
type DescribeImage = (file: { id: string; name: string; mime: string; data: Buffer }, question: string) => Promise<string>;

const DESCRIBE_PROMPT = `Describe this image in detail for an AI assistant that can't see it, so it can answer questions about it.
Include: what it shows, people/objects and their positions, colors, setting, any charts/diagrams (with their values),
and transcribe ALL visible text exactly (keep line breaks for documents, code and tables). Be factual; don't guess identities.`;

function makeDescriber(ctx: {
  userId: string;
  helper: ModelConfig;
  secrets: ProviderSecrets;
  send: (e: StreamEvent) => void;
  body: MessageBody;
  signal: AbortSignal;
}): DescribeImage {
  return async (file, question) => {
    const activity: Activity = { id: `vision-${file.id}`, kind: "image", label: "Looking at image", status: "running" };
    const show = (a: Activity) => {
      ctx.body.activity = [...(ctx.body.activity ?? []).filter((x) => x.id !== a.id), a];
      ctx.send({ type: "activity", activity: a });
    };
    show(activity);
    try {
      const { text } = await generateText({
        model: languageModel(ctx.helper, ctx.secrets),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: question ? `${DESCRIBE_PROMPT}\n\nThe user's message (focus on what's relevant to it): ${question.slice(0, 1000)}` : DESCRIBE_PROMPT },
              { type: "image", image: file.data, mediaType: file.mime },
            ],
          },
        ],
        maxOutputTokens: 1500,
        providerOptions: providerOptionsFor(ctx.helper, "auto", ctx.userId) as never,
        abortSignal: ctx.signal,
        maxRetries: 2, // 3 attempts
      });
      const desc = text.trim();
      if (desc) await setFileText(ctx.userId, file.id, desc).catch(() => {});
      show({ ...activity, label: "Looked at image", status: "done" });
      return desc;
    } catch (err) {
      if (!ctx.signal.aborted) console.warn("[chat] image helper failed", err);
      show({ ...activity, label: voiceErrorMessage(err, `Couldn't read image with ${ctx.helper.modelId}`).slice(0, 160), status: "error" });
      return "";
    }
  };
}

async function toModelMessages(
  userId: string,
  history: HistoryItem[],
  cfg: ModelConfig,
  describe?: DescribeImage,
): Promise<ModelMessage[]> {
  const msgs: ModelMessage[] = [];
  const userTurns = history.filter((h) => h.role === "user").length;
  let userIndex = 0;
  for (const item of history) {
    if (item.role === "assistant") {
      let text = item.text || "";
      if (item.images?.length) text += `\n\n[${item.images.length} image(s) were generated and shown to the user here.]`;
      if (item.canvas) text += `\n\n[Canvas "${item.canvas.title}" was updated.]`;
      msgs.push({ role: "assistant", content: text.trim() || "(no response)" });
      continue;
    }
    userIndex++;
    const rich = userTurns - userIndex < RICH_WINDOW;
    const content: Exclude<UserContent, string> = [];
    for (const att of item.attachments) {
      let file;
      try {
        file = await getFileData(userId, att.id);
      } catch {
        content.push({ type: "text", text: `[Attachment "${att.name}" is no longer available.]` });
        continue;
      }
      const kind = classify(file.info.name, file.info.mime);
      if (kind === "image") {
        if (cfg.capabilities.vision && rich) {
          content.push({ type: "image", image: file.data, mediaType: file.info.mime });
        } else if (!cfg.capabilities.vision && describe && (rich || file.text)) {
          // This model can't see: the image helper describes it (once; the description is saved with the file).
          const desc = file.text || (await describe({ id: file.info.id, name: file.info.name, mime: file.info.mime, data: file.data }, item.text));
          content.push({
            type: "text",
            text: desc
              ? `[Image "${file.info.name}", described for you by an image-understanding model because you can't see images directly. Answer naturally as if you can see it:\n${desc}\n]`
              : `[The user attached an image "${file.info.name}", but it couldn't be read right now. Say so if they ask about it.]`,
          });
        } else {
          content.push({
            type: "text",
            text: cfg.capabilities.vision
              ? `[Earlier image "${file.info.name}" omitted.]`
              : `[The user attached an image "${file.info.name}", but this model can't see images and no image-understanding model is set up. Tell them to pick a model that supports images, or ask an admin to choose one under Settings → Models → Image understanding.]`,
          });
        }
      } else if (kind === "pdf" && cfg.capabilities.pdf && rich) {
        content.push({ type: "file", data: file.data, mediaType: "application/pdf", filename: file.info.name });
      } else {
        const text = file.text || "(no readable text found in this file)";
        content.push({ type: "text", text: `<file name="${file.info.name.replace(/"/g, "'")}">\n${text}\n</file>` });
      }
    }
    content.push({ type: "text", text: item.text || (item.attachments.length ? "(see attached)" : "…") });
    msgs.push({ role: "user", content });
  }
  return msgs;
}

function sizeFor(aspect: string): `${number}x${number}` {
  switch (aspect) {
    case "16:9":
    case "3:2":
      return "1536x1024";
    case "9:16":
    case "2:3":
      return "1024x1536";
    default:
      return "1024x1024";
  }
}

export async function runChat(user: SessionUser, req: ChatRequest, signal: AbortSignal): Promise<Response> {
  const [config, secrets, userInfo] = await Promise.all([getConfig(), getSecrets(), loadUserInfo(user.id)]);
  if (!userInfo) throw new HttpError(401, "Please log in again.");
  const prefs = userInfo.prefs;
  const toolsOn: ToolToggles = req.voice ? {} : { ...(req.tools ?? {}) };
  const temporary = !!req.temporary;

  // ----- Resolve chat context (project / GPT) -----
  let chatId: string | null = req.chatId ?? null;
  let project: Project | null = null;
  let gpt: Gpt | null = null;
  let chatTitleMissing = false;

  if (!temporary && chatId) {
    const row = await getChatRow(user.id, chatId);
    chatTitleMissing = !row.title;
    if (row.project_id) project = await getProject(user.id, row.project_id).catch(() => null);
    if (row.gpt_id) gpt = await getGpt(user.id, row.gpt_id).catch(() => null);
  } else {
    if (req.projectId) project = await getProject(user.id, req.projectId);
    if (req.gptId) gpt = await getGpt(user.id, req.gptId);
  }

  // ----- Pick the model -----
  let requestedModel = req.modelId ?? prefs.defaultModel;
  if (req.voice && config.voice.chatModel) requestedModel = config.voice.chatModel;
  if (gpt?.modelId && !req.modelId) requestedModel = gpt.modelId;
  const cfg = resolveModel(config, secrets, requestedModel);
  if (cfg.provider === "openrouter") await recordHit(OPENROUTER_USAGE_KEY).catch(() => {});

  if (gpt && !gpt.capabilities.search) toolsOn.search = false;
  if (gpt && !gpt.capabilities.image) toolsOn.image = false;

  // ----- Persist the user's message + assistant placeholder -----
  const newAttachments = await loadAttachments(user.id, req.attachments);
  let history: HistoryItem[] = [];
  let userMessage: ChatMessage | null = null;
  let assistant: ChatMessage;
  let parentForAssistant: string | null;

  if (temporary) {
    for (const h of req.history ?? []) {
      history.push({ role: h.role, text: h.text, attachments: await loadAttachments(user.id, h.attachments) });
    }
    if (req.content != null) {
      history.push({ role: "user", text: req.content, attachments: newAttachments });
    }
    if (!history.length || history[history.length - 1].role !== "user") throw badRequest("Nothing to respond to.");
    const now = Date.now();
    userMessage =
      req.content != null
        ? {
            id: newId(),
            parentId: req.parentId ?? null,
            role: "user",
            text: req.content,
            attachments: newAttachments,
            status: "done",
            createdAt: now,
          }
        : null;
    assistant = {
      id: newId(),
      parentId: userMessage?.id ?? req.parentId ?? null,
      role: "assistant",
      text: "",
      status: "streaming",
      model: cfg.id,
      modelName: cfg.name,
      createdAt: now,
    };
    chatId = "temporary";
    parentForAssistant = assistant.parentId;
  } else {
    if (!chatId) {
      chatId = await createChat(user.id, { projectId: project?.id ?? null, gptId: gpt?.id ?? null });
      chatTitleMissing = true;
    }
    if (req.content != null) {
      if (req.parentId) {
        const branch = await getBranch(chatId, req.parentId);
        if (!branch.length) throw badRequest("That message no longer exists.");
      }
      userMessage = await insertMessage({
        chatId,
        parentId: req.parentId ?? null,
        role: "user",
        body: { text: req.content, attachments: newAttachments, voice: req.voice || undefined, tools: req.tools },
      });
      for (const a of newAttachments) await attachFileToChat(user.id, a.id, chatId);
      parentForAssistant = userMessage.id;
    } else {
      if (!req.parentId) throw badRequest("Missing message to regenerate.");
      parentForAssistant = req.parentId;
    }
    const branch = await getBranch(chatId, parentForAssistant);
    if (!branch.length || branch[branch.length - 1].role !== "user") throw badRequest("Can't respond to that message.");
    history = branch.map((m) => ({
      role: m.role,
      text: m.text,
      attachments: m.attachments ?? [],
      images: m.images,
      canvas: m.canvas,
    }));
    assistant = await insertMessage({
      chatId,
      parentId: parentForAssistant,
      role: "assistant",
      body: { text: "", voice: req.voice || undefined },
      model: cfg.id,
      modelName: cfg.name,
      status: "streaming",
    });
  }

  const finalChatId = chatId;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (e: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          closed = true;
        }
      };

      send({ type: "meta", chatId: finalChatId, userMessage, assistantMessage: assistant });

      const body: MessageBody = { text: "", voice: req.voice || undefined };
      let status: MessageStatus = "done";
      const persist = async (final: boolean) => {
        if (temporary) return;
        try {
          await updateMessageBody(finalChatId, assistant.id, body, final ? status : "streaming", cfg.name);
        } catch (err) {
          console.error("[chat] failed to save message", err);
        }
      };

      try {
        // Provider hiccups ("upstream" errors, overloads, empty replies) are retried quietly:
        // up to 3 attempts before the person sees an error.
        const done: DoneAction[] = [];
        for (let attempt = 1; ; attempt++) {
          try {
            await generate({
              user,
              config,
              secrets,
              cfg,
              prefs: userInfo.prefs,
              userName: userInfo.name,
              project,
              gpt,
              history,
              toolsOn,
              temporary,
              voice: !!req.voice,
              timezone: req.timezone || "UTC",
              chatId: temporary ? null : finalChatId,
              body,
              send,
              persist,
              signal,
              done,
            });
            if (!signal.aborted && !body.text.trim()) {
              if (done.length && attempt >= MAX_ATTEMPTS - 1) {
                // It did what was asked (e.g. saved the memory) but wrote nothing: confirm instead of erroring.
                body.text = doneFallbackText(done);
                send({ type: "text", delta: body.text });
              } else if (!body.images?.length && !body.canvas) throw new EmptyReplyError();
            }
            break;
          } catch (err) {
            if (signal.aborted) throw err;
            if (attempt >= MAX_ATTEMPTS || !isRetryable(err)) {
              // The action worked even though the model's follow-up failed: don't call the whole reply a failure.
              if (done.length && !body.text.trim()) {
                console.warn("[chat] reply failed after tools ran; confirming instead:", err instanceof Error ? err.message : err);
                body.text = doneFallbackText(done);
                send({ type: "text", delta: body.text });
                break;
              }
              throw err;
            }
            console.warn(`[chat] attempt ${attempt} failed, retrying:`, err instanceof Error ? err.message : err);
            for (const key of Object.keys(body) as (keyof MessageBody)[]) if (key !== "voice") delete body[key];
            body.text = "";
            send({ type: "reset" });
            // Keep what already worked on screen.
            for (const d of done) {
              if (d.activity) {
                body.activity = [...(body.activity ?? []), d.activity];
                send({ type: "activity", activity: d.activity });
              }
              if (d.image) {
                body.images = [...(body.images ?? []), d.image];
                send({ type: "image", image: d.image });
              }
              if (d.canvas) {
                body.canvas = d.canvas;
                send({ type: "canvas", canvas: d.canvas });
              }
            }
            await sleep(attempt * 800, signal);
          }
        }
        if (signal.aborted) status = "stopped";
      } catch (err) {
        if (signal.aborted) {
          status = "stopped";
        } else {
          console.error("[chat] generation error", err);
          status = "error";
          body.error = friendlyError(err, cfg);
          send({ type: "error", message: body.error });
        }
      }

      if (!body.text && !body.images?.length && !body.canvas && status === "done") {
        status = "error";
        body.error = body.error || `${cfg.name} returned an empty response. Try again or pick another model.`;
        send({ type: "error", message: body.error });
      }

      await persist(true);
      send({ type: "done", status });

      // Name the chat after the first exchange (like ChatGPT does).
      if (!temporary && chatTitleMissing && !signal.aborted && body.text) {
        try {
          const title = await makeTitle(config, secrets, cfg, history, body.text);
          if (title) {
            await updateChat(user.id, finalChatId, { title });
            send({ type: "title", chatId: finalChatId, title });
          }
        } catch (err) {
          console.warn("[chat] title generation failed", (err as Error).message);
        }
      }

      closed = true;
      try {
        controller.close();
      } catch {
        /* client went away */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

async function generate(ctx: {
  user: SessionUser;
  config: AppConfig;
  secrets: ProviderSecrets;
  cfg: ModelConfig;
  prefs: import("@/lib/shared/types").UserPrefs;
  userName: string;
  project: Project | null;
  gpt: Gpt | null;
  history: HistoryItem[];
  toolsOn: ToolToggles;
  temporary: boolean;
  voice: boolean;
  timezone: string;
  chatId: string | null;
  body: MessageBody;
  send: (e: StreamEvent) => void;
  persist: (final: boolean) => Promise<void>;
  signal: AbortSignal;
  done: DoneAction[];
}) {
  const { user, config, secrets, cfg, toolsOn, body, send, signal, done } = ctx;
  const didAlready = (kind: DoneAction["kind"]) => done.some((d) => d.kind === kind);
  const showActivity = (a: Activity) => {
    body.activity = [...(body.activity ?? []), a];
    send({ type: "activity", activity: a });
    return a;
  };

  const memoryEnabled = ctx.prefs.memoryEnabled && !ctx.temporary && !ctx.gpt && cfg.capabilities.tools;
  const memories = ctx.prefs.memoryEnabled && !ctx.temporary ? await listMemories(user.id) : [];

  const imgModel = imageModel(config, secrets);
  const lastUserImages = [...ctx.history].reverse().find((h) => h.role === "user")?.attachments.filter((a) => a.mime.startsWith("image/")) ?? [];

  // Fallback: "Create image" with a model that can't call tools → generate directly.
  if (toolsOn.image && imgModel && !cfg.capabilities.tools && !cfg.capabilities.imageOutput && !didAlready("image")) {
    const prompt = ctx.history[ctx.history.length - 1]?.text || "An image";
    await runImageTool({ ...ctx, imgModel, prompt, aspect: "1:1", useUploaded: lastUserImages.length > 0, lastUserImages });
    body.text = "Here's your image.";
    send({ type: "text", delta: body.text });
    return;
  }

  const currentCanvas = [...ctx.history].reverse().find((h) => h.canvas)?.canvas ?? null;
  // Keep the canvas tool available once a conversation has a canvas, so follow-ups can edit it.
  const canvasOn = (!!toolsOn.canvas || !!currentCanvas) && cfg.capabilities.tools && !ctx.voice;

  const wantSearch = config.webSearch === "auto" || !!toolsOn.search || !!toolsOn.research;
  const searchTools = wantSearch && !ctx.voice ? webSearchTools(cfg, secrets) : {};
  const openRouterSearch = cfg.provider === "openrouter" && cfg.capabilities.webSearch && !!(toolsOn.search || toolsOn.research);
  const hasSearch = Object.keys(searchTools).length > 0 || openRouterSearch;

  const functionTools: ToolSet = {};
  if (cfg.capabilities.tools) {
    if (memoryEnabled && !didAlready("memory")) {
      functionTools.save_memory = tool({
        description: "Save a short, lasting fact or preference about the user to long-term memory.",
        inputSchema: z.object({ memory: z.string().describe("One short sentence, e.g. 'Has a dog named Max.'") }),
        execute: async ({ memory }) => {
          const norm = (t: string) => t.trim().toLowerCase().replace(/[.!\s]+$/, "");
          if (!memories.some((m) => norm(m.content) === norm(memory))) await addMemory(user.id, memory);
          const activity = showActivity({ id: newId(), kind: "memory", label: "Updated saved memory", status: "done" });
          done.push({ kind: "memory", note: `Saved to memory: "${memory.slice(0, 200)}"`, activity });
          return { saved: true, next: "Memory saved. Now reply to the user normally." };
        },
      });
      functionTools.forget_memory = tool({
        description: "Delete a saved memory by its id (the 8 characters in brackets).",
        inputSchema: z.object({ memory_id: z.string() }),
        execute: async ({ memory_id }) => {
          const match = memories.find((m) => m.id.startsWith(memory_id.replace(/[[\]]/g, "").trim()));
          if (!match) return { deleted: false, reason: "not found" };
          await deleteMemory(user.id, match.id);
          const activity = showActivity({ id: newId(), kind: "memory", label: "Updated saved memory", status: "done" });
          done.push({ kind: "memory", note: `Deleted the memory "${match.content.slice(0, 200)}"`, activity });
          return { deleted: true, next: "Memory deleted. Now reply to the user normally." };
        },
      });
    }
    if (imgModel && !ctx.voice && toolsOn.image !== false && !didAlready("image")) {
      functionTools.generate_image = tool({
        description: "Create an image from a text description (or edit the user's uploaded images). The image is shown to the user automatically.",
        inputSchema: z.object({
          prompt: z.string().describe("Detailed description of the image to create"),
          aspect_ratio: z.enum(["1:1", "3:2", "2:3", "16:9", "9:16"]),
          use_uploaded_images: z.boolean().describe("true to edit/transform the images the user attached"),
        }),
        execute: async ({ prompt, aspect_ratio, use_uploaded_images }) => {
          const before = body.images?.length ?? 0;
          await runImageTool({ ...ctx, imgModel, prompt, aspect: aspect_ratio, useUploaded: use_uploaded_images, lastUserImages });
          const image = body.images?.[before];
          const activity = body.activity?.[body.activity.length - 1];
          if (image) done.push({ kind: "image", note: "Created the requested image (it's already shown to the user)", image, activity });
          return { status: "The image was generated and is already displayed to the user. Do not include links or markdown images." };
        },
      });
    }
    if (canvasOn && !didAlready("canvas")) {
      functionTools.canvas_write = tool({
        description: "Write or rewrite the canvas document/code shown next to the chat. Always send the complete content.",
        inputSchema: z.object({
          title: z.string(),
          kind: z.enum(["document", "code"]),
          language: z.string().describe("Programming language for code, or empty string for documents"),
          content: z.string().describe("The full content (Markdown for documents)"),
        }),
        execute: async ({ title, kind, language, content }) => {
          const canvas: Canvas = { id: currentCanvas?.id ?? newId(), title, kind, language: language || undefined, content };
          body.canvas = canvas;
          send({ type: "canvas", canvas });
          done.push({ kind: "canvas", note: `Wrote the canvas "${title.slice(0, 100)}" (already shown to the user)`, canvas });
          return { ok: true };
        },
      });
    }
  }

  let tools: ToolSet = { ...functionTools, ...searchTools };
  if (Object.keys(searchTools).length && Object.keys(functionTools).length && !canMixSearchAndFunctions(cfg)) {
    // Older Gemini models can't combine Google Search with function tools.
    tools = toolsOn.search || toolsOn.research ? searchTools : functionTools;
  }

  let projectFiles: { name: string; text: string }[] = [];
  if (ctx.project) {
    const files = await listFiles(user.id, { projectId: ctx.project.id });
    projectFiles = await Promise.all(
      files.filter((f) => !f.mime.startsWith("image/")).map(async (f) => ({ name: f.name, text: (await getFileData(user.id, f.id)).text })),
    );
  }
  let gptFiles: { name: string; text: string }[] = [];
  if (ctx.gpt) {
    const files = await listFiles(user.id, { gptId: ctx.gpt.id });
    gptFiles = await Promise.all(
      files.filter((f) => !f.mime.startsWith("image/")).map(async (f) => ({ name: f.name, text: (await getFileData(user.id, f.id)).text })),
    );
  }

  const baseSystem = buildSystemPrompt({
    modelName: cfg.name,
    userName: ctx.userName,
    prefs: ctx.prefs,
    memories,
    memoryEnabled,
    project: ctx.project,
    projectFiles,
    gpt: ctx.gpt,
    gptFiles,
    tools: toolsOn,
    hasImageTool: !!tools.generate_image,
    hasSearch,
    hasCanvas: !!tools.canvas_write,
    canvas: currentCanvas,
    voice: ctx.voice,
    timezone: ctx.timezone,
  });
  // Retrying after a tool already worked: say so, so the model just answers instead of redoing it.
  const system = done.length
    ? `${baseSystem}\n\nAlready done during this reply (it worked; don't do it again, just reply to the user):\n${done.map((d) => `- ${d.note}`).join("\n")}`
    : baseSystem;

  const helper = cfg.capabilities.vision ? null : resolveVisionHelper(config, secrets);
  const describe = helper ? makeDescriber({ userId: user.id, helper, secrets, send, body, signal }) : undefined;
  const messages = await toModelMessages(user.id, ctx.history, cfg, describe);
  const think = toolsOn.think || toolsOn.research ? "high" : "auto";

  const result = streamText({
    model: languageModel(cfg, secrets, { webSearch: openRouterSearch }),
    system,
    messages,
    tools: Object.keys(tools).length ? tools : undefined,
    stopWhen: isStepCount(toolsOn.research ? 16 : 6),
    maxOutputTokens: cfg.provider === "custom" ? undefined : toolsOn.research ? Math.max(config.maxOutputTokens, 32000) : config.maxOutputTokens,
    providerOptions: providerOptionsFor(cfg, think, user.id) as never,
    abortSignal: signal,
    maxRetries: 0, // runChat retries the whole reply instead
  });

  const seenSources = new Set<string>();
  const activities = new Map<string, Activity>();
  let reasoningStart = 0;
  let reasoningDone = false;
  let lastSave = Date.now();

  const setActivity = (a: Activity) => {
    activities.set(a.id, a);
    body.activity = [...activities.values()];
    send({ type: "activity", activity: a });
  };

  const finishReasoning = () => {
    if (reasoningStart && !reasoningDone) {
      reasoningDone = true;
      body.reasoningMs = Date.now() - reasoningStart;
      send({ type: "reasoning-done", ms: body.reasoningMs });
    }
  };

  for await (const part of result.stream) {
    switch (part.type) {
      case "reasoning-start":
        if (!reasoningStart) reasoningStart = Date.now();
        break;
      case "reasoning-delta":
        if (!reasoningStart) reasoningStart = Date.now();
        if (part.text) {
          body.reasoning = (body.reasoning ?? "") + part.text;
          send({ type: "reasoning", delta: part.text });
        }
        break;
      case "text-delta":
        if (!part.text) break;
        finishReasoning();
        body.text += part.text;
        send({ type: "text", delta: part.text });
        break;
      case "source":
        if (part.sourceType === "url" && part.url && !seenSources.has(part.url)) {
          seenSources.add(part.url);
          const src: Source = { url: part.url, title: part.title };
          body.sources = [...(body.sources ?? []), src];
          send({ type: "source", source: src });
          if (![...activities.values()].some((a) => a.kind === "search")) {
            setActivity({ id: "search-grounding", kind: "search", label: "Searched the web", status: "done" });
          }
        }
        break;
      case "tool-input-start":
      case "tool-call": {
        const id = part.type === "tool-call" ? part.toolCallId : part.id;
        if (activities.has(id)) break;
        const name = part.toolName;
        if (name === "web_search" || name === "google_search") {
          setActivity({ id, kind: "search", label: "Searching the web", status: "running" });
        } else if (name === "generate_image") {
          setActivity({ id, kind: "image", label: "Creating image", status: "running" });
        } else if (name === "canvas_write") {
          setActivity({ id, kind: "canvas", label: "Writing in canvas", status: "running" });
        }
        break;
      }
      case "tool-result": {
        const a = activities.get(part.toolCallId);
        if (a) {
          const label = a.kind === "search" ? "Searched the web" : a.kind === "image" ? "Created image" : a.kind === "canvas" ? "Updated canvas" : a.label;
          setActivity({ ...a, label, status: "done" });
        }
        break;
      }
      case "tool-error": {
        const a = activities.get(part.toolCallId);
        if (a) setActivity({ ...a, status: "error", label: a.kind === "image" ? "Image creation failed" : "Tool failed" });
        console.warn("[chat] tool error", part.toolName, part.error);
        break;
      }
      case "file":
        if (part.file.mediaType.startsWith("image/")) {
          const saved = await saveFile({
            userId: user.id,
            kind: ctx.temporary ? "temp" : "generated",
            name: `image-${Date.now()}.${part.file.mediaType.split("/")[1] || "png"}`,
            mime: part.file.mediaType,
            data: Buffer.from(part.file.uint8Array),
            chatId: ctx.chatId,
          });
          const att: Attachment = { id: saved.id, name: saved.name, mime: saved.mime, size: saved.size };
          body.images = [...(body.images ?? []), att];
          send({ type: "image", image: att });
        }
        break;
      case "error":
        throw part.error;
      default:
        break;
    }
    if (Date.now() - lastSave > 4000) {
      lastSave = Date.now();
      await ctx.persist(false);
    }
  }
  finishReasoning();
  for (const a of activities.values()) {
    if (a.status === "running") setActivity({ ...a, status: "done", label: a.kind === "search" ? "Searched the web" : a.label });
  }
}

async function runImageTool(ctx: {
  user: SessionUser;
  config: AppConfig;
  imgModel: NonNullable<ReturnType<typeof imageModel>>;
  prompt: string;
  aspect: string;
  useUploaded: boolean;
  lastUserImages: Attachment[];
  temporary: boolean;
  chatId: string | null;
  body: MessageBody;
  send: (e: StreamEvent) => void;
  signal: AbortSignal;
}) {
  const activityId = newId();
  const isGoogle = ctx.config.image.provider === "google";
  ctx.send({ type: "activity", activity: { id: activityId, kind: "image", label: "Creating image", status: "running" } });
  try {
    const images: Buffer[] = [];
    if (ctx.useUploaded) {
      for (const a of ctx.lastUserImages.slice(0, 4)) {
        images.push((await getFileData(ctx.user.id, a.id)).data);
      }
    }
    const { image } = await generateImage({
      model: ctx.imgModel,
      prompt: images.length ? { text: ctx.prompt, images } : ctx.prompt,
      ...(isGoogle || ctx.config.image.provider === "openrouter"
        ? { aspectRatio: ctx.aspect as `${number}:${number}` }
        : { size: sizeFor(ctx.aspect) }),
      abortSignal: ctx.signal,
      maxRetries: 1,
    });
    const saved = await saveFile({
      userId: ctx.user.id,
      kind: ctx.temporary ? "temp" : "generated",
      name: `${ctx.prompt.slice(0, 60).replace(/[^\w\s-]/g, "").trim() || "image"}.${image.mediaType.split("/")[1] || "png"}`,
      mime: image.mediaType,
      data: Buffer.from(image.uint8Array),
      chatId: ctx.chatId,
    });
    const att: Attachment = { id: saved.id, name: saved.name, mime: saved.mime, size: saved.size };
    ctx.body.images = [...(ctx.body.images ?? []), att];
    ctx.send({ type: "image", image: att });
    const done: Activity = { id: activityId, kind: "image", label: "Created image", status: "done" };
    ctx.body.activity = [...(ctx.body.activity ?? []), done];
    ctx.send({ type: "activity", activity: done });
  } catch (err) {
    const failed: Activity = { id: activityId, kind: "image", label: "Image creation failed", status: "error" };
    ctx.body.activity = [...(ctx.body.activity ?? []), failed];
    ctx.send({ type: "activity", activity: failed });
    throw err;
  }
}

async function makeTitle(
  config: AppConfig,
  secrets: ProviderSecrets,
  chatModel: ModelConfig,
  history: HistoryItem[],
  answer: string,
): Promise<string> {
  const taskCfg = resolveTaskModel(config, secrets, chatModel);
  const firstUser = history.find((h) => h.role === "user")?.text ?? "";
  const { text } = await generateText({
    model: languageModel(taskCfg, secrets),
    system:
      "You write very short chat titles. Reply with ONLY the title: 2–6 words, no quotes, no trailing punctuation, same language as the user. Use Title Case for English.",
    prompt: `User: ${firstUser.slice(0, 1500)}\nAssistant: ${answer.slice(0, 600)}\n\nTitle:`,
    maxOutputTokens: taskCfg.provider === "custom" ? undefined : taskCfg.capabilities.reasoning ? 2000 : 40,
    ...(taskCfg.capabilities.reasoning ? { reasoning: "low" as const } : {}),
    providerOptions: taskCfg.provider === "openai" ? { openai: { store: false } } : undefined,
    abortSignal: AbortSignal.timeout(15_000),
    maxRetries: 1,
  });
  return text
    .replace(/^["'\s#*]+|["'\s*.]+$/g, "")
    .split("\n")[0]
    .slice(0, 80);
}
