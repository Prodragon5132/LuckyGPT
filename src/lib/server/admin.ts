import "server-only";
import { z } from "zod";
import { HttpError } from "./http";
import { guessCapabilities, type ProviderSecrets } from "./settings";
import type { ModelCapabilities, ProviderKind } from "@/lib/shared/types";

const caps = z.object({
  vision: z.boolean(),
  pdf: z.boolean(),
  tools: z.boolean(),
  reasoning: z.boolean(),
  webSearch: z.boolean(),
  imageOutput: z.boolean(),
});

export const modelConfigSchema = z.object({
  id: z.string().min(1).max(100).regex(/^[A-Za-z0-9._:/-]+$/),
  provider: z.enum(["openai", "anthropic", "google", "openrouter", "custom"]),
  customId: z.string().max(64).optional(),
  modelId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(200).default(""),
  enabled: z.boolean(),
  capabilities: caps,
});

export const appConfigSchema = z.object({
  models: z.array(modelConfigSchema).max(200),
  defaultModel: z.string().max(100).nullable(),
  taskModel: z.string().max(100).nullable(),
  visionHelper: z
    .string()
    .max(220)
    .regex(/^[A-Za-z0-9._:/@-]*$/, "The image model ID can only contain letters, numbers and . _ : / @ -")
    .default("")
    .transform((v) => (v === "openrouter:" ? "" : v)),
  image: z.object({
    provider: z.enum(["none", "openai", "google", "openrouter"]),
    modelId: z.string().max(200),
  }),
  voice: z.object({
    chatModel: z.string().max(100).nullable(),
    stt: z.object({ provider: z.enum(["browser", "openai", "groq", "google", "openrouter", "elevenlabs"]), model: z.string().max(200) }),
    tts: z.object({
      provider: z.enum(["browser", "openai", "google", "openrouter", "elevenlabs"]),
      model: z.string().max(200),
      defaultVoice: z.string().max(100),
      elevenVoices: z.string().max(4000),
    }),
  }),
  webSearch: z.enum(["auto", "manual"]),
  maxOutputTokens: z.number().int().min(256).max(200_000),
});

export interface RemoteModel {
  modelId: string;
  name: string;
  description?: string;
  capabilities: ModelCapabilities;
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (res.status === 401 || res.status === 403) throw new HttpError(400, "The API key was rejected by the provider.");
  if (!res.ok) throw new HttpError(502, `The provider returned ${res.status} when listing models.`);
  return res.json();
}

const OPENAI_EXCLUDE = /embedding|tts|whisper|transcribe|dall-e|image|audio|realtime|moderation|davinci|babbage|search|computer-use|codex|sora|-instruct/;

export function prettyName(id: string): string {
  return id
    .replace(/^models\//, "")
    .replace(/-(\d{4}-\d{2}-\d{2}|\d{8})$/, "")
    .split(/[-_]/)
    .map((w) => (/^gpt$/i.test(w) ? "GPT" : /^o\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
    .replace(/^GPT (\d)/, "GPT-$1");
}

export async function listRemoteModels(
  provider: ProviderKind,
  secrets: ProviderSecrets,
  customId?: string,
): Promise<RemoteModel[]> {
  switch (provider) {
    case "openai": {
      const key = secrets.openai?.apiKey;
      if (!key) throw new HttpError(400, "Add an OpenAI key first.");
      const data = (await getJson("https://api.openai.com/v1/models", { Authorization: `Bearer ${key}` })) as {
        data: { id: string; created: number }[];
      };
      return data.data
        .filter((m) => /^(gpt|o\d|chatgpt)/.test(m.id) && !OPENAI_EXCLUDE.test(m.id))
        .sort((a, b) => b.created - a.created)
        .map((m) => ({ modelId: m.id, name: prettyName(m.id), capabilities: guessCapabilities("openai", m.id) }));
    }
    case "anthropic": {
      const key = secrets.anthropic?.apiKey;
      if (!key) throw new HttpError(400, "Add an Anthropic key first.");
      const data = (await getJson("https://api.anthropic.com/v1/models?limit=100", {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      })) as { data: { id: string; display_name?: string }[] };
      return data.data.map((m) => ({
        modelId: m.id,
        name: m.display_name || prettyName(m.id),
        capabilities: guessCapabilities("anthropic", m.id),
      }));
    }
    case "google": {
      const key = secrets.google?.apiKey;
      if (!key) throw new HttpError(400, "Add a Google Gemini key first.");
      const data = (await getJson("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
        "x-goog-api-key": key,
      })) as { models: { name: string; displayName?: string; description?: string; supportedGenerationMethods?: string[] }[] };
      return (data.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent") && !/embedding|aqa|tts|live|native-audio/.test(m.name))
        .map((m) => {
          const id = m.name.replace(/^models\//, "");
          return {
            modelId: id,
            name: m.displayName || prettyName(id),
            description: m.description?.slice(0, 200),
            capabilities: guessCapabilities("google", id),
          };
        })
        .reverse();
    }
    case "openrouter": {
      const data = (await getJson("https://openrouter.ai/api/v1/models", {})) as {
        data: {
          id: string;
          name: string;
          description?: string;
          architecture?: { input_modalities?: string[]; output_modalities?: string[] };
          supported_parameters?: string[];
        }[];
      };
      return data.data.map((m) => {
        const input = m.architecture?.input_modalities ?? [];
        const output = m.architecture?.output_modalities ?? [];
        const params = m.supported_parameters ?? [];
        return {
          modelId: m.id,
          name: m.name,
          description: m.description?.slice(0, 200),
          capabilities: {
            vision: input.includes("image"),
            pdf: input.includes("file"),
            tools: params.includes("tools"),
            reasoning: params.includes("reasoning") || params.includes("include_reasoning"),
            webSearch: true,
            imageOutput: output.includes("image"),
          },
        };
      });
    }
    case "custom": {
      const ep = secrets.custom?.find((c) => c.id === customId);
      if (!ep) throw new HttpError(400, "Unknown custom endpoint.");
      const data = (await getJson(`${ep.baseURL.replace(/\/+$/, "")}/models`, ep.apiKey ? { Authorization: `Bearer ${ep.apiKey}` } : {})) as {
        data?: { id: string }[];
      };
      return (data.data ?? []).map((m) => ({ modelId: m.id, name: m.id, capabilities: guessCapabilities("custom", m.id) }));
    }
  }
}

export type OpenRouterKind = "tts" | "stt" | "vision";

/** Shown even if OpenRouter's live list can't be loaded. */
const OPENROUTER_KNOWN: Record<OpenRouterKind, { modelId: string; name: string }[]> = {
  tts: [
    { modelId: "google/gemini-3.1-flash-tts-preview", name: "Google: Gemini 3.1 Flash TTS Preview" },
    { modelId: "fish-audio/s2.1-pro", name: "Fish Audio: S2.1 Pro" },
    { modelId: "openai/gpt-4o-mini-tts-2025-12-15", name: "OpenAI: GPT-4o Mini TTS" },
  ],
  stt: [
    { modelId: "openai/gpt-4o-mini-transcribe", name: "OpenAI: GPT-4o Mini Transcribe" },
    { modelId: "openai/gpt-4o-transcribe", name: "OpenAI: GPT-4o Transcribe" },
    { modelId: "openai/whisper-1", name: "OpenAI: Whisper" },
  ],
  vision: [
    { modelId: "google/gemini-2.5-flash-lite", name: "Google: Gemini 2.5 Flash Lite" },
    { modelId: "google/gemini-2.5-flash", name: "Google: Gemini 2.5 Flash" },
    { modelId: "openai/gpt-4o-mini", name: "OpenAI: GPT-4o-mini" },
  ],
};

type OrModel = { id: string; name: string; architecture?: { input_modalities?: string[]; output_modalities?: string[] } };

/**
 * OpenRouter models for voice and image helpers: text-to-speech ("tts"), speech-to-text ("stt")
 * or models that can see images ("vision"). Free models are listed first.
 */
export async function listOpenRouterModels(kind: OpenRouterKind): Promise<{ modelId: string; name: string }[]> {
  let live: { modelId: string; name: string }[] = [];
  try {
    // Speech and transcription models are left out of OpenRouter's default catalog; ask for them by modality.
    const query = kind === "tts" ? "?output_modalities=speech" : kind === "stt" ? "?output_modalities=transcription" : "";
    const data = (await getJson(`https://openrouter.ai/api/v1/models${query}`, {})) as { data: OrModel[] };
    live = data.data
      .filter((m) => {
        const input = m.architecture?.input_modalities ?? [];
        const output = m.architecture?.output_modalities ?? [];
        if (kind === "vision") return input.includes("image") && output.includes("text");
        if (kind === "tts") return output.some((o) => o === "speech" || o === "audio") || /(^|[-/])tts|speech/i.test(m.id);
        return input.includes("audio") || /transcri|whisper|stt/i.test(m.id);
      })
      .map((m) => ({ modelId: m.id, name: m.name }))
      .sort((a, b) => Number(b.modelId.endsWith(":free")) - Number(a.modelId.endsWith(":free")));
  } catch {
    // Fall back to the known list below.
  }
  const seen = new Set(live.map((m) => m.modelId));
  return [...live, ...OPENROUTER_KNOWN[kind].filter((m) => !seen.has(m.modelId))];
}
