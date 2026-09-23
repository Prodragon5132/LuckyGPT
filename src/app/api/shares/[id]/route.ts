import { z } from "zod";
import { handler, json } from "@/lib/server/http";
import { deleteShare } from "@/lib/server/repo/misc";

export const DELETE = handler(async (_req, { user, params }) => {
  await deleteShare(user.id, z.string().max(64).parse(params.id));
  return json({ ok: true });
});
