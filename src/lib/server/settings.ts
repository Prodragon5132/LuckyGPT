import "server-only";
import { query, queryOne } from "./db";
import { decryptJson, encryptJson } from "./crypto";
import type { ModelCapabilities, ProviderKind } from "@/lib/shared/types";

/**
 * App-wide settings managed by admins in Settings → Admin.
 * API keys live ONLY here: encrypted in the database, never in code, never
 * sent back to the browser (only "set / not set" and the last 4 characters).
 */

export type SecretProvider = "openai" | "anthropic" | "google" | "openrouter" | "openrouterChat" | "groq" | "elevenlabs";

export interface CustomEndpoint {
  id: string;
  name: string;
  baseURL: string;
  apiKey?: string;
}

export interface ProviderSecrets {
  openai?: { apiKey: string };
  anthropic?: { apiKey: string };
  google?: { apiKey: string };
  openrouter?: { apiKey: string };
  /** Optional second OpenRouter key used only for chat models (voice and images use the main one). */
  openrouterChat?: { apiKey: string };
  groq?: { apiKey: string };
  elevenlabs?: { apiKey: string };
  custom?: CustomEndpoint[];
}

export interface ModelConfig {
  id: string;
  provider: ProviderKind;
  customId?: string;
  modelId: string;
  name: string;
  description: string;
  enabled: boolean;
  capabilities: ModelCapabilities;
}

export type SttProvider = "browser" | "openai" | "groq" | "google" | "openrouter" | "elevenlabs";
export type TtsProvider = "browser" | "openai" | "google" | "openrouter" | "elevenlabs";

export interface AppConfig {
  models: ModelConfig[];
  defaultModel: string | null;
  /** Small, cheap model for titles and background jobs. */
  taskModel: string | null;
  /**
   * Helper that looks at images for chat models that can't see: "" (off), the id of a
   * configured vision model, or "openrouter:<model id>" for any OpenRouter model.
   */
  visionHelper: string;
  image: { provider: "none" | "openai" | "google" | "openrouter"; modelId: string };
  voice: {
    chatModel: string | null;
    stt: { provider: SttProvider; model: string };
    tts: { provider: TtsProvider; model: string; defaultVoice: string; elevenVoices: string };
  };
  webSearch: "auto" | "manual";
  maxOutputTokens: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  models: [],
  defaultModel: null,
  taskModel: null,
  visionHelper: "",
  image: { provider: "none", modelId: "" },
  voice: {
    chatModel: null,
    stt: { provider: "browser", model: "" },
    tts: { provider: "browser", model: "", defaultVoice: "", elevenVoices: "" },
  },
  webSearch: "auto",
  maxOutputTokens: 16000,
};

async function readSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await queryOne<{ value: string }>(`SELECT value FROM settings WHERE key = $1`, [key]);
  return row ? decryptJson<T>(row.value, fallback, `setting:${key}`) : fallback;
}

async function writeSetting(key: string, value: unknown): Promise<void> {
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [key, encryptJson(value, `setting:${key}`), Date.now()],
  );
}

export async function getSecrets(): Promise<ProviderSecrets> {
  return readSetting<ProviderSecrets>("secrets", {});
}

export async function saveSecrets(secrets: ProviderSecrets): Promise<void> {
  await writeSetting("secrets", secrets);
}

export async function getConfig(): Promise<AppConfig> {
  const stored = await readSetting<Partial<AppConfig>>("config", {});
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    image: { ...DEFAULT_CONFIG.image, ...(stored.image ?? {}) },
    voice: {
      ...DEFAULT_CONFIG.voice,
      ...(stored.voice ?? {}),
      stt: { ...DEFAULT_CONFIG.voice.stt, ...(stored.voice?.stt ?? {}) },
      tts: { ...DEFAULT_CONFIG.voice.tts, ...(stored.voice?.tts ?? {}) },
    },
    models: stored.models ?? [],
  };
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await writeSetting("config", config);
}

export function maskKey(key: string | undefined): string | null {
  if (!key) return null;
  return key.length <= 8 ? "••••" : `••••${key.slice(-4)}`;
}

/** "set / not set" plus the last 4 characters for each key — the only thing the browser ever sees. */
export function maskedKeys(secrets: ProviderSecrets): Record<SecretProvider, string | null> {
  return {
    openai: maskKey(secrets.openai?.apiKey),
    anthropic: maskKey(secrets.anthropic?.apiKey),
    google: maskKey(secrets.google?.apiKey),
    openrouter: maskKey(secrets.openrouter?.apiKey),
    openrouterChat: maskKey(secrets.openrouterChat?.apiKey),
    groq: maskKey(secrets.groq?.apiKey),
    elevenlabs: maskKey(secrets.elevenlabs?.apiKey),
  };
}

export function providerLabel(provider: ProviderKind, custom?: CustomEndpoint): string {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "google":
      return "Google";
    case "openrouter":
      return "OpenRouter";
    default:
      return custom?.name || "Custom";
  }
}

/** Best-guess capabilities for a model ID. Admins can override them in settings. */
export function guessCapabilities(provider: ProviderKind, modelId: string): ModelCapabilities {
  const id = modelId.toLowerCase();
  switch (provider) {
    case "openai": {
      const chatOnly = id.includes("chat-latest");
      const reasoning = /^(o\d|gpt-5|gpt-6|gpt-7)/.test(id) && !chatOnly;
      return {
        vision: !/^gpt-3\.5/.test(id),
        pdf: !/^gpt-3\.5/.test(id),
        tools: !chatOnly && !/^gpt-3\.5/.test(id),
        reasoning,
        webSearch: !chatOnly && !/nano|^gpt-3\.5/.test(id),
        imageOutput: false,
      };
    }
    case "anthropic":
      return { vision: true, pdf: true, tools: true, reasoning: !/claude-3-(5-)?haiku|claude-3-opus/.test(id), webSearch: true, imageOutput: false };
    case "google": {
      const image = id.includes("image");
      return {
        vision: true,
        pdf: true,
        tools: !image && !id.includes("tts"),
        reasoning: /gemini-(2\.5|[3-9])/.test(id) && !image,
        webSearch: !id.includes("tts"),
        imageOutput: image,
      };
    }
    case "openrouter":
      return { vision: false, pdf: false, tools: true, reasoning: false, webSearch: true, imageOutput: false };
    default:
      return { vision: false, pdf: false, tools: false, reasoning: false, webSearch: false, imageOutput: false };
  }
}

/** Suggested starter models, used when an admin saves a key for a provider the first time. */
export const SUGGESTED_MODELS: Record<"openai" | "anthropic" | "google" | "openrouter", { modelId: string; name: string; description: string }[]> = {
  openai: [
    { modelId: "gpt-5.5", name: "GPT-5.5", description: "Great for most tasks" },
    { modelId: "gpt-5.4-mini", name: "GPT-5.4 mini", description: "Faster for everyday tasks" },
  ],
  anthropic: [
    { modelId: "claude-opus-5", name: "Claude Opus 5", description: "Anthropic's powerful model" },
    { modelId: "claude-sonnet-5", name: "Claude Sonnet 5", description: "Smart and fast" },
    { modelId: "claude-haiku-4-5", name: "Claude Haiku 4.5", description: "Fastest Claude" },
  ],
  google: [
    { modelId: "gemini-3.8-flash", name: "Gemini 3.8 Flash", description: "Google's fast, smart model" },
    { modelId: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite", description: "Cheapest and fastest" },
  ],
  openrouter: [
    { modelId: "openrouter/auto", name: "OpenRouter Auto", description: "Picks a model for each prompt" },
  ],
};
