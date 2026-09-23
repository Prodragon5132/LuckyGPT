"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/client/store";
import { api, uploadFile } from "@/lib/client/api";
import { sendMessage } from "@/lib/client/chat-client";
import { cn, formatBytes, formatDate } from "@/lib/client/utils";
import type { ChatSummary, FileInfo, Project } from "@/lib/shared/types";
import { Composer } from "./Composer";
import { DotsIcon, EditIcon, FileIcon, FolderIcon, PaperclipIcon, TrashIcon, CanvasIcon } from "./icons";
import { Button, confirmDialog, IconButton, MenuItem, MenuSeparator, Modal, Popover, promptDialog, Spinner, useAnchor } from "./ui";

const COLORS = ["", "#e25507", "#e0ac00", "#00a240", "#0169cc", "#924ff7", "#e0569e"];

export function ProjectView({ projectId }: { projectId: string }) {
  const router = useRouter();
  const project = useApp((s) => s.projects.find((p) => p.id === projectId));
  const allChats = useApp((s) => s.chats);
  const loadProjects = useApp((s) => s.loadProjects);
  const toast = useApp((s) => s.toast);
  const set = useApp((s) => s.set);
  const [files, setFiles] = useState<FileInfo[] | null>(null);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [menuEl, setMenuEl] = useAnchor<HTMLDivElement>();
  const fileRef = useRef<HTMLInputElement>(null);
  const key = `new:p:${projectId}`;
  const streaming = useApp((s) => !!s.sessions[key]?.streaming);
  const chats = allChats.filter((c) => c.projectId === projectId && !c.archived);

  useEffect(() => {
    void api<FileInfo[]>(`/api/files?projectId=${projectId}`).then(setFiles).catch(() => setFiles([]));
  }, [projectId]);

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center text-fg-2">
        <Spinner size={20} />
      </div>
    );
  }

  const patch = async (body: Partial<Project>) => {
    try {
      await api(`/api/projects/${projectId}`, { method: "PATCH", body });
      await loadProjects();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div className="scroll-thin flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6 sm:pt-12">
        <div className="mb-6 flex items-center gap-3">
          <FolderIcon size={30} style={{ color: project.color || undefined }} />
          <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold sm:text-3xl">{project.name}</h1>
          <div ref={setMenuEl}>
            <IconButton label="Project options" onClick={() => setMenu((m) => !m)} className="h-9 w-9">
              <DotsIcon size={20} />
            </IconButton>
          </div>
          <Popover anchor={menuEl} open={menu} onClose={() => setMenu(false)} placement="bottom-end">
            <MenuItem
              icon={<EditIcon size={18} />}
              label="Rename project"
              onClick={async () => {
                setMenu(false);
                const name = await promptDialog({ title: "Rename project", value: project.name });
                if (name) await patch({ name });
              }}
            />
            <div className="flex gap-1.5 px-2.5 py-2">
              {COLORS.map((c) => (
                <button
                  key={c || "none"}
                  onClick={() => void patch({ color: c })}
                  className={cn("h-5 w-5 rounded-full border border-line", project.color === c && "ring-2 ring-fg-3 ring-offset-1 ring-offset-elevated")}
                  style={{ background: c || "var(--muted)" }}
                  aria-label={`Color ${c || "none"}`}
                />
              ))}
            </div>
            <MenuSeparator />
            <MenuItem
              icon={<TrashIcon size={18} />}
              label="Delete project"
              danger
              onClick={async () => {
                setMenu(false);
                const ok = await confirmDialog({
                  title: "Delete project?",
                  body: "This deletes the project, its files and all chats inside it.",
                  confirmLabel: "Delete",
                  danger: true,
                });
                if (!ok) return;
                await api(`/api/projects/${projectId}`, { method: "DELETE" });
                await Promise.all([loadProjects(), useApp.getState().loadChats()]);
                router.push("/");
              }}
            />
          </Popover>
        </div>

        <Composer
          placeholder={`New chat in ${project.name}`}
          streaming={streaming}
          autoFocus
          onVoice={() => set({ voiceOpen: true, voiceContext: { sessionKey: key, gptId: null, projectId } })}
          onSend={(text, attachments, tools) => {
            useApp.getState().dropSession(key);
            void sendMessage({
              key,
              content: text,
              parentId: null,
              attachments,
              tools,
              projectId,
              onChatCreated: (id) => router.push(`/c/${id}`),
            });
          }}
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-start gap-3 rounded-2xl border border-line p-4 text-left hover:bg-hover"
          >
            <PaperclipIcon size={20} className="mt-0.5 shrink-0" />
            <span>
              <span className="block text-sm font-medium">{uploading ? "Uploading…" : "Add files"}</span>
              <span className="block text-xs text-fg-3">Chats in this project can use these files.</span>
            </span>
          </button>
          <button
            onClick={() => {
              setDraft(project.instructions);
              setInstructionsOpen(true);
            }}
            className="flex items-start gap-3 rounded-2xl border border-line p-4 text-left hover:bg-hover"
          >
            <CanvasIcon size={20} className="mt-0.5 shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{project.instructions ? "Edit instructions" : "Add instructions"}</span>
              <span className="block truncate text-xs text-fg-3">{project.instructions || "Tailor the way LuckyGPT responds in this project."}</span>
            </span>
          </button>
        </div>

        {files && files.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {files.map((f) => (
              <div key={f.id} className="group flex items-center gap-2 rounded-xl border border-line-2 py-1.5 pl-2 pr-1 text-sm">
                <FileIcon size={16} className="text-fg-3" />
                <span className="max-w-[180px] truncate">{f.name}</span>
                <span className="text-xs text-fg-3">{formatBytes(f.size)}</span>
                <button
                  onClick={async () => {
                    await api(`/api/files/${f.id}`, { method: "DELETE" });
                    setFiles((all) => all!.filter((x) => x.id !== f.id));
                  }}
                  className="rounded-md p-1 text-fg-3 hover:bg-hover hover:text-danger"
                  aria-label={`Remove ${f.name}`}
                >
                  <TrashIcon size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          accept=".pdf,.docx,.txt,.md,.csv,.json,.html,.js,.ts,.py,.java,.c,.cpp,.cs,.go,.rs,.rb,.php,.sql,.xml,.yaml,.yml"
          onChange={async (e) => {
            const list = Array.from(e.target.files ?? []);
            e.target.value = "";
            setUploading(true);
            for (const file of list) {
              try {
                const info = await uploadFile(file, file.name, { purpose: "project", projectId });
                setFiles((all) => [info, ...(all ?? [])]);
              } catch (err) {
                toast((err as Error).message, "error");
              }
            }
            setUploading(false);
          }}
        />

        <div className="mt-10">
          <h2 className="mb-2 text-sm font-medium text-fg-2">Chats in this project</h2>
          {chats.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-fg-3">Start a chat above to keep related work together.</p>
          ) : (
            <div className="divide-y divide-line-2 border-y border-line-2">
              {chats.map((c: ChatSummary) => (
                <button key={c.id} onClick={() => router.push(`/c/${c.id}`)} className="flex w-full items-center gap-3 px-2 py-3.5 text-left hover:bg-hover">
                  <span className="min-w-0 flex-1 truncate text-sm">{c.title}</span>
                  <span className="shrink-0 text-xs text-fg-3">{formatDate(c.updatedAt)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal open={instructionsOpen} onClose={() => setInstructionsOpen(false)} title="Instructions" className="max-w-xl">
        <div className="px-5 pb-5 pt-3">
          <p className="mb-3 text-sm text-fg-2">How should LuckyGPT help with this project? For example: “Always answer in Spanish” or “I&apos;m planning a trip to Italy in May.”</p>
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={8000}
            className="min-h-[200px] w-full resize-y rounded-xl border border-line bg-transparent p-3 text-sm outline-none focus:border-fg-3"
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button onClick={() => setInstructionsOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={async () => {
                await patch({ instructions: draft });
                setInstructionsOpen(false);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
