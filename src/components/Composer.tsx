"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useApp } from "@/lib/client/store";
import { uploadFile, fileUrl } from "@/lib/client/api";
import { formatBytes, isTouch, prepareImage } from "@/lib/client/utils";
import { browserSttSupported, createRecognizer, startRecorder, transcribeBlob, type Recorder } from "@/lib/client/voice";
import type { Attachment, ToolToggles } from "@/lib/shared/types";
import {
  ArrowUpIcon,
  BookIcon,
  BulbIcon,
  CanvasIcon,
  CheckIcon,
  CloseIcon,
  FileIcon,
  GlobeIcon,
  ImageIcon,
  MicIcon,
  PaperclipIcon,
  PlusIcon,
  StopIcon,
  TelescopeIcon,
  VoiceIcon,
} from "./icons";
import { MenuItem, MenuSeparator, Popover, Spinner, Tooltip, useAnchor } from "./ui";

export interface ComposerHandle {
  focus(): void;
  setText(t: string): void;
  addFiles(files: File[]): void;
}

interface PendingFile {
  localId: string;
  name: string;
  size: number;
  mime: string;
  preview?: string;
  progress: number;
  att?: Attachment;
  error?: string;
}

const TOOL_META: Record<keyof ToolToggles, { label: string; short: string; icon: (p: { size?: number }) => React.ReactNode }> = {
  image: { label: "Create image", short: "Image", icon: (p) => <ImageIcon {...p} /> },
  think: { label: "Thinking", short: "Think", icon: (p) => <BulbIcon {...p} /> },
  research: { label: "Deep research", short: "Research", icon: (p) => <TelescopeIcon {...p} /> },
  search: { label: "Web search", short: "Search", icon: (p) => <GlobeIcon {...p} /> },
  canvas: { label: "Canvas", short: "Canvas", icon: (p) => <CanvasIcon {...p} /> },
  study: { label: "Study and learn", short: "Study", icon: (p) => <BookIcon {...p} /> },
};

const EXCLUSIVE: (keyof ToolToggles)[] = ["image", "research", "study"];

export const Composer = forwardRef<
  ComposerHandle,
  {
    onSend: (text: string, attachments: Attachment[], tools: ToolToggles) => void;
    onStop?: () => void;
    streaming?: boolean;
    placeholder?: string;
    temporary?: boolean;
    allowTools?: { search?: boolean; image?: boolean };
    onVoice?: () => void;
    autoFocus?: boolean;
  }
>(function Composer({ onSend, onStop, streaming, placeholder = "Ask anything", temporary, allowTools, onVoice, autoFocus }, ref) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [tools, setTools] = useState<ToolToggles>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [dictating, setDictating] = useState<null | { mode: "server" | "browser"; transcribing?: boolean }>(null);
  const [level, setLevel] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [plusEl, setPlusEl] = useAnchor<HTMLButtonElement>();
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<Recorder | null>(null);
  const recogRef = useRef<ReturnType<typeof createRecognizer>>(null);
  const baseTextRef = useRef("");
  const models = useApp((s) => s.models);
  const selectedModel = useApp((s) => s.selectedModel);
  const imageEnabled = useApp((s) => s.imageEnabled);
  const voiceCfg = useApp((s) => s.voiceCfg);
  const prefs = useApp((s) => s.user?.prefs);
  const toast = useApp((s) => s.toast);
  const model = models.find((m) => m.id === selectedModel);

  const resize = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, Math.max(160, window.innerHeight * 0.3))}px`;
  }, []);

  useEffect(resize, [text, resize]);

  useEffect(() => {
    if (autoFocus && !isTouch()) taRef.current?.focus();
  }, [autoFocus]);

  const addFiles = useCallback(
    async (list: File[]) => {
      const accepted = list.slice(0, 10);
      for (const file of accepted) {
        const localId = Math.random().toString(36).slice(2);
        const isImage = file.type.startsWith("image/");
        const pending: PendingFile = {
          localId,
          name: file.name || "pasted-image.png",
          size: file.size,
          mime: file.type,
          preview: isImage ? URL.createObjectURL(file) : undefined,
          progress: 0,
        };
        setFiles((f) => [...f, pending]);
        try {
          const blob = isImage ? await prepareImage(file) : file;
          if (blob.size > 4 * 1024 * 1024) throw new Error("File is too large (max 4 MB).");
          const info = await uploadFile(blob, pending.name, { purpose: temporary ? "temp" : "upload" }, (p) =>
            setFiles((f) => f.map((x) => (x.localId === localId ? { ...x, progress: p } : x))),
          );
          setFiles((f) =>
            f.map((x) =>
              x.localId === localId
                ? { ...x, progress: 1, att: { id: info.id, name: info.name, mime: info.mime, size: info.size } }
                : x,
            ),
          );
        } catch (e) {
          toast((e as Error).message, "error");
          setFiles((f) => f.filter((x) => x.localId !== localId));
        }
      }
    },
    [temporary, toast],
  );

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    setText: (t: string) => {
      setText(t);
      requestAnimationFrame(() => {
        taRef.current?.focus();
        resize();
      });
    },
    addFiles: (f: File[]) => void addFiles(f),
  }));

  const uploading = files.some((f) => !f.att);
  const canSend = (text.trim().length > 0 || files.length > 0) && !uploading && !dictating;

  const submit = () => {
    if (!canSend || streaming) return;
    const attachments = files.map((f) => f.att!).filter(Boolean);
    onSend(text.trim(), attachments, tools);
    files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
    setText("");
    setFiles([]);
  };

  const toggleTool = (key: keyof ToolToggles) => {
    setTools((t) => {
      const next: ToolToggles = { ...t, [key]: !t[key] };
      if (next[key] && EXCLUSIVE.includes(key)) {
        for (const k of EXCLUSIVE) if (k !== key) next[k] = false;
      }
      if (key === "research" && next.research) next.think = false;
      return next;
    });
    setMenuOpen(false);
    taRef.current?.focus();
  };

  // ---------- Dictation ----------
  const startDictation = async () => {
    const useServer = voiceCfg.stt === "server";
    if (!useServer && !browserSttSupported()) {
      toast("Voice typing isn't supported in this browser. Try Chrome, Edge or Safari, or ask your admin to set up speech-to-text.", "error");
      return;
    }
    baseTextRef.current = text ? `${text} ` : "";
    if (useServer) {
      try {
        recRef.current = await startRecorder();
        setDictating({ mode: "server" });
      } catch (e) {
        toast((e as Error).message, "error");
      }
    } else {
      const r = createRecognizer({
        lang: prefs?.spokenLanguage,
        onText: (final, interim) => setText(baseTextRef.current + final + interim),
        onError: (m) => toast(m, "error"),
        onEnd: () => setDictating(null),
      });
      recogRef.current = r;
      r?.start();
      setDictating({ mode: "browser" });
    }
  };

  useEffect(() => {
    if (!dictating || dictating.mode !== "server" || dictating.transcribing) return;
    let raf = 0;
    const tick = () => {
      setLevel(recRef.current?.level() ?? 0);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [dictating]);

  const finishDictation = async (keep: boolean) => {
    if (!dictating) return;
    if (dictating.mode === "browser") {
      recogRef.current?.stop();
      if (!keep) setText(baseTextRef.current.trimEnd());
      setDictating(null);
      return;
    }
    const rec = recRef.current;
    recRef.current = null;
    if (!keep || !rec) {
      rec?.cancel();
      setDictating(null);
      return;
    }
    setDictating({ mode: "server", transcribing: true });
    try {
      const blob = await rec.stop();
      const t = await transcribeBlob(blob);
      if (t) setText(baseTextRef.current + t);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setDictating(null);
      taRef.current?.focus();
    }
  };

  const activeTools = (Object.keys(tools) as (keyof ToolToggles)[]).filter((k) => tools[k]);
  const showVoice = !text.trim() && !files.length && !streaming && onVoice;

  return (
    <div
      className="relative w-full"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          void addFiles(Array.from(e.dataTransfer.files));
        }
      }}
    >
      <div
        className="rounded-[28px] bg-composer p-2.5 shadow-[var(--shadow-composer)] transition-shadow"
        onClick={(e) => {
          if (e.target === e.currentTarget) taRef.current?.focus();
        }}
      >
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1.5 pb-2 pt-1">
            {files.map((f) => (
              <div key={f.localId} className="group relative">
                {f.preview ? (
                  <div className="relative h-14 w-14 overflow-hidden rounded-xl border border-line-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.att ? fileUrl(f.att.id) : f.preview} alt={f.name} className="h-full w-full object-cover" />
                    {!f.att && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                        <Spinner size={18} />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex h-14 w-56 items-center gap-2.5 rounded-xl border border-line-2 p-2">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#ff5588] text-white">
                      {f.att ? <FileIcon size={20} /> : <Spinner size={18} />}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{f.name}</div>
                      <div className="text-xs text-fg-3">{f.att ? formatBytes(f.size) : `Uploading… ${Math.round(f.progress * 100)}%`}</div>
                    </div>
                  </div>
                )}
                <button
                  onClick={() => setFiles((all) => all.filter((x) => x.localId !== f.localId))}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface text-fg shadow-sm"
                  aria-label={`Remove ${f.name}`}
                >
                  <CloseIcon size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {dictating ? (
          <div className="flex h-[52px] items-center gap-2 px-1">
            <button
              onClick={() => finishDictation(false)}
              className="flex h-9 w-9 items-center justify-center rounded-full text-fg-2 hover:bg-hover"
              aria-label="Cancel dictation"
            >
              <CloseIcon size={20} />
            </button>
            <div className="flex h-9 flex-1 items-center gap-[3px] overflow-hidden">
              {dictating.transcribing ? (
                <span className="shimmer text-sm">Transcribing…</span>
              ) : dictating.mode === "browser" ? (
                <span className="truncate text-sm text-fg-2">{text || "Listening…"}</span>
              ) : (
                Array.from({ length: 48 }).map((_, i) => (
                  <span
                    key={i}
                    className="w-[3px] rounded-full bg-fg-2"
                    style={{ height: `${Math.max(3, Math.min(32, level * 220 * (0.5 + Math.abs(Math.sin(i * 1.7 + Date.now() / 300)))))}px` }}
                  />
                ))
              )}
            </div>
            <button
              onClick={() => finishDictation(true)}
              disabled={!!dictating.transcribing}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-fg disabled:opacity-40"
              aria-label="Finish dictation"
            >
              {dictating.transcribing ? <Spinner size={16} /> : <CheckIcon size={18} />}
            </button>
          </div>
        ) : (
          <>
            <textarea
              ref={taRef}
              value={text}
              rows={1}
              placeholder={tools.image ? "Describe or edit an image" : tools.research ? "Get a detailed report" : placeholder}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                const pasted = Array.from(e.clipboardData.files);
                if (pasted.length) {
                  e.preventDefault();
                  void addFiles(pasted);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !isTouch()) {
                  e.preventDefault();
                  submit();
                }
              }}
              className="block max-h-[40dvh] min-h-[44px] w-full resize-none bg-transparent px-2.5 py-2.5 text-base leading-6 text-fg outline-none"
              aria-label="Message"
            />
            <div className="flex items-center gap-1.5">
              <Tooltip label="Add files and more">
                <button
                  ref={setPlusEl}
                  onClick={() => setMenuOpen((o) => !o)}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-fg hover:bg-hover"
                  aria-label="Add files and more"
                >
                  <PlusIcon size={20} />
                </button>
              </Tooltip>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {activeTools.map((k) => (
                  <button
                    key={k}
                    onClick={() => toggleTool(k)}
                    className="group flex h-9 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium text-link hover:bg-hover"
                    title={`Remove ${TOOL_META[k].label}`}
                  >
                    <span className="group-hover:hidden">{TOOL_META[k].icon({ size: 18 })}</span>
                    <span className="hidden group-hover:inline">
                      <CloseIcon size={18} />
                    </span>
                    {TOOL_META[k].short}
                  </button>
                ))}
              </div>
              <Tooltip label="Dictate">
                <button
                  onClick={startDictation}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-fg-2 hover:bg-hover hover:text-fg"
                  aria-label="Dictate"
                >
                  <MicIcon size={20} />
                </button>
              </Tooltip>
              {streaming ? (
                <Tooltip label="Stop">
                  <button
                    onClick={onStop}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-fg"
                    aria-label="Stop generating"
                  >
                    <StopIcon size={18} />
                  </button>
                </Tooltip>
              ) : showVoice ? (
                <Tooltip label="Use voice mode">
                  <button
                    onClick={onVoice}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-fg hover:opacity-85"
                    aria-label="Start voice mode"
                  >
                    <VoiceIcon size={18} />
                  </button>
                </Tooltip>
              ) : (
                <Tooltip label="Send">
                  <button
                    onClick={submit}
                    disabled={!canSend}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-fg transition-opacity disabled:opacity-30"
                    aria-label="Send message"
                  >
                    {uploading ? <Spinner size={16} /> : <ArrowUpIcon size={18} />}
                  </button>
                </Tooltip>
              )}
            </div>
          </>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        accept="image/png,image/jpeg,image/webp,image/gif,.pdf,.docx,.txt,.md,.csv,.json,.html,.css,.js,.ts,.tsx,.jsx,.py,.java,.c,.cpp,.h,.cs,.go,.rs,.rb,.php,.sh,.sql,.xml,.yaml,.yml,.log"
        onChange={(e) => {
          if (e.target.files) void addFiles(Array.from(e.target.files));
          e.target.value = "";
        }}
      />

      <Popover anchor={plusEl} open={menuOpen} onClose={() => setMenuOpen(false)} placement="top-start" className="w-64">
        <MenuItem
          icon={<PaperclipIcon size={18} />}
          label="Add photos & files"
          onClick={() => {
            setMenuOpen(false);
            fileRef.current?.click();
          }}
        />
        <MenuSeparator />
        {imageEnabled && allowTools?.image !== false && (
          <MenuItem icon={<ImageIcon size={18} />} label="Create image" onClick={() => toggleTool("image")} checked={!!tools.image} />
        )}
        {model?.capabilities.reasoning && (
          <MenuItem icon={<BulbIcon size={18} />} label="Thinking" description="Think longer for better answers" onClick={() => toggleTool("think")} checked={!!tools.think} />
        )}
        {model?.capabilities.webSearch && allowTools?.search !== false && (
          <>
            <MenuItem icon={<TelescopeIcon size={18} />} label="Deep research" description="Get a detailed report" onClick={() => toggleTool("research")} checked={!!tools.research} />
            <MenuItem icon={<GlobeIcon size={18} />} label="Web search" description="Find real-time news and info" onClick={() => toggleTool("search")} checked={!!tools.search} />
          </>
        )}
        {model?.capabilities.tools && (
          <MenuItem icon={<CanvasIcon size={18} />} label="Canvas" description="Write and code together" onClick={() => toggleTool("canvas")} checked={!!tools.canvas} />
        )}
        <MenuItem icon={<BookIcon size={18} />} label="Study and learn" description="Learn step by step" onClick={() => toggleTool("study")} checked={!!tools.study} />
      </Popover>
    </div>
  );
});
