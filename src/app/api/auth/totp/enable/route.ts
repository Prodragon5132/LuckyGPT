import { z } from "zod";
import { handler, json, readJson, HttpError } from "@/lib/server/http";
import { query, queryOne } from "@/lib/server/db";
import { decryptText, sha256 } from "@/lib/server/crypto";
import { generateRecoveryCodes, verifyTotp } from "@/lib/server/totp";
import { destroyAllSessions } from "@/lib/server/auth";
import { consume, formatWait } from "@/lib/server/ratelimit";

const schema = z.object({ code: z.string().max(20) });

export const POST = handler(async (req, { user }) => {
  const wait = await consume(`totp-enable:${user.id}`, 15 * 60_000, 10);
  if (wait) throw new HttpError(429, `Too many attempts. Try again in ${formatWait(wait)}.`);
  const { code } = schema.parse(await readJson(req));
  const row = await queryOne<{ totp_secret: string | null; totp_enabled: boolean }>(
    `SELECT totp_secret, totp_enabled FROM users WHERE id = $1`,
    [user.id],
  );
  if (!row?.totp_secret) throw new HttpError(400, "Start setup first.");
  if (row.totp_enabled) throw new HttpError(400, "Two-factor authentication is already on.");
  const step = verifyTotp(decryptText(row.totp_secret, "totp"), code);
  if (step === null) throw new HttpError(400, "That code didn't match. Make sure your phone's time is correct and try again.");
  const codes = generateRecoveryCodes();
  await query(
    `UPDATE users SET totp_enabled = TRUE, totp_last_step = $2, recovery_codes = $3, updated_at = $4 WHERE id = $1`,
    [user.id, step, JSON.stringify(codes.map((c) => sha256(c.replace(/\s/g, "")))), Date.now()],
  );
  await destroyAllSessions(user.id, user.sessionId);
  return json({ ok: true, recoveryCodes: codes });
});
