"use client";

import { create } from "zustand";
import { api } from "./api";
import type {
  Canvas,
  ChatMessage,
  ChatSummary,
  Gpt,
  ModelInfo,
  Project,
  UserInfo,
  UserPrefs,
  VoiceClientConfig,
} from "@/lib/shared/types";

export interface ChatSession {
  key: string;
  chatId: string | null;
  messages: Record<string, ChatMessage>;
  currentLeaf: string | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  streaming: boolean;
  controller: AbortController | null;
  gptId: string | null;
  projectId: string | null;
}

export type SettingsTab =
  | "general"
  | "personalization"
  | "data"
  | "security"
  | "account"
  | "keys"
  | "models"
  | "voice"
  | "users"
  | "errors";

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error" | "success";
}

interface ModelsResponse {
  models: ModelInfo[];
  defaultModel: string | null;
  imageEnabled: boolean;
  webSearch: "auto" | "manual";
  voice: VoiceClientConfig;
}

interface State {
  user: UserInfo | null;
  models: ModelInfo[];
  defaultModelId: string | null;
  imageEnabled: boolean;
  webSearchMode: "auto" | "manual";
  voiceCfg: VoiceClientConfig;
  selectedModel: string | null;

  chats: ChatSummary[];
  chatsLoaded: boolean;
  projects: Project[];
  gpts: Gpt[];
  sessions: Record<string, ChatSession>;
  typingTitles: Record<string, string>;

  sidebarOpen: boolean;
  mobileNav: boolean;
  settingsTab: SettingsTab | null;
  searchOpen: boolean;
  temporary: boolean;
  voiceOpen: boolean;
  canvas: { messageId: string | null; sessionKey: string; canvas: Canvas } | null;
  toasts: Toast[];
  memoriesOpen: boolean;
  archivedOpen: boolean;
  sharedLinksOpen: boolean;
  lightbox: { id: string; name: string; share?: string } | null;
  voiceContext: { sessionKey: string; gptId: string | null; projectId: string | null } | null;
}

interface Actions {
  init(user: UserInfo): void;
  loadModels(): Promise<void>;
  loadChats(): Promise<void>;
  loadProjects(): Promise<void>;
  loadGpts(): Promise<void>;
  setPrefs(patch: Partial<UserPrefs>): Promise<void>;
  setName(name: string): Promise<void>;
  upsertChat(chat: ChatSummary): void;
  removeChat(id: string): void;
  patchChat(id: string, patch: Partial<ChatSummary> & { projectId?: string | null }): Promise<void>;
  deleteChat(id: string): Promise<void>;
  session(key: string): ChatSession;
  updateSession(key: string, fn: (s: ChatSession) => Partial<ChatSession>): void;
  renameSession(from: string, to: string, chatId: string): void;
  dropSession(key: string): void;
  toast(text: string, kind?: Toast["kind"]): void;
  dismissToast(id: number): void;
  set(patch: Partial<State>): void;
  animateTitle(id: string, title: string): void;
}

export const emptySession = (key: string, chatId: string | null = null): ChatSession => ({
  key,
  chatId,
  messages: {},
  currentLeaf: null,
  loaded: chatId === null,
  loading: false,
  error: null,
  streaming: false,
  controller: null,
  gptId: null,
  projectId: null,
});

/** Session keys that don't (yet) belong to a saved chat. */
export const isDraftKey = (key: string) => key === "new" || key === "temp" || key.startsWith("new:");

let toastId = 0;

export const useApp = create<State & Actions>((set, get) => ({
  user: null,
  models: [],
  defaultModelId: null,
  imageEnabled: false,
  webSearchMode: "auto",
  voiceCfg: { stt: "browser", tts: "browser", voices: [], ready: false },
  selectedModel: null,
  chats: [],
  chatsLoaded: false,
  projects: [],
  gpts: [],
  sessions: {},
  typingTitles: {},
  sidebarOpen: true,
  mobileNav: false,
  settingsTab: null,
  searchOpen: false,
  temporary: false,
  voiceOpen: false,
  canvas: null,
  toasts: [],
  memoriesOpen: false,
  archivedOpen: false,
  sharedLinksOpen: false,
  lightbox: null,
  voiceContext: null,

  init(user) {
    let sidebarOpen = true;
    try {
      sidebarOpen = localStorage.getItem("lgpt-sidebar") !== "closed";
    } catch {
      /* ignore */
    }
    set({ user, sidebarOpen });
  },

  async loadModels() {
    const res = await api<ModelsResponse>("/api/models");
    const user = get().user;
    const preferred = user?.prefs.defaultModel;
    const selected =
      res.models.find((m) => m.id === get().selectedModel)?.id ??
      res.models.find((m) => m.id === preferred)?.id ??
      res.defaultModel;
    set({
      models: res.models,
      defaultModelId: res.defaultModel,
      imageEnabled: res.imageEnabled,
      webSearchMode: res.webSearch,
      voiceCfg: res.voice,
      selectedModel: selected,
    });
  },

  async loadChats() {
    const chats = await api<ChatSummary[]>("/api/chats");
    set({ chats, chatsLoaded: true });
  },

  async loadProjects() {
    set({ projects: await api<Project[]>("/api/projects") });
  },

  async loadGpts() {
    set({ gpts: await api<Gpt[]>("/api/gpts") });
  },

  async setPrefs(patch) {
    const user = get().user;
    if (!user) return;
    const prefs = { ...user.prefs, ...patch };
    set({ user: { ...user, prefs } });
    try {
      const updated = await api<UserInfo>("/api/me", { method: "PATCH", body: { prefs: patch } });
      set({ user: updated });
    } catch (e) {
      set({ user });
      get().toast((e as Error).message, "error");
    }
  },

  async setName(name) {
    const updated = await api<UserInfo>("/api/me", { method: "PATCH", body: { name } });
    set({ user: updated });
  },

  upsertChat(chat) {
    set((s) => {
      const rest = s.chats.filter((c) => c.id !== chat.id);
      return { chats: [chat, ...rest].sort((a, b) => b.updatedAt - a.updatedAt) };
    });
  },

  removeChat(id) {
    set((s) => ({ chats: s.chats.filter((c) => c.id !== id) }));
  },

  async patchChat(id, patch) {
    const prev = get().chats;
    set((s) => ({
      chats: patch.archived ? s.chats.filter((c) => c.id !== id) : s.chats.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
    try {
      const updated = await api<ChatSummary>(`/api/chats/${id}`, { method: "PATCH", body: patch });
      if (!updated.archived) {
        set((s) => ({ chats: s.chats.some((c) => c.id === id) ? s.chats.map((c) => (c.id === id ? updated : c)) : [updated, ...s.chats] }));
      }
    } catch (e) {
      set({ chats: prev });
      get().toast((e as Error).message, "error");
    }
  },

  async deleteChat(id) {
    const prev = get().chats;
    set((s) => ({ chats: s.chats.filter((c) => c.id !== id) }));
    try {
      await api(`/api/chats/${id}`, { method: "DELETE" });
      get().dropSession(id);
    } catch (e) {
      set({ chats: prev });
      get().toast((e as Error).message, "error");
    }
  },

  session(key) {
    return get().sessions[key] ?? emptySession(key, isDraftKey(key) ? null : key);
  },

  updateSession(key, fn) {
    set((s) => {
      const cur = s.sessions[key] ?? emptySession(key, isDraftKey(key) ? null : key);
      return { sessions: { ...s.sessions, [key]: { ...cur, ...fn(cur) } } };
    });
  },

  renameSession(from, to, chatId) {
    set((s) => {
      const cur = s.sessions[from];
      if (!cur) return {};
      const next = { ...s.sessions };
      delete next[from];
      next[to] = { ...cur, key: to, chatId, loaded: true };
      return { sessions: next };
    });
  },

  dropSession(key) {
    set((s) => {
      const next = { ...s.sessions };
      next[key]?.controller?.abort();
      delete next[key];
      return { sessions: next };
    });
  },

  toast(text, kind = "info") {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => get().dismissToast(id), kind === "error" ? 6000 : 3500);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  set(patch) {
    set(patch);
  },

  animateTitle(id, title) {
    let i = 0;
    const step = () => {
      i += 1;
      set((s) => ({ typingTitles: { ...s.typingTitles, [id]: title.slice(0, i) } }));
      if (i < title.length) setTimeout(step, 28);
      else
        setTimeout(() => {
          set((s) => {
            const t = { ...s.typingTitles };
            delete t[id];
            return { typingTitles: t };
          });
        }, 50);
    };
    step();
  },
}));

export function applyTheme(theme: UserPrefs["theme"], accent: UserPrefs["accent"]) {
  try {
    localStorage.setItem("lgpt-theme", theme);
    localStorage.setItem("lgpt-accent", accent);
  } catch {
    /* ignore */
  }
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  if (accent === "default") delete root.dataset.accent;
  else root.dataset.accent = accent;
}
