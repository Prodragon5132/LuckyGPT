import { z } from "zod";
import { handler, json } from "@/lib/server/http";
import { deleteMemory } from "@/lib/server/repo/misc";

export const DELETE = handler(async (_req, { user, params }) => {
  await deleteMemory(user.id, z.string().uuid().parse(params.id));
  return json({ ok: true });
});
