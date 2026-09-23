import { handler, json, readJson, badRequest } from "@/lib/server/http";
import { getConfig, getSecrets, maskKey, saveConfig } from "@/lib/server/settings";
import { appConfigSchema } from "@/lib/server/admin";

async function view() {
  const [config, secrets] = await Promise.all([getConfig(), getSecrets()]);
  return {
    config,
    keys: {
      openai: maskKey(secrets.openai?.apiKey),
      anthropic: maskKey(secrets.anthropic?.apiKey),
      google: maskKey(secrets.google?.apiKey),
      openrouter: maskKey(secrets.openrouter?.apiKey),
      groq: maskKey(secrets.groq?.apiKey),
      elevenlabs: maskKey(secrets.elevenlabs?.apiKey),
    },
    custom: (secrets.custom ?? []).map((c) => ({ id: c.id, name: c.name, baseURL: c.baseURL, key: maskKey(c.apiKey) })),
  };
}

export const GET = handler(async () => json(await view()), { auth: "admin" });

export const PUT = handler(
  async (req) => {
    const config = appConfigSchema.parse(await readJson(req, 2_000_000));
    const ids = new Set<string>();
    for (const m of config.models) {
      if (ids.has(m.id)) throw badRequest(`Two models share the id "${m.id}".`);
      ids.add(m.id);
    }
    await saveConfig(config);
    return json(await view());
  },
  { auth: "admin" },
);
