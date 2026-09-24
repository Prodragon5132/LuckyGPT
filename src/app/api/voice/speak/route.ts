import { z } from "zod";
import { generateSpeech } from "ai";
import { handler, readJson, HttpError } from "@/lib/server/http";
import { getConfig, getSecrets } from "@/lib/server/settings";
import { speechModel, ttsVoices, voiceErrorMessage } from "@/lib/server/providers";
import { consume } from "@/lib/server/ratelimit";

export const maxDuration = 60;

const schema = z.object({
  text: z.string().min(1).max(4096),
  voice: z.string().max(100).optional(),
});

export const POST = handler(async (req, { user }) => {
  const wait = await consume(`tts:${user.id}`, 60_000, 120);
  if (wait) throw new HttpError(429, "Too many voice requests. Wait a moment.");
  const body = schema.parse(await readJson(req));
  const [config, secrets] = await Promise.all([getConfig(), getSecrets()]);
  const model = speechModel(config, secrets);
  if (!model) throw new HttpError(400, "Text-to-speech isn't set up on the server.");
  const voices = ttsVoices(config);
  const voice =
    voices.find((v) => v.id === body.voice)?.id ??
    voices.find((v) => v.id === config.voice.tts.defaultVoice)?.id ??
    voices[0]?.id;
  const provider = config.voice.tts.provider;
  try {
    const result = await generateSpeech({
      model,
      text: body.text,
      voice,
      outputFormat: provider === "google" ? "wav" : "mp3",
      ...(provider === "openai" ? { instructions: "Speak in a warm, natural, conversational tone." } : {}),
      abortSignal: AbortSignal.timeout(45_000),
      maxRetries: 2, // 3 attempts in total
    });
    const audio = result.audio;
    return new Response(new Uint8Array(audio.uint8Array), {
      headers: {
        "Content-Type": audio.mediaType || (provider === "google" ? "audio/wav" : "audio/mpeg"),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[voice] text-to-speech failed", err);
    throw new HttpError(502, voiceErrorMessage(err, "Text-to-speech"));
  }
});
