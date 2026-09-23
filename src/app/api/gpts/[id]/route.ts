import { z } from "zod";
import { handler, json, readJson } from "@/lib/server/http";
import { deleteGpt, getGpt, saveGpt, setGptPinned } from "@/lib/server/repo/misc";
import { gptSchema } from "@/lib/server/schemas";

const uuid = z.string().uuid();

export const GET = handler(async (_req, { user, params }) => json(await getGpt(user.id, uuid.parse(params.id))));

export const PATCH = handler(async (req, { user, params }) => {
  const id = uuid.parse(params.id);
  const raw = await readJson<Record<string, unknown>>(req);
  if (Object.keys(raw).length === 1 && typeof raw.pinned === "boolean") {
    await setGptPinned(user.id, id, raw.pinned);
    return json(await getGpt(user.id, id));
  }
  const { pinned, ...data } = gptSchema.parse(raw);
  data.starters = data.starters.map((s) => s.trim()).filter(Boolean);
  return json(await saveGpt(user.id, id, data, pinned));
});

export const DELETE = handler(async (_req, { user, params }) => {
  await deleteGpt(user.id, uuid.parse(params.id));
  return json({ ok: true });
});
