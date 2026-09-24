import { z } from "zod";
import { handler, json } from "@/lib/server/http";
import { getSecrets } from "@/lib/server/settings";
import { listOpenRouterModels, listRemoteModels } from "@/lib/server/admin";

export const GET = handler(
  async (req) => {
    const kind = req.nextUrl.searchParams.get("kind");
    if (kind === "tts" || kind === "stt" || kind === "vision") return json(await listOpenRouterModels(kind));
    const provider = z
      .enum(["openai", "anthropic", "google", "openrouter", "custom"])
      .parse(req.nextUrl.searchParams.get("provider"));
    const customId = req.nextUrl.searchParams.get("customId") ?? undefined;
    return json(await listRemoteModels(provider, await getSecrets(), customId));
  },
  { auth: "admin" },
);
