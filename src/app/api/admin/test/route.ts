import { z } from "zod";
import { generateText, APICallError } from "ai";
import { handler, json, readJson, badRequest } from "@/lib/server/http";
import { getConfig, getSecrets } from "@/lib/server/settings";
import { languageModel } from "@/lib/server/providers";

/** Sends a tiny test prompt to a model so admins can check a key/model works. */
export const POST = handler(
  async (req) => {
    const { id } = z.object({ id: z.string().max(100) }).parse(await readJson(req));
    const [config, secrets] = await Promise.all([getConfig(), getSecrets()]);
    const cfg = config.models.find((m) => m.id === id);
    if (!cfg) throw badRequest("Unknown model");
    const started = Date.now();
    try {
      const { text } = await generateText({
        model: languageModel(cfg, secrets),
        prompt: "Reply with exactly: Hello from LuckyGPT!",
        maxOutputTokens: cfg.provider === "custom" ? undefined : cfg.capabilities.reasoning ? 2000 : 30,
        ...(cfg.capabilities.reasoning ? { reasoning: "low" as const } : {}),
        providerOptions: cfg.provider === "openai" ? { openai: { store: false } } : undefined,
        abortSignal: AbortSignal.timeout(45_000),
        maxRetries: 0,
      });
      return json({ ok: true, text: text.slice(0, 200), ms: Date.now() - started });
    } catch (err) {
      const status = APICallError.isInstance(err) ? err.statusCode : undefined;
      const message = err instanceof Error ? err.message : String(err);
      return json({ ok: false, error: `${status ? `(${status}) ` : ""}${message}`.slice(0, 400) });
    }
  },
  { auth: "admin" },
);
