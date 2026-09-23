"use client";

import { useState } from "react";
import { useApp } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import { cn, copyText } from "@/lib/client/utils";
import { Markdown } from "./Markdown";
import { CheckIcon, CloseIcon, CopyIcon, DownloadIcon, EditIcon } from "./icons";
import { Button, IconButton } from "./ui";

/** Side panel for writing and code, like ChatGPT's Canvas. */
export function CanvasPanel() {
  const canvasState = useApp((s) => s.canvas);
  if (!canvasState) return null;
  const { canvas, messageId } = canvasState;
  // Remount when the model rewrites the canvas so the draft starts from the new content.
  return <CanvasEditor key={`${messageId}:${canvas.id}:${canvas.content.length}:${canvas.title}`} />;
}

function CanvasEditor() {
  const canvasState = useApp((s) => s.canvas)!;
  const set = useApp((s) => s.set);
  const updateSession = useApp((s) => s.updateSession);
  const toast = useApp((s) => s.toast);
  const { canvas, messageId, sessionKey } = canvasState;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(canvas.content);
  const [copied, setCopied] = useState(false);
  const dirty = draft !== canvas.content;

  const save = async () => {
    const updated = { ...canvas, content: draft };
    set({ canvas: { ...canvasState, canvas: updated } });
    if (messageId) {
      updateSession(sessionKey, (s) => {
        const m = s.messages[messageId];
        return m ? { messages: { ...s.messages, [messageId]: { ...m, canvas: updated } } } : {};
      });
      if (!messageId.startsWith("tmp-") && sessionKey !== "temp") {
        try {
          await api(`/api/messages/${messageId}`, { method: "PATCH", body: { canvas: updated } });
          toast("Canvas saved", "success");
        } catch (e) {
          toast((e as Error).message, "error");
        }
      }
    }
    setEditing(false);
  };

  const download = () => {
    const ext = canvas.kind === "code" ? canvas.language || "txt" : "md";
    const blob = new Blob([draft], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${canvas.title.replace(/[^\w\s-]/g, "").trim() || "canvas"}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-surface md:static md:z-auto md:w-[48%] md:min-w-[380px] md:border-l md:border-line-2">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line-2 px-3">
        <IconButton label="Close canvas" onClick={() => set({ canvas: null })}>
          <CloseIcon size={20} />
        </IconButton>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{canvas.title}</div>
          <div className="text-xs text-fg-3">{canvas.kind === "code" ? canvas.language || "Code" : "Document"}</div>
        </div>
        {editing ? (
          <>
            <Button size="sm" onClick={() => { setDraft(canvas.content); setEditing(false); }}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={save} disabled={!dirty}>
              Save
            </Button>
          </>
        ) : (
          <>
            <IconButton label="Edit" onClick={() => setEditing(true)}>
              <EditIcon size={18} />
            </IconButton>
            <IconButton
              label={copied ? "Copied" : "Copy"}
              onClick={async () => {
                if (await copyText(draft)) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }
              }}
            >
              {copied ? <CheckIcon size={18} /> : <CopyIcon size={18} />}
            </IconButton>
            <IconButton label="Download" onClick={download}>
              <DownloadIcon size={18} />
            </IconButton>
          </>
        )}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={canvas.kind !== "code"}
            className={cn(
              "h-full min-h-full w-full resize-none bg-transparent p-6 text-[15px] leading-7 outline-none",
              canvas.kind === "code" && "font-mono text-sm leading-6",
            )}
          />
        ) : canvas.kind === "code" ? (
          <div className="p-4">
            <Markdown text={`\`\`\`${canvas.language || ""}\n${draft}\n\`\`\``} />
          </div>
        ) : (
          <div className="mx-auto max-w-2xl px-6 py-8">
            <Markdown text={draft} />
          </div>
        )}
      </div>
      <p className="border-t border-line-2 px-4 py-2 text-center text-xs text-fg-3">Ask LuckyGPT in the chat to make changes to this canvas.</p>
    </div>
  );
}
