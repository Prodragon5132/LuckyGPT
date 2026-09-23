import { handler, json } from "@/lib/server/http";
import { clearSessionCookies, destroyAllSessions } from "@/lib/server/auth";

export const POST = handler(async (_req, { user }) => {
  await destroyAllSessions(user.id);
  const res = json({ ok: true });
  clearSessionCookies(res);
  return res;
});
