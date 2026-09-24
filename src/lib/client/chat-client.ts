"use client";

import { api, apiRaw, ApiError } from "./api";
import { isDraftKey, useApp } from "./store";
import { latestLeaf, threadFor } from "./utils";
import type { Attachment, ChatDetail, ChatMessage, StreamEvent, ToolToggles } from "@/lib/shared/types";

export async function loadChat(chatId: string) {
  const { updateSession } = useApp.getState();
  const existing = useApp.getState().sessions[chatId];
  if (existing?.streaming) return;
  updateSession(chatId, () => ({ loading: true, error: null }));
  try {
    const chat = await api<ChatDetail>(`/api/chats/${chatId}`);
    const messages: Record<string, ChatMessage> = {};
    for (const m of chat.messages) messages[m.id] = m;
    const leaf = chat.currentLeaf && messages[chat.currentLeaf] ? chat.currentLeaf : latestLeaf(messages);
    updateSession(chatId, () => ({
      chatId,
      messages,
      currentLeaf: leaf,
      loaded: true,
      loading: false,
      gptId: chat.gptId,
      projectId: chat.projectId,
    }));
    const { chats, upsertChat } = useApp.getState();
    if (!chats.some((c) => c.id === chat.id) && !chat.archived) {
      const { messages: _m, currentLeaf: _c, ...summary } = chat;
      upsertChat(summary);
    }
  } catch (e) {
    updateSession(chatId, () => ({ loading: false, loaded: true, error: (e as Error).message }));
  }
}

export interface SendOptions {
  key: string;
  content: string | null;
  parentId: string | null;
  attachments?: Attachment[];
  tools?: ToolToggles;
  modelId?: string | null;
  projectId?: string | null;
  gptId?: string | null;
  voice?: boolean;
  onEvent?: (e: StreamEvent) => void;
  onChatCreated?: (chatId: string) => void;
}

const rand = () => Math.random().toString(36).slice(2, 10);

export async function sendMessage(opts: SendOptions): Promise<{ key: string; ok: boolean }> {
  const store = useApp.getState();
  let key = opts.key;
  const temporary = key === "temp";
  const session = store.session(key);
  if (session.streaming) return { key, ok: false };

  const now = Date.now();
  const userTmp = opts.content != null ? `tmp-u-${rand()}` : null;
  const asstTmp = `tmp-a-${rand()}`;
  const model = store.models.find((m) => m.id === (opts.modelId ?? store.selectedModel));

  // History for temporary chats (the server doesn't store them).
  const history =
    temporary && opts.parentId
      ? threadFor(session.messages, opts.parentId).map((m) => ({
          role: m.role,
          text: m.text,
          attachments: m.attachments?.map((a) => a.id),
        }))
      : undefined;

  const controller = new AbortController();
  store.updateSession(key, (s) => {
    const messages = { ...s.messages };
    if (userTmp) {
      messages[userTmp] = {
        id: userTmp,
        parentId: opts.parentId,
        role: "user",
        text: opts.content ?? "",
        attachments: opts.attachments,
        tools: opts.tools,
        status: "done",
        createdAt: now,
      };
    }
    messages[asstTmp] = {
      id: asstTmp,
      parentId: userTmp ?? opts.parentId,
      role: "assistant",
      text: "",
      status: "streaming",
      model: model?.id,
      modelName: model?.name,
      createdAt: now + 1,
    };
    return {
      messages,
      currentLeaf: asstTmp,
      streaming: true,
      controller,
      loaded: true,
      projectId: opts.projectId ?? s.projectId,
      gptId: opts.gptId ?? s.gptId,
    };
  });

  let assistantId = asstTmp;
  let pendingText = "";
  let pendingReasoning = "";
  let raf = 0;

  const flush = () => {
    raf = 0;
    if (!pendingText && !pendingReasoning) return;
    const t = pendingText;
    const r = pendingReasoning;
    pendingText = "";
    pendingReasoning = "";
    useApp.getState().updateSession(key, (s) => {
      const m = s.messages[assistantId];
      if (!m) return {};
      return {
        messages: {
          ...s.messages,
          [assistantId]: { ...m, text: m.text + t, reasoning: r ? (m.reasoning ?? "") + r : m.reasoning },
        },
      };
    });
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(flush);
  };

  const patchAssistant = (fn: (m: ChatMessage) => Partial<ChatMessage>) => {
    flush();
    useApp.getState().updateSession(key, (s) => {
      const m = s.messages[assistantId];
      if (!m) return {};
      return { messages: { ...s.messages, [assistantId]: { ...m, ...fn(m) } } };
    });
  };

  let ok = true;
  try {
    const res = await apiRaw("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: isDraftKey(key) ? null : session.chatId ?? key,
        parentId: opts.parentId,
        content: opts.content,
        attachments: opts.attachments?.map((a) => a.id),
        modelId: opts.modelId ?? store.selectedModel,
        tools: opts.tools,
        temporary,
        history,
        projectId: opts.projectId ?? null,
        gptId: opts.gptId ?? null,
        voice: opts.voice,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
      signal: controller.signal,
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev: StreamEvent;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        opts.onEvent?.(ev);
        handleEvent(ev);
      }
    }
    flush();
  } catch (e) {
    flush();
    if (controller.signal.aborted) {
      patchAssistant(() => ({ status: "stopped" }));
    } else {
      ok = false;
      const msg = e instanceof ApiError ? e.message : "Network error. Check your connection and try again.";
      patchAssistant(() => ({ status: "error", error: msg }));
    }
  } finally {
    if (raf) cancelAnimationFrame(raf);
    flush();
    useApp.getState().updateSession(key, (s) => {
      const m = s.messages[assistantId];
      const messages = m && m.status === "streaming" ? { ...s.messages, [assistantId]: { ...m, status: "done" as const } } : s.messages;
      return { streaming: false, controller: null, messages };
    });
  }
  return { key, ok };

  function handleEvent(ev: StreamEvent) {
    switch (ev.type) {
      case "meta": {
        const st = useApp.getState();
        // Swap optimistic ids for the real ones.
        st.updateSession(key, (s) => {
          const messages = { ...s.messages };
          const tmpAsst = messages[asstTmp];
          delete messages[asstTmp];
          if (userTmp) delete messages[userTmp];
          if (ev.userMessage) messages[ev.userMessage.id] = { ...ev.userMessage };
          messages[ev.assistantMessage.id] = { ...ev.assistantMessage, text: tmpAsst?.text ?? "" };
          return { messages, currentLeaf: ev.assistantMessage.id };
        });
        assistantId = ev.assistantMessage.id;
        if (!temporary && key !== ev.chatId) {
          const from = key;
          st.renameSession(from, ev.chatId, ev.chatId);
          key = ev.chatId;
          const s = useApp.getState().session(key);
          st.upsertChat({
            id: ev.chatId,
            title: "New chat",
            projectId: s.projectId,
            gptId: s.gptId,
            pinned: false,
            archived: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          opts.onChatCreated?.(ev.chatId);
        } else if (!temporary) {
          const chat = st.chats.find((c) => c.id === ev.chatId);
          if (chat) st.upsertChat({ ...chat, updatedAt: Date.now() });
        }
        break;
      }
      case "text":
        pendingText += ev.delta;
        schedule();
        break;
      case "reasoning":
        pendingReasoning += ev.delta;
        schedule();
        break;
      case "reasoning-done":
        patchAssistant(() => ({ reasoningMs: ev.ms }));
        break;
      case "source":
        patchAssistant((m) => ({ sources: [...(m.sources ?? []), ev.source] }));
        break;
      case "activity":
        patchAssistant((m) => {
          const list = [...(m.activity ?? [])];
          const i = list.findIndex((a) => a.id === ev.activity.id);
          if (i >= 0) list[i] = ev.activity;
          else list.push(ev.activity);
          return { activity: list };
        });
        break;
      case "image":
        patchAssistant((m) => ({ images: [...(m.images ?? []), ev.image] }));
        break;
      case "canvas":
        patchAssistant(() => ({ canvas: ev.canvas }));
        useApp.getState().set({ canvas: { messageId: assistantId, sessionKey: key, canvas: ev.canvas } });
        break;
      case "error":
        patchAssistant(() => ({ error: ev.message }));
        break;
      case "reset":
        // The server is quietly retrying: drop the partial answer.
        pendingText = "";
        pendingReasoning = "";
        patchAssistant(() => ({
          text: "",
          reasoning: undefined,
          reasoningMs: undefined,
          sources: undefined,
          activity: undefined,
          images: undefined,
          canvas: undefined,
          error: undefined,
        }));
        break;
      case "done":
        patchAssistant(() => ({ status: ev.status }));
        break;
      case "title": {
        const st = useApp.getState();
        const chat = st.chats.find((c) => c.id === ev.chatId);
        if (chat) st.upsertChat({ ...chat, title: ev.title });
        st.animateTitle(ev.chatId, ev.title);
        break;
      }
    }
  }
}

export function stopStreaming(key: string) {
  useApp.getState().session(key).controller?.abort();
}

export async function selectBranch(key: string, leafId: string) {
  const st = useApp.getState();
  st.updateSession(key, () => ({ currentLeaf: leafId }));
  const chatId = st.session(key).chatId;
  if (chatId && !leafId.startsWith("tmp-")) {
    try {
      await api(`/api/chats/${chatId}`, { method: "PATCH", body: { currentLeaf: leafId } });
    } catch {
      /* not critical */
    }
  }
}
