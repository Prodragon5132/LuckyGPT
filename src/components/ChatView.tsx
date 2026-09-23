"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/lib/client/store";
import { loadChat, selectBranch, sendMessage, stopStreaming } from "@/lib/client/chat-client";
import { childrenOf, cn, deepestLeaf, greeting, threadFor, useIsDesktop } from "@/lib/client/utils";
import type { Attachment, ChatMessage, Gpt, ToolToggles } from "@/lib/shared/types";
import { Composer, type ComposerHandle } from "./Composer";
import { AssistantMessage, UserMessage, type BranchInfo } from "./Message";
import { ArrowDownIcon, TempChatIcon } from "./icons";
import { Spinner } from "./ui";
import { readAloud } from "@/lib/client/voice";

const EMPTY_MESSAGES: Record<string, ChatMessage> = {};

export function GptAvatar({ gpt, size = 64 }: { gpt: Pick<Gpt, "icon" | "color">; size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full border border-line-2"
      style={{ width: size, height: size, background: gpt.color || "var(--muted)", fontSize: size * 0.5 }}
    >
      <span>{gpt.icon || "✨"}</span>
    </div>
  );
}

function NoModels() {
  const isAdmin = useApp((s) => s.user?.role === "admin");
  const set = useApp((s) => s.set);
  return (
    <div className="mx-auto mb-6 max-w-md rounded-2xl border border-line p-4 text-center text-sm text-fg-2">
      {isAdmin ? (
        <>
          <p className="mb-3 font-medium text-fg">Let&apos;s connect an AI model</p>
          <p className="mb-3">Add an API key from OpenAI, Anthropic, Google Gemini or OpenRouter to start chatting.</p>
          <button onClick={() => set({ settingsTab: "keys" })} className="rounded-full bg-accent px-4 py-2 font-medium text-accent-fg">
            Add an API key
          </button>
        </>
      ) : (
        <p>No AI models are set up yet. Ask your admin to add an API key.</p>
      )}
    </div>
  );
}

export function ChatView({ sessionKey, gptId, projectId }: { sessionKey: string; gptId?: string | null; projectId?: string | null }) {
  const session = useApp((s) => s.sessions[sessionKey]);
  const user = useApp((s) => s.user);
  const models = useApp((s) => s.models);
  const gpts = useApp((s) => s.gpts);
  const temporary = sessionKey === "temp";
  const set = useApp((s) => s.set);
  const composerRef = useRef<ComposerHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [hello] = useState(() => greeting(user?.name ?? ""));
  const desktop = useIsDesktop();

  const messages = session?.messages ?? EMPTY_MESSAGES;
  const effectiveGptId = gptId ?? session?.gptId ?? null;
  const effectiveProjectId = projectId ?? session?.projectId ?? null;
  const gpt = gpts.find((g) => g.id === effectiveGptId) ?? null;

  // Load an existing chat from the server.
  useEffect(() => {
    if (sessionKey === "new" || sessionKey === "temp" || sessionKey.startsWith("new:")) return;
    const s = useApp.getState().sessions[sessionKey];
    if (!s || (!s.loaded && !s.loading)) void loadChat(sessionKey);
  }, [sessionKey]);

  const thread = useMemo(() => threadFor(messages, session?.currentLeaf ?? null), [messages, session?.currentLeaf]);
  const lastText = thread[thread.length - 1]?.text.length ?? 0;
  const streaming = !!session?.streaming;

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useLayoutEffect(() => {
    if (atBottom) scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.length, lastText, session?.loaded]);

  useEffect(() => {
    // Jump to the bottom when a chat opens (the view remounts per chat).
    requestAnimationFrame(() => scrollToBottom());
  }, [scrollToBottom]);

  // Settings → General → "Read responses aloud automatically"
  const wasStreaming = useRef(false);
  useEffect(() => {
    const st = useApp.getState();
    if (wasStreaming.current && !streaming && st.user?.prefs.autoReadAloud && !st.voiceOpen) {
      const last = thread[thread.length - 1];
      if (last?.role === "assistant" && last.status === "done" && last.text) {
        void readAloud(last.id, last.text, {
          tts: st.voiceCfg.tts,
          voice: st.user.prefs.voice !== "default" ? st.user.prefs.voice : undefined,
          lang: st.user.prefs.spokenLanguage,
        });
      }
    }
    wasStreaming.current = streaming;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  const onChatCreated = useCallback((chatId: string) => {
    if (window.location.pathname !== `/c/${chatId}`) window.history.replaceState(null, "", `/c/${chatId}`);
  }, []);

  const send = (text: string, attachments: Attachment[], tools: ToolToggles, parentId?: string | null) => {
    setAtBottom(true);
    const last = thread[thread.length - 1];
    void sendMessage({
      key: sessionKey,
      content: text,
      parentId: parentId !== undefined ? parentId : (last?.id ?? null),
      attachments,
      tools,
      gptId: effectiveGptId,
      projectId: effectiveProjectId,
      onChatCreated,
    });
    requestAnimationFrame(() => scrollToBottom(true));
  };

  const regenerate = (assistant: ChatMessage, modelId?: string) => {
    if (!assistant.parentId) return;
    const userMsg = messages[assistant.parentId];
    if (modelId) set({ selectedModel: modelId });
    void sendMessage({
      key: sessionKey,
      content: null,
      parentId: assistant.parentId,
      modelId: modelId ?? undefined,
      tools: userMsg?.tools,
      gptId: effectiveGptId,
      projectId: effectiveProjectId,
      onChatCreated,
    });
  };

  const branchInfo = (m: ChatMessage): BranchInfo | undefined => {
    const siblings = childrenOf(messages, m.parentId).filter((x) => x.role === m.role);
    if (siblings.length < 2) return undefined;
    const index = siblings.findIndex((x) => x.id === m.id);
    const go = (i: number) => {
      const target = siblings[i];
      if (target) void selectBranch(sessionKey, deepestLeaf(messages, target.id));
    };
    return { index, total: siblings.length, onPrev: () => go(index - 1), onNext: () => go(index + 1) };
  };

  const empty = thread.length === 0;
  const loading = session?.loading && !session.loaded;

  const composer = (
    <Composer
      ref={composerRef}
      onSend={(t, a, tools) => send(t, a, tools)}
      onStop={() => stopStreaming(sessionKey)}
      streaming={streaming}
      temporary={temporary}
      autoFocus
      allowTools={gpt ? { search: gpt.capabilities.search, image: gpt.capabilities.image } : undefined}
      onVoice={() =>
        set({
          voiceOpen: true,
          voiceContext: { sessionKey, gptId: effectiveGptId, projectId: effectiveProjectId },
        })
      }
      placeholder={gpt ? `Message ${gpt.name}` : "Ask anything"}
    />
  );

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes("Files")) setDragging(true);
      }}
    >
      {dragging && (
        <div
          className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-surface/90 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length) composerRef.current?.addFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <div className="text-4xl">📎</div>
          <div className="text-lg font-semibold">Add anything</div>
          <div className="text-sm text-fg-2">Drop any file here to add it to the conversation</div>
        </div>
      )}

      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 pb-[12vh]">
          {loading ? (
            <Spinner size={24} className="text-fg-3" />
          ) : session?.error ? (
            <div className="text-center text-fg-2">
              <p className="mb-2 text-lg font-medium text-fg">Couldn&apos;t open this chat</p>
              <p className="text-sm">{session.error}</p>
            </div>
          ) : (
            <div className="w-full max-w-3xl">
              {gpt ? (
                <div className="mb-8 flex flex-col items-center text-center">
                  <GptAvatar gpt={gpt} />
                  <h1 className="mt-3 text-2xl font-semibold">{gpt.name}</h1>
                  {gpt.description && <p className="mt-1 max-w-md text-sm text-fg-2">{gpt.description}</p>}
                  <p className="mt-1 text-xs text-fg-3">By {user?.name}</p>
                  {gpt.starters.length > 0 && (
                    <div className="mt-6 grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
                      {gpt.starters.map((s) => (
                        <button
                          key={s}
                          onClick={() => send(s, [], {})}
                          className="rounded-2xl border border-line px-4 py-3 text-left text-sm text-fg-2 hover:bg-hover"
                        >
                          <span className="line-clamp-2">{s}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : temporary ? (
                <div className="mb-8 text-center">
                  <h1 className="flex items-center justify-center gap-2 text-3xl font-semibold">
                    <TempChatIcon size={28} /> Temporary Chat
                  </h1>
                  <p className="mx-auto mt-3 max-w-md text-sm text-fg-2">
                    This chat won&apos;t appear in your history, use or update LuckyGPT&apos;s memory, or be saved.
                  </p>
                </div>
              ) : (
                <h1 className="mb-7 text-center text-[28px] font-normal leading-tight tracking-tight sm:text-[32px]">{hello}</h1>
              )}
              {models.length === 0 && <NoModels />}
              {desktop && composer}
            </div>
          )}
        </div>
      ) : (
        <div ref={scrollRef} onScroll={onScroll} className="scroll-thin flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-6 sm:px-6">
            {thread.map((m, i) => (
              <div key={m.id} className={cn("fade-in", m.role === "user" ? "mb-5 mt-2" : "mb-6")}>
                {m.role === "user" ? (
                  <UserMessage message={m} branch={branchInfo(m)} canEdit={!streaming} onEdit={(t) => send(t, m.attachments ?? [], m.tools ?? {}, m.parentId)} />
                ) : (
                  <AssistantMessage
                    message={m}
                    branch={branchInfo(m)}
                    isLast={i === thread.length - 1}
                    onRegenerate={(modelId) => regenerate(m, modelId)}
                    sessionKey={sessionKey}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {(!empty || (!desktop && !session?.error)) && (
        <div className="relative mx-auto w-full max-w-3xl px-3 pb-2 sm:px-6">
          {!atBottom && !empty && (
            <button
              onClick={() => {
                setAtBottom(true);
                scrollToBottom(true);
              }}
              className="absolute -top-12 left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-surface text-fg shadow-md"
              aria-label="Scroll to bottom"
            >
              <ArrowDownIcon size={18} />
            </button>
          )}
          {composer}
          <p className="safe-bottom px-2 pt-2 text-center text-xs text-fg-2">
            LuckyGPT can make mistakes. Check important info.
          </p>
        </div>
      )}
    </div>
  );
}
