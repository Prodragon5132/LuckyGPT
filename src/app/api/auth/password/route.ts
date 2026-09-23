import { z } from "zod";
import { handler, json, readJson, HttpError } from "@/lib/server/http";
import { destroyAllSessions } from "@/lib/server/auth";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/server/password";
import { query, queryOne } from "@/lib/server/db";
import { consume, formatWait } from "@/lib/server/ratelimit";

const schema = z.object({ current: z.string().max(200), next: z.string().max(200) });

export const POST = handler(async (req, { user }) => {
  const wait = await consume(`pw-change:${user.id}`, 15 * 60_000, 8);
  if (wait) throw new HttpError(429, `Too many attempts. Try again in ${formatWait(wait)}.`);
  const body = schema.parse(await readJson(req));
  const row = await queryOne<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);
  if (!row || !(await verifyPassword(body.current, row.password_hash))) {
    throw new HttpError(400, "Your current password is wrong.");
  }
  const problem = passwordProblem(body.next);
  if (problem) throw new HttpError(400, problem);
  await query(`UPDATE users SET password_hash = $2, updated_at = $3 WHERE id = $1`, [
    user.id,
    await hashPassword(body.next),
    Date.now(),
  ]);
  // Sign out every other device.
  await destroyAllSessions(user.id, user.sessionId);
  return json({ ok: true });
});
