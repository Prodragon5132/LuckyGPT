import "server-only";
import type { Canvas, Gpt, Memory, Personality, Project, ToolToggles, UserPrefs } from "@/lib/shared/types";

const PERSONALITIES: Record<Personality, string> = {
  default: "",
  cynic:
    "Personality: Cynic. Be critical and sarcastic, with dry wit, while still being genuinely helpful and accurate.",
  robot: "Personality: Robot. Be efficient and blunt. No small talk, no filler, no emotional language. Just the answer.",
  listener:
    "Personality: Listener. Be warm, thoughtful and supportive. Reflect back what you hear, ask gentle follow-up questions, and never lecture.",
  nerd:
    "Personality: Nerd. Be exploratory and enthusiastic. Share fun facts and deeper context when it adds to the answer.",
};

export function buildSystemPrompt(opts: {
  modelName: string;
  userName: string;
  prefs: UserPrefs;
  memories: Memory[];
  memoryEnabled: boolean;
  hasChatSearch?: boolean;
  project: Project | null;
  projectFiles: { name: string; text: string }[];
  gpt: Gpt | null;
  gptFiles: { name: string; text: string }[];
  tools: ToolToggles;
  hasImageTool: boolean;
  hasSearch: boolean;
  hasCanvas: boolean;
  canvas: Canvas | null;
  voice: boolean;
  timezone: string;
}): string {
  const now = new Date();
  let dateText: string;
  try {
    dateText = now.toLocaleString("en-US", {
      timeZone: opts.timezone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    dateText = now.toUTCString();
  }

  const parts: string[] = [];

  if (opts.gpt) {
    parts.push(
      `You are "${opts.gpt.name}", a custom GPT. ${opts.gpt.description ? `Description: ${opts.gpt.description}` : ""}`.trim(),
      `Instructions from the GPT's creator:\n${opts.gpt.instructions || "(none)"}`,
    );
  } else {
    parts.push(
      `You are LuckyGPT, a helpful, friendly and knowledgeable AI assistant (powered by ${opts.modelName}). ` +
        `Be genuinely useful: answer directly, match the user's tone and level of detail, and ask a clarifying question only when you truly need one.`,
    );
  }

  parts.push(`Current date and time: ${dateText} (${opts.timezone}).`);

  if (!opts.voice) {
    parts.push(
      "Formatting: use Markdown when it helps readability (headings, lists, tables, **bold**). Use fenced code blocks with a language tag for code. " +
        "Write math with LaTeX: $inline$ and $$display$$. Keep short answers short.",
    );
  }

  const personality = PERSONALITIES[opts.prefs.personality] ?? "";
  if (personality) parts.push(personality);

  const ci = opts.prefs.customInstructions;
  if (ci.enabled && (ci.nickname || ci.occupation || ci.traits || ci.about)) {
    const lines: string[] = [];
    if (ci.nickname) lines.push(`- Preferred name: ${ci.nickname}`);
    if (ci.occupation) lines.push(`- Occupation: ${ci.occupation}`);
    if (ci.about) lines.push(`- More about the user: ${ci.about}`);
    const about = lines.length ? `What the user wants you to know about them:\n${lines.join("\n")}` : "";
    const traits = ci.traits ? `How the user wants you to respond:\n${ci.traits}` : "";
    parts.push(
      [
        "The user set these custom instructions. Follow them unless they conflict with safety. Don't mention them unless relevant.",
        about,
        traits,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } else if (opts.userName) {
    parts.push(`The user's name is ${opts.userName}.`);
  }

  if (opts.memoryEnabled) {
    const mem = opts.memories.length
      ? opts.memories.map((m) => `- [${m.id.slice(0, 8)}] ${m.content}`).join("\n")
      : "(no saved memories yet)";
    parts.push(
      `Saved memories about the user (from earlier chats):\n${mem}\n\n` +
        "Use memories naturally when relevant, without saying \"according to my memory\". " +
        "When the user shares a lasting, useful fact or preference (name, family, job, goals, projects, likes/dislikes), or explicitly asks you to remember something, call save_memory with one short sentence. " +
        "If they ask you to forget something, call forget_memory with the id in brackets. Don't save trivial, temporary, or highly sensitive details (health, finances, passwords) unless asked.",
    );
  }

  if (opts.hasChatSearch) {
    parts.push(
      "You can search the user's past conversations with search_chats. Use it when they ask about something from an earlier chat " +
        "(\"what did we talk about…\", \"find the recipe you gave me\", \"what was that name I mentioned?\"), or when earlier context " +
        "would clearly help and it isn't in your saved memories. Search with a few specific keywords; try different words if nothing comes up. " +
        "Mention naturally that you found it in a past chat. Don't search for every message.",
    );
  }

  if (opts.project) {
    parts.push(
      `This chat is inside the user's project "${opts.project.name}".` +
        (opts.project.instructions ? `\nProject instructions:\n${opts.project.instructions}` : ""),
    );
  }
  const knowledge = [...opts.projectFiles, ...opts.gptFiles].filter((f) => f.text);
  if (knowledge.length) {
    let budget = 150_000;
    const docs: string[] = [];
    for (const f of knowledge) {
      if (budget <= 0) break;
      const text = f.text.slice(0, budget);
      budget -= text.length;
      docs.push(`<file name="${f.name.replace(/"/g, "'")}">\n${text}\n</file>`);
    }
    parts.push(`Reference files (use them when relevant):\n${docs.join("\n")}`);
  }

  if (opts.hasSearch) {
    parts.push(
      opts.tools.search || opts.tools.research
        ? "The user turned on web search: search the web before answering, and cite sources."
        : "You can search the web. Do it when the question needs current or niche information (news, prices, weather, sports, recent events), otherwise answer directly.",
    );
  }

  if (opts.hasImageTool) {
    parts.push(
      opts.tools.image
        ? "The user chose \"Create image\": call generate_image with a detailed prompt based on their request. After it finishes, reply with at most one short sentence — the image is already shown to the user."
        : "You can create images with generate_image when the user asks for a picture, drawing, logo, photo or illustration. Set use_uploaded_images to true to edit or build on images the user attached. After it finishes, reply with at most one short sentence — the image is already shown.",
    );
  }

  if (opts.hasCanvas) {
    parts.push(
      "Canvas is open: for writing or code the user wants to work on (documents, essays, emails, programs), call canvas_write with the COMPLETE content (not a diff). " +
        "After writing, reply with one or two sentences summarizing what you did. For quick questions, just answer normally.",
    );
    if (opts.canvas) {
      parts.push(
        `Current canvas "${opts.canvas.title}" (${opts.canvas.kind}${opts.canvas.language ? `, ${opts.canvas.language}` : ""}):\n<canvas>\n${opts.canvas.content.slice(0, 100_000)}\n</canvas>\nWhen the user asks for changes, call canvas_write with the full updated content.`,
      );
    }
  }

  if (opts.tools.study) {
    parts.push(
      "Study mode is on. Act as a patient tutor: don't just give the final answer. Find out what the user already knows, guide them step by step with questions and hints, " +
        "check understanding with short quizzes, and adapt to their level. Keep each turn short and interactive.",
    );
  }

  if (opts.tools.research) {
    parts.push(
      "Deep research mode is on. Plan the research, run several web searches from different angles, compare sources, and then write a thorough, well-structured report " +
        "with headings, key findings, nuances/disagreements between sources, and a short summary at the top. Cite sources inline.",
    );
  }

  if (opts.voice) {
    parts.push(
      "You are in voice mode: the user is talking to you and will hear your reply read aloud. Talk like a friendly person on a phone call. " +
        "Keep replies short (usually 1–3 sentences), use plain spoken language, and never use markdown, bullet points, tables, code blocks, emojis, or URLs. " +
        "Spell out symbols and numbers naturally.",
    );
  }

  return parts.join("\n\n");
}
