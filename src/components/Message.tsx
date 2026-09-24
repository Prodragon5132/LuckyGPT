"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { useApp } from "@/lib/client/store";
import { fileUrl, api } from "@/lib/client/api";
import { cn, copyText, formatBytes } from "@/lib/client/utils";
import { onSpeakingChange, readAloud, stopSpeaking } from "@/lib/client/voice";
import type { Activity, Attachment, ChatMessage, Source } from "@/lib/shared/types";
import {
  BulbIcon,
  CanvasIcon,
  CheckIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CopyIcon,
  DownloadIcon,
  EditIcon,
  FileIcon,
  GlobeIcon,
  ImageIcon,
  RefreshIcon,
  SpeakerIcon,
  StopIcon,
  ThumbDownIcon,
  ThumbUpIcon,
  BrainIcon,
} from "./icons";
import { Button, IconButton, MenuItem, MenuLabel, MenuSeparator, Popover, Spinner, useAnchor } from "./ui";

export interface BranchInfo {
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

function BranchNav({ info }: { info?: BranchInfo }) {
  if (!info || info.total < 2) return null;
  return (
    <div className="flex items-center text-xs font-medium text-fg-2">
      <button onClick={info.onPrev} disabled={info.index === 0} className="rounded-md p-1 hover:bg-hover disabled:opacity-30" aria-label="Previous version">
        <ChevronLeft size={16} />
      </button>
      <span className="tabular-nums">
        {info.index + 1}/{info.total}
      </span>
      <button
        onClick={info.onNext}
        disabled={info.index === info.total - 1}
        className="rounded-md p-1 hover:bg-hover disabled:opacity-30"
        aria-label="Next version"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      label={copied ? "Copied" : "Copy"}
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }
      }}
    >
      {copied ? <CheckIcon size={18} /> : <CopyIcon size={18} />}
    </IconButton>
  );
}

export function AttachmentView({ items, align = "end", share }: { items: Attachment[]; align?: "start" | "end"; share?: string }) {
  const setLightbox = useApp((s) => s.set);
  if (!items.length) return null;
  const images = items.filter((a) => a.mime.startsWith("image/"));
  const files = items.filter((a) => !a.mime.startsWith("image/"));
  return (
    <div className={cn("mb-2 flex flex-col gap-2", align === "end" ? "items-end" : "items-start")}>
      {images.length > 0 && (
        <div className={cn("flex flex-wrap gap-2", align === "end" && "justify-end")}>
          {images.map((a) => (
            <button
              key={a.id}
              onClick={() => setLightbox({ lightbox: { id: a.id, name: a.name, share } })}
              className="overflow-hidden rounded-2xl border border-line-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={fileUrl(a.id, { share })}
                alt={a.name}
                className={cn("object-cover", images.length === 1 ? "max-h-72 max-w-[280px]" : "h-40 w-40")}
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
      {files.map((a) => (
        <a
          key={a.id}
          href={fileUrl(a.id, { download: true, share })}
          className="flex w-64 items-center gap-2.5 rounded-2xl border border-line-2 p-2 hover:bg-hover"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#ff5588] text-white">
            <FileIcon size={20} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{a.name}</div>
            <div className="text-xs text-fg-3">
              {a.name.split(".").pop()?.toUpperCase()} · {formatBytes(a.size)}
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}

// ---------------- User message ----------------

export const UserMessage = memo(function UserMessage({
  message,
  branch,
  onEdit,
  canEdit,
}: {
  message: ChatMessage;
  branch?: BranchInfo;
  onEdit: (text: string) => void;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.text);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && taRef.current) {
      const ta = taRef.current;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 400)}px`;
    }
  }, [editing]);

  if (editing) {
    return (
      <div className="w-full rounded-3xl bg-bubble px-4 py-3">
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 400)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-full resize-none bg-transparent text-base leading-7 outline-none"
        />
        <div className="mt-2 flex justify-end gap-2">
          <Button size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!draft.trim()}
            onClick={() => {
              setEditing(false);
              onEdit(draft.trim());
            }}
          >
            Send
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex w-full flex-col items-end">
      {message.attachments?.length ? <AttachmentView items={message.attachments} /> : null}
      {message.text && (
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[22px] bg-bubble px-4 py-2.5 text-base leading-7 sm:max-w-[70%]">
          {message.text}
        </div>
      )}
      <div className="mt-1 flex h-8 items-center gap-0.5 opacity-100 transition-opacity can-hover:opacity-0 can-hover:group-hover:opacity-100 can-hover:focus-within:opacity-100">
        <CopyButton text={message.text} />
        {canEdit && (
          <IconButton
            label="Edit message"
            onClick={() => {
              setDraft(message.text);
              setEditing(true);
            }}
          >
            <EditIcon size={18} />
          </IconButton>
        )}
        <BranchNav info={branch} />
      </div>
    </div>
  );
});

// ---------------- Assistant message ----------------

function ThinkingBlock({ message, streaming }: { message: ChatMessage; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const thinking = streaming && message.reasoningMs === undefined && !message.text;
  if (!message.reasoning && !thinking) return null;
  const secs = message.reasoningMs ? Math.max(1, Math.round(message.reasoningMs / 1000)) : 0;
  return (
    <div className="mb-3">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-sm text-fg-2 hover:text-fg">
        {thinking ? (
          <span className="shimmer font-medium">Thinking</span>
        ) : (
          <span>{secs <= 1 ? "Thought for a second" : `Thought for ${secs}s`}</span>
        )}
        <ChevronDown size={16} className={cn("transition-transform", !open && "-rotate-90")} />
      </button>
      {open && message.reasoning && (
        <div className="mt-2 border-l-2 border-line pl-4 text-sm leading-6 text-fg-2">
          <div className="md text-sm !leading-6">
            <Markdown text={message.reasoning} />
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityRow({ activity }: { activity: Activity }) {
  const icon =
    activity.kind === "search" ? (
      <GlobeIcon size={16} />
    ) : activity.kind === "image" ? (
      <ImageIcon size={16} />
    ) : activity.kind === "canvas" ? (
      <CanvasIcon size={16} />
    ) : activity.kind === "memory" ? (
      <BrainIcon size={16} />
    ) : (
      <BulbIcon size={16} />
    );
  return (
    <div className={cn("flex items-center gap-2 text-sm", activity.status === "error" ? "text-danger" : "text-fg-2")}>
      {icon}
      <span className={cn(activity.status === "running" && "shimmer font-medium")}>{activity.label}</span>
    </div>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function SourcesButton({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useAnchor<HTMLButtonElement>();
  const hosts = Array.from(new Set(sources.map((s) => hostOf(s.url)))).slice(0, 3);
  return (
    <>
      <button
        ref={setAnchor}
        onClick={() => setOpen((o) => !o)}
        className="ml-1 flex h-8 items-center gap-1.5 rounded-full border border-line px-2.5 text-xs font-medium text-fg-2 hover:bg-hover"
      >
        <span className="flex -space-x-1.5">
          {hosts.map((h) => (
            <span
              key={h}
              className="flex h-4 w-4 items-center justify-center rounded-full border border-surface bg-muted text-[9px] font-semibold uppercase text-fg"
            >
              {h[0]}
            </span>
          ))}
        </span>
        Sources
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} placement="top-start" className="w-80">
        <MenuLabel>Sources</MenuLabel>
        <div className="max-h-80 overflow-y-auto scroll-thin">
          {sources.map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="block rounded-lg px-2.5 py-2 hover:bg-hover"
            >
              <div className="text-xs text-fg-3">{hostOf(s.url)}</div>
              <div className="line-clamp-2 text-sm">{s.title || s.url}</div>
            </a>
          ))}
        </div>
      </Popover>
    </>
  );
}

function GeneratedImages({ images }: { images: Attachment[] }) {
  const set = useApp((s) => s.set);
  return (
    <div className="mb-3 flex flex-wrap gap-3">
      {images.map((img) => (
        <div key={img.id} className="group relative overflow-hidden rounded-2xl">
          <button onClick={() => set({ lightbox: { id: img.id, name: img.name } })}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileUrl(img.id)} alt={img.name} className="max-h-[480px] max-w-full rounded-2xl sm:max-w-md" />
          </button>
          <a
            href={fileUrl(img.id, { download: true })}
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 touch:opacity-100"
            aria-label="Download image"
          >
            <DownloadIcon size={16} />
          </a>
        </div>
      ))}
    </div>
  );
}

export const AssistantMessage = memo(function AssistantMessage({
  message,
  branch,
  isLast,
  onRegenerate,
  sessionKey,
  readOnly,
}: {
  message: ChatMessage;
  branch?: BranchInfo;
  isLast: boolean;
  onRegenerate: (modelId?: string) => void;
  sessionKey: string;
  readOnly?: boolean;
}) {
  const streaming = message.status === "streaming";
  const [feedback, setFeedback] = useState<number | null>(message.feedback ?? null);
  const [speaking, setSpeaking] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenEl, setRegenEl] = useAnchor<HTMLDivElement>();
  const models = useApp((s) => s.models);
  const voiceCfg = useApp((s) => s.voiceCfg);
  const prefs = useApp((s) => s.user?.prefs);
  const set = useApp((s) => s.set);
  const toast = useApp((s) => s.toast);

  useEffect(() => onSpeakingChange((id) => setSpeaking(id === message.id)), [message.id]);

  const empty = !message.text && !message.reasoning && !message.activity?.length && !message.images?.length && !message.error;
  const persisted = !message.id.startsWith("tmp-") && sessionKey !== "temp";

  const sendFeedback = async (v: 1 | -1) => {
    const next = feedback === v ? null : v;
    setFeedback(next);
    if (persisted) {
      try {
        await api(`/api/messages/${message.id}`, { method: "PATCH", body: { feedback: next } });
        if (next) toast("Thanks for your feedback!", "success");
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <div className="group w-full">
      {streaming && empty && (
        <div className="flex h-7 items-center">
          <span className="pulse-dot inline-block h-3.5 w-3.5 rounded-full bg-fg" />
        </div>
      )}

      <ThinkingBlock message={message} streaming={streaming} />

      {message.activity?.length ? (
        <div className="mb-3 flex flex-col gap-1.5">
          {message.activity.map((a) => (
            <ActivityRow key={a.id} activity={a} />
          ))}
        </div>
      ) : null}

      {message.images?.length ? <GeneratedImages images={message.images} /> : null}

      {message.canvas && (
        <button
          onClick={() => set({ canvas: { messageId: message.id, sessionKey, canvas: message.canvas! } })}
          className="mb-3 flex w-full max-w-sm items-center gap-3 rounded-2xl border border-line p-3 text-left hover:bg-hover"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
            <CanvasIcon size={20} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{message.canvas.title}</div>
            <div className="text-xs text-fg-3">{message.canvas.kind === "code" ? message.canvas.language || "Code" : "Document"} · Open in canvas</div>
          </div>
        </button>
      )}

      {message.text && <Markdown text={message.text} />}

      {message.error && (
        <div className="mt-2 rounded-2xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          <div>{message.error}</div>
          {!readOnly && isLast && !streaming && (
            <button onClick={() => onRegenerate()} className="mt-2 flex items-center gap-1.5 font-medium underline">
              <RefreshIcon size={14} /> Try again
            </button>
          )}
        </div>
      )}

      {!streaming && !readOnly && (
        <div
          className={cn(
            "mt-1 flex h-9 items-center gap-0.5 transition-opacity",
            isLast ? "opacity-100" : "opacity-100 can-hover:opacity-0 can-hover:group-hover:opacity-100 can-hover:focus-within:opacity-100",
          )}
        >
          <BranchNav info={branch} />
          {message.text && <CopyButton text={message.text} />}
          {persisted && (
            <>
              <IconButton label="Good response" onClick={() => sendFeedback(1)} active={feedback === 1}>
                <ThumbUpIcon size={18} filled={feedback === 1} />
              </IconButton>
              <IconButton label="Bad response" onClick={() => sendFeedback(-1)} active={feedback === -1}>
                <ThumbDownIcon size={18} filled={feedback === -1} />
              </IconButton>
            </>
          )}
          {message.text && (
            <IconButton
              label={speaking ? "Stop" : "Read aloud"}
              onClick={() =>
                speaking
                  ? stopSpeaking()
                  : void readAloud(message.id, message.text, {
                      tts: voiceCfg.tts,
                      voice: prefs?.voice && prefs.voice !== "default" ? prefs.voice : undefined,
                      lang: prefs?.spokenLanguage,
                      onError: (m) => useApp.getState().toast(m, "error"),
                    })
              }
            >
              {speaking ? <StopIcon size={18} /> : <SpeakerIcon size={18} />}
            </IconButton>
          )}
          <div ref={setRegenEl} className="flex">
            <IconButton label="Try again" onClick={() => setRegenOpen((o) => !o)}>
              <RefreshIcon size={18} />
            </IconButton>
          </div>
          {message.sources?.length ? <SourcesButton sources={message.sources} /> : null}
          <Popover anchor={regenEl} open={regenOpen} onClose={() => setRegenOpen(false)} placement="top-start" className="w-64">
            <MenuItem
              icon={<RefreshIcon size={18} />}
              label="Try again"
              onClick={() => {
                setRegenOpen(false);
                onRegenerate(message.model ?? undefined);
              }}
            />
            {models.length > 1 && (
              <>
                <MenuSeparator />
                <MenuLabel>Try again with</MenuLabel>
                <div className="max-h-64 overflow-y-auto scroll-thin">
                  {models.map((m) => (
                    <MenuItem
                      key={m.id}
                      label={m.name}
                      description={m.providerLabel}
                      checked={m.id === message.model}
                      onClick={() => {
                        setRegenOpen(false);
                        onRegenerate(m.id);
                      }}
                    />
                  ))}
                </div>
              </>
            )}
            {message.modelName && (
              <>
                <MenuSeparator />
                <div className="px-2.5 py-1.5 text-xs text-fg-3">Used {message.modelName}</div>
              </>
            )}
          </Popover>
        </div>
      )}
      {streaming && !empty && message.text && <span className="sr-only">Generating…</span>}
      {streaming && !message.text && !empty && message.activity?.every((a) => a.status !== "running") && !message.reasoning && (
        <Spinner size={14} className="text-fg-3" />
      )}
    </div>
  );
});
