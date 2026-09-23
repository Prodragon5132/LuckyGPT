import { handler, json, readJson } from "@/lib/server/http";
import { listGpts, saveGpt } from "@/lib/server/repo/misc";
import { gptSchema } from "@/lib/server/schemas";


export const GET = handler(async (_req, { user }) => json(await listGpts(user.id)));

export const POST = handler(async (req, { user }) => {
  const { pinned, ...data } = gptSchema.parse(await readJson(req));
  data.starters = data.starters.map((s) => s.trim()).filter(Boolean);
  return json(await saveGpt(user.id, null, data, pinned));
});
