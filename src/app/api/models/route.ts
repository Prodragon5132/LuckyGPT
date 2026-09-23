import { handler, json } from "@/lib/server/http";
import { getConfig, getSecrets } from "@/lib/server/settings";
import { enabledModels, imageModel, speechModel, toModelInfo, transcriptionModel, ttsVoices } from "@/lib/server/providers";
import type { VoiceClientConfig } from "@/lib/shared/types";

export const GET = handler(async () => {
  const [config, secrets] = await Promise.all([getConfig(), getSecrets()]);
  const models = enabledModels(config, secrets).map((m) => toModelInfo(m, secrets));
  const stt = config.voice.stt.provider !== "browser" && transcriptionModel(config, secrets) ? "server" : "browser";
  const tts = config.voice.tts.provider !== "browser" && speechModel(config, secrets) ? "server" : "browser";
  const voice: VoiceClientConfig = {
    stt,
    tts,
    voices: tts === "server" ? ttsVoices(config) : [],
    ready: models.length > 0,
  };
  return json({
    models,
    defaultModel: models.find((m) => m.id === config.defaultModel)?.id ?? models[0]?.id ?? null,
    imageEnabled: !!imageModel(config, secrets),
    webSearch: config.webSearch,
    voice,
  });
});
