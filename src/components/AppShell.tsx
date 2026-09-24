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
import { setVoiceSpeed, unlockAudio } from "@/lib/client/voice";
import { DESKTOP_QUERY } from "@/lib/client/utils";

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
  const voiceSpeed = useApp((s) => s.user?.prefs.voiceSpeed);

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

  useEffect(() => setVoiceSpeed(voiceSpeed ?? 1.3), [voiceSpeed]);

  // iPhone: audio may only start from a tap, so unlock the shared player on the first taps.
  useEffect(() => {
    const opts = { capture: true, passive: true } as const;
    window.addEventListener("click", unlockAudio, opts);
    window.addEventListener("touchend", unlockAudio, opts);
    return () => {
      window.removeEventListener("click", unlockAudio, opts);
      window.removeEventListener("touchend", unlockAudio, opts);
    };
  }, []);

  // iPhone keyboard: size the app to the visible area so the composer sits right above the
  // keyboard and the top bar never scrolls away.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement.style;
    const update = () => {
      if (Math.abs(vv.scale - 1) > 0.01) return; // pinch-zoomed: leave the layout alone
      root.setProperty("--app-h", `${Math.round(vv.height)}px`);
      root.setProperty("--app-top", `${Math.round(vv.offsetTop)}px`);
      // Keyboard open → no need to leave room for the home indicator.
      document.documentElement.toggleAttribute("data-keyboard", window.innerHeight - vv.height > 120);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // Phones: swipe right from the left edge to open the sidebar, swipe left to close it (like the ChatGPT app).
  useEffect(() => {
    let start: { x: number; y: number; open: boolean } | null = null;
    const onStart = (e: TouchEvent) => {
      if (window.matchMedia(DESKTOP_QUERY).matches || e.touches.length !== 1) return;
      const t = e.touches[0];
      const open = useApp.getState().mobileNav;
      start = open || t.clientX < 28 ? { x: t.clientX, y: t.clientY, open } : null;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = Math.abs(t.clientY - start.y);
      if (dy > 40) start = null;
      else if (!start.open && dx > 60) {
        set({ mobileNav: true });
        start = null;
      } else if (start.open && dx < -60) {
        set({ mobileNav: false });
        start = null;
      }
    };
    const onEnd = () => (start = null);
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [set]);

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
    <div className="app-frame flex overflow-hidden bg-surface text-fg">
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
