import { z } from "zod";
import { handler, json, readJson, HttpError } from "@/lib/server/http";
import { query, queryOne } from "@/lib/server/db";
import { verifyPassword } from "@/lib/server/password";
import { consume, formatWait } from "@/lib/server/ratelimit";

const schema = z.object({ password: z.string().max(200) });

export const POST = handler(async (req, { user }) => {
  const wait = await consume(`totp-disable:${user.id}`, 15 * 60_000, 8);
  if (wait) throw new HttpError(429, `Too many attempts. Try again in ${formatWait(wait)}.`);
  const { password } = schema.parse(await readJson(req));
  const row = await queryOne<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);
  if (!row || !(await verifyPassword(password, row.password_hash))) throw new HttpError(400, "Wrong password.");
  await query(
    `UPDATE users SET totp_enabled = FALSE, totp_secret = NULL, recovery_codes = NULL, updated_at = $2 WHERE id = $1`,
    [user.id, Date.now()],
  );
  return json({ ok: true });
});
