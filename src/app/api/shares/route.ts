import { handler, json } from "@/lib/server/http";
import { deleteAllShares, listShares } from "@/lib/server/repo/misc";

export const GET = handler(async (_req, { user }) => json(await listShares(user.id)));

export const DELETE = handler(async (_req, { user }) => {
  await deleteAllShares(user.id);
  return json({ ok: true });
});
