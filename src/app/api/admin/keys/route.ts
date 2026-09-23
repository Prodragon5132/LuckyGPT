import { z } from "zod";
import { handler, json, readJson, badRequest } from "@/lib/server/http";
import {
  getConfig,
  getSecrets,
  guessCapabilities,
  maskKey,
  saveConfig,
  saveSecrets,
  SUGGESTED_MODELS,
  type ModelConfig,
} from "@/lib/server/settings";
import { newId } from "@/lib/server/crypto";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set"),
    provider: z.enum(["openai", "anthropic", "google", "openrouter", "groq", "elevenlabs"]),
    apiKey: z.string().trim().min(8).max(500),
  }),
  z.object({
    action: z.literal("remove"),
    provider: z.enum(["openai", "anthropic", "google", "openrouter", "groq", "elevenlabs"]),
  }),
  z.object({
    action: z.literal("addCustom"),
    name: z.string().trim().min(1).max(60),
    baseURL: z.string().trim().url().max(500),
    apiKey: z.string().trim().max(500).optional(),
  }),
  z.object({ action: z.literal("removeCustom"), id: z.string().max(64) }),
]);

export const PUT = handler(
  async (req) => {
    const body = schema.parse(await readJson(req));
    const secrets = await getSecrets();
    const config = await getConfig();
    let addedModels = 0;

    if (body.action === "set") {
      if (/\s/.test(body.apiKey)) throw badRequest("API keys can't contain spaces.");
      secrets[body.provider] = { apiKey: body.apiKey };
      // First key for a chat provider? Add a few good default models so it works right away.
      if (body.provider in SUGGESTED_MODELS && !config.models.some((m) => m.provider === body.provider)) {
        const provider = body.provider as keyof typeof SUGGESTED_MODELS;
        for (const s of SUGGESTED_MODELS[provider]) {
          const m: ModelConfig = {
            id: `${provider}:${s.modelId}`,
            provider,
            modelId: s.modelId,
            name: s.name,
            description: s.description,
            enabled: true,
            capabilities: guessCapabilities(provider, s.modelId),
          };
          config.models.push(m);
          addedModels++;
        }
        config.defaultModel ??= config.models[0]?.id ?? null;
      }
      // Sensible voice defaults when possible.
      if (body.provider === "openai") {
        if (config.voice.stt.provider === "browser") config.voice.stt = { provider: "openai", model: "gpt-4o-mini-transcribe" };
        if (config.voice.tts.provider === "browser")
          config.voice.tts = { ...config.voice.tts, provider: "openai", model: "gpt-4o-mini-tts", defaultVoice: "marin" };
        if (config.image.provider === "none") config.image = { provider: "openai", modelId: "gpt-image-1.5" };
      }
      if (body.provider === "groq" && config.voice.stt.provider === "browser") {
        config.voice.stt = { provider: "groq", model: "whisper-large-v3-turbo" };
      }
      if (body.provider === "google" && config.image.provider === "none") {
        config.image = { provider: "google", modelId: "gemini-2.5-flash-image" };
      }
    } else if (body.action === "remove") {
      delete secrets[body.provider];
    } else if (body.action === "addCustom") {
      if (!/^https?:\/\//.test(body.baseURL)) throw badRequest("The URL must start with http:// or https://");
      secrets.custom = [...(secrets.custom ?? []), { id: newId().slice(0, 8), name: body.name, baseURL: body.baseURL, apiKey: body.apiKey || undefined }];
    } else if (body.action === "removeCustom") {
      secrets.custom = (secrets.custom ?? []).filter((c) => c.id !== body.id);
      config.models = config.models.filter((m) => !(m.provider === "custom" && m.customId === body.id));
    }

    await saveSecrets(secrets);
    await saveConfig(config);
    return json({
      ok: true,
      addedModels,
      keys: {
        openai: maskKey(secrets.openai?.apiKey),
        anthropic: maskKey(secrets.anthropic?.apiKey),
        google: maskKey(secrets.google?.apiKey),
        openrouter: maskKey(secrets.openrouter?.apiKey),
        groq: maskKey(secrets.groq?.apiKey),
        elevenlabs: maskKey(secrets.elevenlabs?.apiKey),
      },
      custom: (secrets.custom ?? []).map((c) => ({ id: c.id, name: c.name, baseURL: c.baseURL, key: maskKey(c.apiKey) })),
      config,
    });
  },
  { auth: "admin" },
);
