import "server-only";
import type { LanguageModel, ImageModel, SpeechModel, TranscriptionModel, ToolSet } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGroq } from "@ai-sdk/groq";
import { createElevenLabs } from "@ai-sdk/elevenlabs";
import { HttpError } from "./http";
import type { AppConfig, CustomEndpoint, ModelConfig, ProviderSecrets } from "./settings";
import { providerLabel } from "./settings";
import type { ModelInfo } from "@/lib/shared/types";

function missingKey(name: string): never {
  throw new HttpError(
    400,
    `No ${name} API key is set yet. An admin can add one in Settings → API keys.`,
  );
}

function customEndpoint(secrets: ProviderSecrets, id?: string): CustomEndpoint {
  const ep = secrets.custom?.find((c) => c.id === id);
  if (!ep) throw new HttpError(400, "This model's custom endpoint was removed. Pick another model.");
  return ep;
}

export function languageModel(cfg: ModelConfig, secrets: ProviderSecrets, opts: { webSearch?: boolean } = {}): LanguageModel {
  switch (cfg.provider) {
    case "openai": {
      const key = secrets.openai?.apiKey || missingKey("OpenAI");
      return createOpenAI({ apiKey: key }).responses(cfg.modelId);
    }
    case "anthropic": {
      const key = secrets.anthropic?.apiKey || missingKey("Anthropic");
      return createAnthropic({ apiKey: key })(cfg.modelId);
    }
    case "google": {
      const key = secrets.google?.apiKey || missingKey("Google Gemini");
      return createGoogleGenerativeAI({ apiKey: key })(cfg.modelId);
    }
    case "openrouter": {
      const key = secrets.openrouter?.apiKey || missingKey("OpenRouter");
      const provider = createOpenRouter({ apiKey: key, appName: "LuckyGPT" } as Parameters<typeof createOpenRouter>[0]);
      return provider(cfg.modelId, opts.webSearch ? { extraBody: { plugins: [{ id: "web" }] } } : undefined);
    }
    case "custom": {
      const ep = customEndpoint(secrets, cfg.customId);
      return createOpenAICompatible({
        name: "custom",
        baseURL: ep.baseURL.replace(/\/+$/, ""),
        apiKey: ep.apiKey || undefined,
      }).chatModel(cfg.modelId);
    }
  }
}

export type ThinkLevel = "auto" | "high";

/** Anthropic models that use adaptive thinking (Claude 4.6 and newer). */
function anthropicAdaptive(modelId: string): boolean {
  return /claude-(opus|sonnet)-4-[6-9]|claude-(opus|sonnet|haiku|fable|mythos)-[5-9]|fable|mythos/.test(modelId);
}

function anthropicAlwaysThinks(modelId: string): boolean {
  return /opus-5-5|fable|mythos/.test(modelId);
}

function geminiGen3(modelId: string): boolean {
  return /gemini-([3-9]|\d{2})/.test(modelId);
}

/**
 * Reasoning ("Thinking") settings per provider. "auto" lets the model decide
 * how much to think (like ChatGPT's Auto); "high" is the Thinking tool.
 */
export function reasoningOptions(cfg: ModelConfig, level: ThinkLevel): Record<string, Record<string, unknown>> {
  if (!cfg.capabilities.reasoning) return {};
  const id = cfg.modelId.toLowerCase();
  switch (cfg.provider) {
    case "openai":
      return {
        openai: {
          reasoningSummary: "auto",
          ...(level === "high" ? { reasoningEffort: "high" } : {}),
        },
      };
    case "anthropic":
      if (anthropicAdaptive(id)) {
        return {
          anthropic: {
            thinking: { type: "adaptive", display: "summarized" },
            ...(level === "high" ? { effort: "high" } : anthropicAlwaysThinks(id) ? { effort: "medium" } : {}),
          },
        };
      }
      return level === "high" ? { anthropic: { thinking: { type: "enabled", budgetTokens: 8000 } } } : {};
    case "google":
      if (geminiGen3(id)) {
        return { google: { thinkingConfig: { includeThoughts: true, ...(level === "high" ? { thinkingLevel: "high" } : {}) } } };
      }
      return {
        google: { thinkingConfig: { includeThoughts: true, ...(level === "high" ? { thinkingBudget: 16000 } : {}) } },
      };
    case "openrouter":
      return level === "high" ? { openrouter: { reasoning: { effort: "high" } } } : {};
    default:
      return {};
  }
}

/** Native web search tool for the model's provider (the provider runs the search). */
export function webSearchTools(cfg: ModelConfig, secrets: ProviderSecrets): ToolSet {
  if (!cfg.capabilities.webSearch) return {};
  switch (cfg.provider) {
    case "openai": {
      const openai = createOpenAI({ apiKey: secrets.openai?.apiKey || "missing" });
      return { web_search: openai.tools.webSearch({ searchContextSize: "medium" }) } as ToolSet;
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey: secrets.anthropic?.apiKey || "missing" });
      const modern = anthropicAdaptive(cfg.modelId.toLowerCase());
      return {
        web_search: modern
          ? anthropic.tools.webSearch_20260209({ maxUses: 5 })
          : anthropic.tools.webSearch_20250305({ maxUses: 5 }),
      } as ToolSet;
    }
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey: secrets.google?.apiKey || "missing" });
      return { google_search: google.tools.googleSearch({}) } as ToolSet;
    }
    default:
      return {};
  }
}

/** Gemini 2.x can't mix Google Search with our own function tools. */
export function canMixSearchAndFunctions(cfg: ModelConfig): boolean {
  return !(cfg.provider === "google" && !geminiGen3(cfg.modelId.toLowerCase()));
}

export function providerOptionsFor(cfg: ModelConfig, level: ThinkLevel, userId: string): Record<string, Record<string, unknown>> {
  const base = reasoningOptions(cfg, level);
  if (cfg.provider === "openai") {
    // store:false keeps conversations out of OpenAI's dashboard/logs retention.
    base.openai = {
      ...(base.openai ?? {}),
      store: false,
      ...(cfg.capabilities.reasoning ? { include: ["reasoning.encrypted_content"] } : {}),
    };
  }
  if (cfg.provider === "openrouter") {
    base.openrouter = { ...(base.openrouter ?? {}), user: userId.slice(0, 8) };
  }
  return base;
}

export function toModelInfo(cfg: ModelConfig, secrets: ProviderSecrets): ModelInfo {
  const custom = cfg.provider === "custom" ? secrets.custom?.find((c) => c.id === cfg.customId) : undefined;
  return {
    id: cfg.id,
    name: cfg.name,
    description: cfg.description,
    provider: cfg.provider,
    providerLabel: providerLabel(cfg.provider, custom),
    capabilities: cfg.capabilities,
  };
}

export function isProviderReady(cfg: ModelConfig, secrets: ProviderSecrets): boolean {
  switch (cfg.provider) {
    case "custom":
      return !!secrets.custom?.some((c) => c.id === cfg.customId);
    default:
      return !!secrets[cfg.provider]?.apiKey;
  }
}

export function enabledModels(config: AppConfig, secrets: ProviderSecrets): ModelConfig[] {
  return config.models.filter((m) => m.enabled && isProviderReady(m, secrets));
}

export function resolveModel(config: AppConfig, secrets: ProviderSecrets, requested?: string | null): ModelConfig {
  const models = enabledModels(config, secrets);
  if (!models.length) {
    throw new HttpError(400, "No models are set up yet. An admin needs to add an API key in Settings → API keys.");
  }
  return (
    models.find((m) => m.id === requested) ??
    models.find((m) => m.id === config.defaultModel) ??
    models[0]
  );
}

/** The small model used for titles, memory, and other background jobs. */
export function resolveTaskModel(config: AppConfig, secrets: ProviderSecrets, fallback: ModelConfig): ModelConfig {
  const models = enabledModels(config, secrets);
  return models.find((m) => m.id === config.taskModel) ?? fallback;
}

export function imageModel(config: AppConfig, secrets: ProviderSecrets): ImageModel | null {
  const { provider, modelId } = config.image;
  if (!modelId) return null;
  switch (provider) {
    case "openai":
      return secrets.openai?.apiKey ? createOpenAI({ apiKey: secrets.openai.apiKey }).image(modelId) : null;
    case "google":
      return secrets.google?.apiKey ? createGoogleGenerativeAI({ apiKey: secrets.google.apiKey }).image(modelId) : null;
    case "openrouter":
      return secrets.openrouter?.apiKey ? createOpenRouter({ apiKey: secrets.openrouter.apiKey }).imageModel(modelId) : null;
    default:
      return null;
  }
}

export function transcriptionModel(config: AppConfig, secrets: ProviderSecrets): TranscriptionModel | null {
  const { provider, model } = config.voice.stt;
  switch (provider) {
    case "openai":
      return secrets.openai?.apiKey
        ? createOpenAI({ apiKey: secrets.openai.apiKey }).transcription(model || "gpt-4o-mini-transcribe")
        : null;
    case "groq":
      return secrets.groq?.apiKey
        ? createGroq({ apiKey: secrets.groq.apiKey }).transcription(model || "whisper-large-v3-turbo")
        : null;
    case "google":
      return secrets.google?.apiKey
        ? createGoogleGenerativeAI({ apiKey: secrets.google.apiKey }).transcription(model || "gemini-3.5-transcribe")
        : null;
    case "elevenlabs":
      return secrets.elevenlabs?.apiKey
        ? createElevenLabs({ apiKey: secrets.elevenlabs.apiKey }).transcription(model || "scribe_v2")
        : null;
    default:
      return null;
  }
}

export function speechModel(config: AppConfig, secrets: ProviderSecrets): SpeechModel | null {
  const { provider, model } = config.voice.tts;
  switch (provider) {
    case "openai":
      return secrets.openai?.apiKey ? createOpenAI({ apiKey: secrets.openai.apiKey }).speech(model || "gpt-4o-mini-tts") : null;
    case "google":
      return secrets.google?.apiKey
        ? createGoogleGenerativeAI({ apiKey: secrets.google.apiKey }).speech(model || "gemini-3.1-flash-tts-preview")
        : null;
    case "elevenlabs":
      return secrets.elevenlabs?.apiKey
        ? createElevenLabs({ apiKey: secrets.elevenlabs.apiKey }).speech(model || "eleven_flash_v2_5")
        : null;
    default:
      return null;
  }
}

export const OPENAI_VOICES = ["alloy", "ash", "ballad", "cedar", "coral", "echo", "fable", "marin", "nova", "onyx", "sage", "shimmer", "verse"];
export const GEMINI_VOICES = [
  "Kore", "Puck", "Zephyr", "Charon", "Fenrir", "Leda", "Aoede", "Orus", "Callirrhoe", "Autonoe", "Enceladus",
  "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia",
  "Sadaltager", "Sulafat",
];

export function ttsVoices(config: AppConfig): { id: string; name: string }[] {
  switch (config.voice.tts.provider) {
    case "openai":
      return OPENAI_VOICES.map((v) => ({ id: v, name: v[0].toUpperCase() + v.slice(1) }));
    case "google":
      return GEMINI_VOICES.map((v) => ({ id: v, name: v }));
    case "elevenlabs":
      return parseElevenVoices(config.voice.tts.elevenVoices);
    default:
      return [];
  }
}

/** "Rachel=21m00Tcm4TlvDq8ikWAM, Adam=pNInz6obpgDQGcFmaJgB" → list */
export function parseElevenVoices(raw: string): { id: string; name: string }[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, id] = entry.includes("=") ? entry.split("=").map((s) => s.trim()) : [entry, entry];
      return { id: id || name, name: name || id };
    })
    .filter((v) => /^[A-Za-z0-9_-]{2,64}$/.test(v.id));
}
