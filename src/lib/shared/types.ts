// Types shared by the server and the browser. Never put secrets in these.

export type ProviderKind = "openai" | "anthropic" | "google" | "openrouter" | "custom";

export interface ModelCapabilities {
  vision: boolean;
  pdf: boolean;
  tools: boolean;
  reasoning: boolean;
  webSearch: boolean;
  imageOutput: boolean;
}

/** A chat model as the browser sees it. */
export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  provider: ProviderKind;
  providerLabel: string;
  capabilities: ModelCapabilities;
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
}

export interface Source {
  url: string;
  title?: string;
}

export interface Activity {
  id: string;
  kind: "search" | "image" | "memory" | "canvas" | "tool";
  label: string;
  status: "running" | "done" | "error";
}

export interface Canvas {
  id: string;
  title: string;
  kind: "document" | "code";
  language?: string;
  content: string;
}

export interface MessageBody {
  text: string;
  reasoning?: string;
  reasoningMs?: number;
  attachments?: Attachment[];
  images?: Attachment[];
  sources?: Source[];
  activity?: Activity[];
  canvas?: Canvas;
  error?: string;
  voice?: boolean;
  tools?: ToolToggles;
}

export type MessageStatus = "done" | "streaming" | "stopped" | "error";

export interface ChatMessage extends MessageBody {
  id: string;
  parentId: string | null;
  role: "user" | "assistant";
  model?: string | null;
  modelName?: string | null;
  status: MessageStatus;
  feedback?: number | null;
  createdAt: number;
}

export interface ChatSummary {
  id: string;
  title: string;
  projectId: string | null;
  gptId: string | null;
  pinned: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ChatDetail extends ChatSummary {
  currentLeaf: string | null;
  messages: ChatMessage[];
}

export interface ToolToggles {
  search?: boolean;
  image?: boolean;
  think?: boolean;
  research?: boolean;
  study?: boolean;
  canvas?: boolean;
}

export type Personality = "default" | "cynic" | "robot" | "listener" | "nerd";

export interface UserPrefs {
  theme: "system" | "light" | "dark";
  accent: "default" | "blue" | "green" | "yellow" | "pink" | "orange" | "purple";
  defaultModel: string | null;
  voice: string;
  spokenLanguage: string;
  personality: Personality;
  customInstructions: {
    enabled: boolean;
    nickname: string;
    occupation: string;
    traits: string;
    about: string;
  };
  memoryEnabled: boolean;
  followUps: boolean;
  autoReadAloud?: boolean;
}

export const DEFAULT_PREFS: UserPrefs = {
  theme: "system",
  accent: "default",
  defaultModel: null,
  voice: "default",
  spokenLanguage: "auto",
  personality: "default",
  customInstructions: { enabled: true, nickname: "", occupation: "", traits: "", about: "" },
  memoryEnabled: true,
  followUps: true,
};

export interface UserInfo {
  id: string;
  username: string;
  name: string;
  role: "admin" | "user";
  totpEnabled: boolean;
  prefs: UserPrefs;
}

export interface Project {
  id: string;
  name: string;
  instructions: string;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface Gpt {
  id: string;
  name: string;
  description: string;
  instructions: string;
  starters: string[];
  icon: string;
  color: string;
  modelId: string | null;
  capabilities: { search: boolean; image: boolean };
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Memory {
  id: string;
  content: string;
  createdAt: number;
}

export interface FileInfo extends Attachment {
  kind: string;
  createdAt: number;
  chatId?: string | null;
}

export interface VoiceClientConfig {
  stt: "browser" | "server";
  tts: "browser" | "server";
  voices: { id: string; name: string }[];
  ready: boolean;
}

/** Newline-delimited JSON events streamed from /api/chat. */
export type StreamEvent =
  | { type: "meta"; chatId: string; userMessage: ChatMessage | null; assistantMessage: ChatMessage }
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "reasoning-done"; ms: number }
  | { type: "source"; source: Source }
  | { type: "activity"; activity: Activity }
  | { type: "image"; image: Attachment }
  | { type: "canvas"; canvas: Canvas }
  | { type: "title"; chatId: string; title: string }
  | { type: "error"; message: string }
  /** A failed attempt is being retried: clear what was streamed so far. */
  | { type: "reset" }
  | { type: "done"; status: MessageStatus };

/** Usage shown in the profile menu (only when OpenRouter models are in use). */
export interface UsageInfo {
  openrouter: boolean;
  /** Dollars spent vs. the key's limit or the account's credits, when OpenRouter reports it. */
  credits: { used: number; total: number; label: string } | null;
  /** OpenRouter prompts sent today (UTC) vs. the 1000/day free-model limit. */
  prompts: { used: number; total: number; resetsAt: number } | null;
}
