import { handler, json } from "@/lib/server/http";
import { clearSessionCookies, destroySession } from "@/lib/server/auth";

export const POST = handler(
  async (_req, { user }) => {
    if (user) await destroySession(user.sessionId);
    const res = json({ ok: true });
    clearSessionCookies(res);
    return res;
  },
  { auth: "none" },
);
