"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/client/store";
import { cn } from "@/lib/client/utils";
import {
  ArchiveIcon,
  CheckIcon,
  ChevronDown,
  DotsIcon,
  FolderIcon,
  MenuIcon,
  NewChatIcon,
  PinIcon,
  ShareIcon,
  TempChatIcon,
  TrashIcon,
  SparkleIcon,
} from "./icons";
import { confirmDialog, IconButton, MenuItem, MenuLabel, MenuSeparator, Popover, SubMenu, Tooltip, useAnchor } from "./ui";
import { openShareDialog } from "./ShareDialog";
import { newChat } from "./Sidebar";
import type { ModelInfo } from "@/lib/shared/types";

function capsLine(m: ModelInfo) {
  const bits: string[] = [];
  if (m.capabilities.reasoning) bits.push("thinks");
  if (m.capabilities.vision) bits.push("sees images");
  if (m.capabilities.webSearch) bits.push("web search");
  if (m.capabilities.imageOutput) bits.push("makes images");
  return bits.join(" · ");
}

export function ModelPicker() {
  const models = useApp((s) => s.models);
  const selected = useApp((s) => s.selectedModel);
  const defaultModel = useApp((s) => s.user?.prefs.defaultModel ?? s.defaultModelId);
  const set = useApp((s) => s.set);
  const setPrefs = useApp((s) => s.setPrefs);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useAnchor<HTMLButtonElement>();
  const current = models.find((m) => m.id === selected);

  const groups = new Map<string, ModelInfo[]>();
  for (const m of models) {
    const list = groups.get(m.providerLabel) ?? [];
    list.push(m);
    groups.set(m.providerLabel, list);
  }

  return (
    <>
      <button
        ref={setAnchor}
        onClick={() => setOpen((o) => !o)}
        className={cn("flex h-9 min-w-0 items-center gap-1 rounded-lg px-2.5 text-lg hover:bg-hover", open && "bg-hover")}
      >
        <span className="truncate font-normal">{current ? current.name : "LuckyGPT"}</span>
        <ChevronDown size={16} className="shrink-0 text-fg-3" />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} placement="bottom-start" className="w-[320px]">
        {models.length === 0 ? (
          <div className="px-3 py-4 text-sm text-fg-2">No models are set up yet. An admin can add API keys in Settings.</div>
        ) : (
          <div className="max-h-[65vh] overflow-y-auto scroll-thin">
            {[...groups.entries()].map(([label, list], gi) => (
              <div key={label}>
                {gi > 0 && <MenuSeparator />}
                <MenuLabel>{label}</MenuLabel>
                {list.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      set({ selectedModel: m.id });
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-hover"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm">
                        {m.name}
                        {m.id === defaultModel && <span className="rounded bg-muted px-1.5 py-px text-[10px] text-fg-2">default</span>}
                      </span>
                      <span className="block truncate text-xs text-fg-3">{m.description || capsLine(m)}</span>
                    </span>
                    {m.id === selected && <CheckIcon size={18} />}
                  </button>
                ))}
              </div>
            ))}
            {current && current.id !== defaultModel && (
              <>
                <MenuSeparator />
                <MenuItem
                  icon={<SparkleIcon size={18} />}
                  label={`Make ${current.name} my default`}
                  onClick={() => {
                    void setPrefs({ defaultModel: current.id });
                    setOpen(false);
                  }}
                />
              </>
            )}
          </div>
        )}
      </Popover>
    </>
  );
}

function ChatMenu({ chatId }: { chatId: string }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useAnchor<HTMLDivElement>();
  const router = useRouter();
  const chat = useApp((s) => s.chats.find((c) => c.id === chatId));
  const projects = useApp((s) => s.projects);
  const patchChat = useApp((s) => s.patchChat);
  const deleteChat = useApp((s) => s.deleteChat);
  if (!chat) return null;
  return (
    <div ref={setAnchor}>
      <IconButton label="More" onClick={() => setOpen((o) => !o)} className="h-9 w-9">
        <DotsIcon size={20} />
      </IconButton>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} placement="bottom-end">
        <MenuItem
          icon={<PinIcon size={18} />}
          label={chat.pinned ? "Unpin chat" : "Pin chat"}
          onClick={() => {
            setOpen(false);
            void patchChat(chat.id, { pinned: !chat.pinned });
          }}
        />
        <SubMenu icon={<FolderIcon size={18} />} label="Move to project">
          {chat.projectId && (
            <MenuItem
              label="Remove from project"
              onClick={() => {
                setOpen(false);
                void patchChat(chat.id, { projectId: null });
              }}
            />
          )}
          {projects.length === 0 && <div className="px-2.5 py-2 text-sm text-fg-3">No projects yet</div>}
          {projects.map((p) => (
            <MenuItem
              key={p.id}
              label={p.name}
              checked={p.id === chat.projectId}
              onClick={() => {
                setOpen(false);
                void patchChat(chat.id, { projectId: p.id });
              }}
            />
          ))}
        </SubMenu>
        <MenuItem
          icon={<ArchiveIcon size={18} />}
          label="Archive"
          onClick={() => {
            setOpen(false);
            void patchChat(chat.id, { archived: true });
            router.push("/");
          }}
        />
        <MenuSeparator />
        <MenuItem
          icon={<TrashIcon size={18} />}
          label="Delete"
          danger
          onClick={async () => {
            setOpen(false);
            if (await confirmDialog({ title: "Delete chat?", body: `This will delete "${chat.title}".`, confirmLabel: "Delete", danger: true })) {
              await deleteChat(chat.id);
              router.push("/");
            }
          }}
        />
      </Popover>
    </div>
  );
}

export function TopBar({ chatId, showTempToggle, title }: { chatId: string | null; showTempToggle: boolean; title?: string }) {
  const router = useRouter();
  const set = useApp((s) => s.set);
  const temporary = useApp((s) => s.temporary);
  const sidebarOpen = useApp((s) => s.sidebarOpen);

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 px-2 md:px-3">
      <div className="md:hidden">
        <IconButton label="Open sidebar" onClick={() => set({ mobileNav: true })} className="h-10 w-10">
          <MenuIcon size={22} />
        </IconButton>
      </div>
      <div className={cn("flex min-w-0 flex-1 items-center", !sidebarOpen && "md:pl-0")}>
        {title ? <span className="truncate px-2 text-lg">{title}</span> : <ModelPicker />}
      </div>
      <div className="flex items-center gap-1">
        {chatId && (
          <Tooltip label="Share">
            <button
              onClick={() => openShareDialog(chatId)}
              className="hidden h-9 items-center gap-1.5 rounded-full border border-line px-3 text-sm font-medium hover:bg-hover sm:flex"
            >
              <ShareIcon size={17} /> Share
            </button>
          </Tooltip>
        )}
        {chatId && <ChatMenu chatId={chatId} />}
        {showTempToggle && (
          <IconButton
            label={temporary ? "Turn off temporary chat" : "Turn on temporary chat"}
            onClick={() => set({ temporary: !temporary })}
            className={cn("h-9 w-9", temporary && "bg-active text-fg")}
          >
            <TempChatIcon size={20} />
          </IconButton>
        )}
        <div className="md:hidden">
          <IconButton label="New chat" onClick={() => newChat(router)} className="h-10 w-10">
            <NewChatIcon size={20} />
          </IconButton>
        </div>
      </div>
    </header>
  );
}
