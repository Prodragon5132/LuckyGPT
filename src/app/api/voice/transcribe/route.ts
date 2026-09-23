import { transcribe } from "ai";
import { handler, json, HttpError, badRequest } from "@/lib/server/http";
import { getConfig, getSecrets } from "@/lib/server/settings";
import { transcriptionModel } from "@/lib/server/providers";
import { loadUserInfo } from "@/lib/server/auth";
import { consume } from "@/lib/server/ratelimit";

export const maxDuration = 60;

const MAX_AUDIO = 4 * 1024 * 1024;

export const POST = handler(async (req, { user }) => {
  const wait = await consume(`stt:${user.id}`, 60_000, 60);
  if (wait) throw new HttpError(429, "Too many voice requests. Wait a moment.");
  const [config, secrets, info] = await Promise.all([getConfig(), getSecrets(), loadUserInfo(user.id)]);
  const model = transcriptionModel(config, secrets);
  if (!model) throw new HttpError(400, "Speech-to-text isn't set up on the server. Using the browser instead.");
  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof File)) throw badRequest("No audio received.");
  if (audio.size > MAX_AUDIO) throw new HttpError(413, "That recording is too long.");
  if (audio.size < 1000) return json({ text: "" });
  const lang = info?.prefs.spokenLanguage && info.prefs.spokenLanguage !== "auto" ? info.prefs.spokenLanguage : undefined;
  const provider = config.voice.stt.provider;
  const result = await transcribe({
    model,
    audio: new Uint8Array(await audio.arrayBuffer()),
    providerOptions: lang && (provider === "openai" || provider === "groq") ? { [provider]: { language: lang } } : undefined,
    abortSignal: AbortSignal.timeout(45_000),
    maxRetries: 1,
  });
  return json({ text: result.text.trim() });
});
