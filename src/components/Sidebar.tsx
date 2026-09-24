"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { applyTheme, useApp } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import { cn, initials, isMac, useIsDesktop } from "@/lib/client/utils";
import type { ChatSummary, UsageInfo } from "@/lib/shared/types";
import {
  MoonIcon,
  MonitorIcon,
  SunIcon,
  ArchiveIcon,
  ChevronDown,
  DotsIcon,
  EditIcon,
  FolderIcon,
  FolderPlusIcon,
  GptsIcon,
  LibraryIcon,
  Logo,
  LogoutIcon,
  NewChatIcon,
  PaletteIcon,
  PinIcon,
  SearchIcon,
  SettingsIcon,
  ShareIcon,
  SidebarIcon,
  TrashIcon,
} from "./icons";
import { confirmDialog, IconButton, MenuItem, MenuSeparator, Popover, promptDialog, SubMenu, Tooltip, useAnchor } from "./ui";
import { GptAvatar } from "./ChatView";
import { openShareDialog } from "./ShareDialog";

export function useNav() {
  const router = useRouter();
  const set = useApp((s) => s.set);
  return (href: string) => {
    set({ mobileNav: false });
    router.push(href);
  };
}

export function newChat(router: ReturnType<typeof useRouter>) {
  const st = useApp.getState();
  const draft = st.sessions["new"];
  if (draft && !draft.streaming) st.dropSession("new");
  st.set({ mobileNav: false, temporary: false, canvas: null });
  router.push("/");
}

function ChatItem({ chat, active }: { chat: ChatSummary; active: boolean }) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(chat.title);
  const [btnEl, setBtnEl] = useAnchor<HTMLButtonElement>();
  const router = useRouter();
  const typing = useApp((s) => s.typingTitles[chat.id]);
  const projects = useApp((s) => s.projects);
  const patchChat = useApp((s) => s.patchChat);
  const deleteChat = useApp((s) => s.deleteChat);
  const set = useApp((s) => s.set);
  const pathname = usePathname();

  const commitRename = () => {
    setRenaming(false);
    const t = draft.trim();
    if (t && t !== chat.title) void patchChat(chat.id, { title: t });
  };

  return (
    <div className={cn("group relative rounded-lg", active ? "bg-active" : "hover:bg-hover", menu && !active && "bg-hover")}>
      {renaming ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          className="h-9 w-full rounded-lg border border-link bg-surface px-2.5 text-sm outline-none"
          maxLength={200}
        />
      ) : (
        <button
          onClick={() => {
            set({ mobileNav: false, temporary: false });
            router.push(`/c/${chat.id}`);
          }}
          onDoubleClick={() => {
            setDraft(chat.title);
            setRenaming(true);
          }}
          className="flex h-9 w-full items-center px-2.5 text-left text-sm"
        >
          <span className="relative flex-1 overflow-hidden whitespace-nowrap" style={{ maskImage: "linear-gradient(to right, black 82%, transparent)" }}>
            {typing ?? chat.title}
          </span>
        </button>
      )}
      {!renaming && (
        <button
          ref={setBtnEl}
          onClick={(e) => {
            e.stopPropagation();
            setMenu((m) => !m);
          }}
          className={cn(
            "absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-fg-2 hover:text-fg",
            menu || active ? "opacity-100" : "opacity-100 can-hover:opacity-0 can-hover:group-hover:opacity-100",
          )}
          aria-label="Chat options"
        >
          <DotsIcon size={18} />
        </button>
      )}
      <Popover anchor={btnEl} open={menu} onClose={() => setMenu(false)} placement="bottom-start">
        <MenuItem
          icon={<ShareIcon size={18} />}
          label="Share"
          onClick={() => {
            setMenu(false);
            openShareDialog(chat.id);
          }}
        />
        <MenuItem
          icon={<EditIcon size={18} />}
          label="Rename"
          onClick={() => {
            setMenu(false);
            setDraft(chat.title);
            setRenaming(true);
          }}
        />
        <MenuItem
          icon={<PinIcon size={18} />}
          label={chat.pinned ? "Unpin chat" : "Pin chat"}
          onClick={() => {
            setMenu(false);
            void patchChat(chat.id, { pinned: !chat.pinned });
          }}
        />
        <SubMenu icon={<FolderIcon size={18} />} label="Move to project">
          {chat.projectId && (
            <MenuItem
              label="Remove from project"
              onClick={() => {
                setMenu(false);
                void patchChat(chat.id, { projectId: null });
              }}
            />
          )}
          {projects.map((p) => (
            <MenuItem
              key={p.id}
              icon={<FolderIcon size={16} style={{ color: p.color || undefined }} />}
              label={p.name}
              checked={p.id === chat.projectId}
              onClick={() => {
                setMenu(false);
                void patchChat(chat.id, { projectId: p.id });
              }}
            />
          ))}
          <MenuItem
            icon={<FolderPlusIcon size={16} />}
            label="New project"
            onClick={async () => {
              setMenu(false);
              const name = await promptDialog({ title: "Project name", placeholder: "e.g. Taxes 2026", confirmLabel: "Create project" });
              if (!name) return;
              const p = await api<{ id: string }>("/api/projects", { body: { name } });
              await useApp.getState().loadProjects();
              void patchChat(chat.id, { projectId: p.id });
            }}
          />
        </SubMenu>
        <MenuItem
          icon={<ArchiveIcon size={18} />}
          label="Archive"
          onClick={() => {
            setMenu(false);
            void patchChat(chat.id, { archived: true });
            if (pathname === `/c/${chat.id}`) router.push("/");
          }}
        />
        <MenuSeparator />
        <MenuItem
          icon={<TrashIcon size={18} />}
          label="Delete"
          danger
          onClick={async () => {
            setMenu(false);
            const ok = await confirmDialog({
              title: "Delete chat?",
              body: (
                <>
                  This will delete <strong>{chat.title}</strong>.
                </>
              ),
              confirmLabel: "Delete",
              danger: true,
            });
            if (!ok) return;
            await deleteChat(chat.id);
            if (pathname === `/c/${chat.id}`) router.push("/");
          }}
        />
      </Popover>
    </div>
  );
}

function NavItem({
  icon,
  label,
  onClick,
  active,
  shortcut,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  shortcut?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn("group flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm", active ? "bg-active" : "hover:bg-hover")}
    >
      <span className="flex h-5 w-5 items-center justify-center">{icon}</span>
      <span className="flex-1 truncate text-left">{label}</span>
      {shortcut && <span className="hidden text-xs text-fg-3 group-hover:inline">{shortcut}</span>}
    </button>
  );
}

function UsageBar({ label, used, total, text }: { label: string; used: number; total: number; text: string }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="px-2.5 py-1.5">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="text-fg-2">{label}</span>
        <span className="tabular-nums text-fg-3">{text}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full rounded-full", pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-[#e0ac00]" : "bg-[#1f9d63]")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** OpenRouter usage: spend vs. credits/limit when OpenRouter reports it, and prompts today vs. 1000. */
function UsageBars() {
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  useEffect(() => {
    let alive = true;
    api<UsageInfo>("/api/usage")
      .then((u) => alive && setUsage(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!usage?.openrouter) return null;
  const money = (n: number) => `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`;
  return (
    <>
      <MenuSeparator />
      {usage.credits && (
        <UsageBar
          label={usage.credits.label}
          used={usage.credits.used}
          total={usage.credits.total}
          text={`${money(usage.credits.used)} of ${money(usage.credits.total)}`}
        />
      )}
      {usage.prompts && (
        <UsageBar
          label="Messages today"
          used={usage.prompts.used}
          total={usage.prompts.total}
          text={`${usage.prompts.used} / ${usage.prompts.total}`}
        />
      )}
    </>
  );
}

/** Light / Dark / System, one tap away (also in Settings → General → Theme). */
function ThemeSwitch() {
  const prefs = useApp((s) => s.user?.prefs);
  const setPrefs = useApp((s) => s.setPrefs);
  if (!prefs) return null;
  const options = [
    { value: "light", label: "Light", icon: <SunIcon size={16} /> },
    { value: "dark", label: "Dark", icon: <MoonIcon size={16} /> },
    { value: "system", label: "System", icon: <MonitorIcon size={16} /> },
  ] as const;
  return (
    <>
      <MenuSeparator />
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
        <span className="text-sm">Theme</span>
        <div className="flex rounded-full bg-muted p-0.5" role="radiogroup" aria-label="Theme">
          {options.map((o) => (
            <button
              key={o.value}
              role="radio"
              aria-checked={prefs.theme === o.value}
              aria-label={o.label}
              title={o.label}
              onClick={() => {
                applyTheme(o.value, prefs.accent);
                void setPrefs({ theme: o.value });
              }}
              className={cn(
                "flex h-7 w-8 items-center justify-center rounded-full text-fg-2",
                prefs.theme === o.value ? "bg-elevated text-fg shadow-sm dark:bg-[#4a4a4a]" : "hover:text-fg",
              )}
            >
              {o.icon}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function ProfileMenu({ compact }: { compact?: boolean }) {
  const user = useApp((s) => s.user);
  const set = useApp((s) => s.set);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useAnchor<HTMLButtonElement>();
  if (!user) return null;
  const avatar = (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1f7a55] text-xs font-semibold text-white">
      {initials(user.name)}
    </span>
  );
  return (
    <>
      {compact ? (
        <Tooltip label={user.name} side="right">
          <button ref={setAnchor} onClick={() => setOpen((o) => !o)} className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-hover" aria-label="Open profile menu">
            {avatar}
          </button>
        </Tooltip>
      ) : (
        <button
          ref={setAnchor}
          onClick={() => setOpen((o) => !o)}
          className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-hover", open && "bg-hover")}
        >
          {avatar}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{user.name}</span>
            <span className="block truncate text-xs text-fg-3">{user.role === "admin" ? "Admin" : "Free forever"}</span>
          </span>
        </button>
      )}
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} placement={compact ? "right-start" : "top-start"} className="w-[244px]">
        <div className="flex items-center gap-2.5 px-2.5 py-2 text-sm text-fg-2">
          <span className="truncate">@{user.username}</span>
        </div>
        <UsageBars />
        <ThemeSwitch />
        <MenuSeparator />
        <MenuItem
          icon={<PaletteIcon size={18} />}
          label="Customize LuckyGPT"
          onClick={() => {
            setOpen(false);
            set({ settingsTab: "personalization", mobileNav: false });
          }}
        />
        <MenuItem
          icon={<SettingsIcon size={18} />}
          label="Settings"
          onClick={() => {
            setOpen(false);
            set({ settingsTab: "general", mobileNav: false });
          }}
        />
        <MenuSeparator />
        <MenuItem
          icon={<LogoutIcon size={18} />}
          label="Log out"
          onClick={async () => {
            setOpen(false);
            try {
              await api("/api/auth/logout", { method: "POST", body: {} });
            } finally {
              window.location.href = "/login";
            }
          }}
        />
      </Popover>
    </>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const nav = useNav();
  const chats = useApp((s) => s.chats);
  const projects = useApp((s) => s.projects);
  const gpts = useApp((s) => s.gpts);
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const mobileNav = useApp((s) => s.mobileNav);
  const set = useApp((s) => s.set);
  const [chatsCollapsed, setChatsCollapsed] = useState(false);
  const desktop = useIsDesktop();
  const mod = isMac() ? "⌘" : "Ctrl+";

  const toggleSidebar = () => {
    const next = !sidebarOpen;
    set({ sidebarOpen: next });
    try {
      localStorage.setItem("lgpt-sidebar", next ? "open" : "closed");
    } catch {
      /* ignore */
    }
  };

  const pinnedChats = chats.filter((c) => c.pinned && !c.archived);
  const recent = chats.filter((c) => !c.pinned && !c.archived && !c.projectId);
  const activeChat = pathname.startsWith("/c/") ? pathname.slice(3) : null;
  const pinnedGpts = gpts.filter((g) => g.pinned);

  const createProject = async () => {
    const name = await promptDialog({ title: "Project name", placeholder: "e.g. Birthday party", confirmLabel: "Create project" });
    if (!name) return;
    try {
      const p = await api<{ id: string }>("/api/projects", { body: { name } });
      await useApp.getState().loadProjects();
      nav(`/project/${p.id}`);
    } catch (e) {
      useApp.getState().toast((e as Error).message, "error");
    }
  };

  const full = (
    <div className="flex h-full w-[260px] flex-col bg-sidebar">
      <div className="flex h-14 shrink-0 items-center justify-between px-2">
        <button onClick={() => newChat(router)} className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-hover" aria-label="LuckyGPT home">
          <Logo size={26} className="text-[#1f9d63]" />
        </button>
        <IconButton label="Close sidebar" onClick={() => (mobileNav ? set({ mobileNav: false }) : toggleSidebar())} className="h-10 w-10">
          <SidebarIcon size={20} />
        </IconButton>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <div className="space-y-px">
          <NavItem icon={<NewChatIcon size={19} />} label="New chat" onClick={() => newChat(router)} shortcut={`${mod}Shift+O`} />
          <NavItem icon={<SearchIcon size={19} />} label="Search chats" onClick={() => set({ searchOpen: true, mobileNav: false })} shortcut={`${mod}K`} />
          <NavItem icon={<LibraryIcon size={19} />} label="Library" onClick={() => nav("/library")} active={pathname === "/library"} />
          <NavItem icon={<GptsIcon size={19} />} label="GPTs" onClick={() => nav("/gpts")} active={pathname === "/gpts"} />
        </div>

        {pinnedGpts.length > 0 && (
          <div className="mt-2 space-y-px">
            {pinnedGpts.map((g) => (
              <button
                key={g.id}
                onClick={() => nav(`/g/${g.id}`)}
                className={cn("flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm", pathname === `/g/${g.id}` ? "bg-active" : "hover:bg-hover")}
              >
                <GptAvatar gpt={g} size={20} />
                <span className="truncate">{g.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-5">
          <div className="px-2.5 pb-1 text-sm text-fg-3">Projects</div>
          <NavItem icon={<FolderPlusIcon size={19} />} label="New project" onClick={createProject} />
          {projects.map((p) => (
            <NavItem
              key={p.id}
              icon={<FolderIcon size={19} style={{ color: p.color || undefined }} />}
              label={p.name}
              onClick={() => nav(`/project/${p.id}`)}
              active={pathname === `/project/${p.id}`}
            />
          ))}
        </div>

        {pinnedChats.length > 0 && (
          <div className="mt-5">
            <div className="px-2.5 pb-1 text-sm text-fg-3">Pinned</div>
            {pinnedChats.map((c) => (
              <ChatItem key={c.id} chat={c} active={activeChat === c.id} />
            ))}
          </div>
        )}

        <div className="mt-5">
          <button onClick={() => setChatsCollapsed((v) => !v)} className="group flex w-full items-center gap-1 px-2.5 pb-1 text-sm text-fg-3">
            Chats
            <ChevronDown size={14} className={cn("opacity-0 transition group-hover:opacity-100", chatsCollapsed && "-rotate-90 opacity-100")} />
          </button>
          {!chatsCollapsed &&
            (recent.length ? (
              recent.map((c) => <ChatItem key={c.id} chat={c} active={activeChat === c.id} />)
            ) : (
              <div className="px-2.5 py-2 text-sm text-fg-3">Your chats will show up here.</div>
            ))}
        </div>
      </div>

      <div className="shrink-0 border-t border-line-2 p-2">
        <ProfileMenu />
      </div>
    </div>
  );

  const rail = (
    <div className="flex h-full w-[52px] flex-col items-center bg-surface py-2 md:border-r md:border-line-2">
      <IconButton label="Open sidebar" onClick={toggleSidebar} className="h-10 w-10" tooltipSide="right">
        <SidebarIcon size={20} />
      </IconButton>
      <div className="mt-2 flex flex-col items-center gap-1">
        <IconButton label="New chat" onClick={() => newChat(router)} className="h-10 w-10" tooltipSide="right">
          <NewChatIcon size={19} />
        </IconButton>
        <IconButton label="Search chats" onClick={() => set({ searchOpen: true })} className="h-10 w-10" tooltipSide="right">
          <SearchIcon size={19} />
        </IconButton>
        <IconButton label="Library" onClick={() => nav("/library")} className="h-10 w-10" tooltipSide="right">
          <LibraryIcon size={19} />
        </IconButton>
        <IconButton label="GPTs" onClick={() => nav("/gpts")} className="h-10 w-10" tooltipSide="right">
          <GptsIcon size={19} />
        </IconButton>
      </div>
      <div className="mt-auto">
        <ProfileMenu compact />
      </div>
    </div>
  );

  if (desktop) return <aside className="h-full shrink-0">{sidebarOpen ? full : rail}</aside>;

  // Mobile: a drawer that slides over the chat.
  return (
    <div className={cn("fixed inset-0 z-40", mobileNav ? "pointer-events-auto" : "pointer-events-none")} aria-hidden={!mobileNav} inert={!mobileNav}>
      <div
        className={cn("absolute inset-0 bg-[var(--overlay)] transition-opacity", mobileNav ? "opacity-100" : "opacity-0")}
        onClick={() => set({ mobileNav: false })}
      />
      <aside className={cn("safe-y absolute inset-y-0 left-0 bg-sidebar transition-transform duration-200", mobileNav ? "translate-x-0" : "-translate-x-full")}>
        {full}
      </aside>
    </div>
  );
}
