"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { applyTheme, useApp } from "@/lib/client/store";
import type { UserInfo } from "@/lib/shared/types";
import { Sidebar, newChat } from "./Sidebar";
import { TopBar } from "./TopBar";
import { ChatView } from "./ChatView";
import { ProjectView } from "./ProjectView";
import { GptEditor, GptsView } from "./GptsView";
import { LibraryView } from "./LibraryView";
import { SearchDialog } from "./SearchDialog";
import { SettingsModal } from "./settings/SettingsModal";
import { ArchivedModal, MemoriesModal, SharedLinksModal } from "./settings/UserTabs";
import { ShareDialog } from "./ShareDialog";
import { Lightbox } from "./Lightbox";
import { VoiceMode } from "./VoiceMode";
import { CanvasPanel } from "./CanvasPanel";
import { DialogHost, Toasts } from "./ui";

type Route =
  | { view: "chat"; key: string; gptId?: string; chatId?: string }
  | { view: "project"; id: string }
  | { view: "gpts" }
  | { view: "gpt-editor"; id: string | null }
  | { view: "library" };

const UUID = /^[0-9a-f-]{36}$/i;

function parseRoute(path: string, temporary: boolean): Route {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "c" && parts[1] && UUID.test(parts[1])) return { view: "chat", key: parts[1], chatId: parts[1] };
  if (parts[0] === "g" && parts[1] && UUID.test(parts[1])) return { view: "chat", key: `new:g:${parts[1]}`, gptId: parts[1] };
  if (parts[0] === "project" && parts[1]) return { view: "project", id: parts[1] };
  if (parts[0] === "gpts" && parts[1] === "editor") return { view: "gpt-editor", id: parts[2] ?? null };
  if (parts[0] === "gpts") return { view: "gpts" };
  if (parts[0] === "library") return { view: "library" };
  return { view: "chat", key: temporary ? "temp" : "new" };
}

const subscribeNoop = () => () => {};

export function AppShell({ initialUser }: { initialUser: UserInfo }) {
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const pathname = usePathname();
  const router = useRouter();
  const user = useApp((s) => s.user);
  const temporary = useApp((s) => s.temporary);
  const canvasOpen = useApp((s) => !!s.canvas);
  const set = useApp((s) => s.set);

  useEffect(() => {
    const st = useApp.getState();
    st.init(initialUser);
    applyTheme(initialUser.prefs.theme, initialUser.prefs.accent);
    const toastErr = (e: Error) => st.toast(e.message, "error");
    st.loadModels().catch(toastErr);
    st.loadChats().catch(toastErr);
    st.loadProjects().catch(toastErr);
    st.loadGpts().catch(toastErr);
  }, [initialUser]);

  // Follow the OS theme when set to "System".
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const p = useApp.getState().user?.prefs;
      if (p?.theme === "system") applyTheme("system", p.accent);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Keyboard shortcuts (same as ChatGPT)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        set({ searchOpen: !useApp.getState().searchOpen });
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        newChat(router);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const next = !useApp.getState().sidebarOpen;
        set({ sidebarOpen: next });
        try {
          localStorage.setItem("lgpt-sidebar", next ? "open" : "closed");
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, set]);

  // Close the canvas when leaving a chat.
  useEffect(() => {
    const c = useApp.getState().canvas;
    if (c && !pathname.startsWith("/c/") && c.sessionKey !== "new" && c.sessionKey !== "temp") set({ canvas: null });
  }, [pathname, set]);

  if (!mounted || !user) {
    return <div className="h-dvh bg-surface" />;
  }

  const route = parseRoute(pathname, temporary);
  let content: React.ReactNode;
  let topBar: React.ReactNode;

  switch (route.view) {
    case "chat":
      topBar = <TopBar chatId={route.chatId ?? null} showTempToggle={!route.chatId && !route.gptId} />;
      content = <ChatView key={route.key} sessionKey={route.key} gptId={route.gptId} />;
      break;
    case "project":
      topBar = <TopBar chatId={null} showTempToggle={false} />;
      content = <ProjectView projectId={route.id} />;
      break;
    case "gpts":
      topBar = <TopBar chatId={null} showTempToggle={false} title="GPTs" />;
      content = <GptsView />;
      break;
    case "gpt-editor":
      topBar = null;
      content = <GptEditor key={route.id ?? "new"} gptId={route.id} />;
      break;
    case "library":
      topBar = <TopBar chatId={null} showTempToggle={false} title="Library" />;
      content = <LibraryView />;
      break;
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-surface text-fg">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col">
        {topBar}
        {content}
      </main>
      {canvasOpen && <CanvasPanel />}
      <SearchDialog />
      <SettingsModal />
      <MemoriesModal />
      <ArchivedModal />
      <SharedLinksModal />
      <ShareDialog />
      <Lightbox />
      <VoiceMode />
      <DialogHost />
      <Toasts />
    </div>
  );
}
