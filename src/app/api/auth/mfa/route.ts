import { z } from "zod";
import { handler, json, readJson, HttpError, clientIp, isSecureRequest } from "@/lib/server/http";
import { createSession } from "@/lib/server/auth";
import { query, queryOne, num } from "@/lib/server/db";
import { decryptText, sha256, verifyToken } from "@/lib/server/crypto";
import { verifyTotp } from "@/lib/server/totp";
import { formatWait, limitedFor, recordHit } from "@/lib/server/ratelimit";

const schema = z.object({ mfaToken: z.string().max(1000), code: z.string().max(40) });

export const POST = handler(
  async (req) => {
    const body = schema.parse(await readJson(req));
    const data = verifyToken<{ uid: string; purpose: string }>(body.mfaToken);
    if (!data || data.purpose !== "mfa") throw new HttpError(401, "That sign-in expired. Please enter your password again.");

    const key = `mfa:${data.uid}`;
    const wait = await limitedFor(key, 15 * 60_000, 6);
    if (wait) throw new HttpError(429, `Too many wrong codes. Try again in ${formatWait(wait)}.`);

    const user = await queryOne<{
      id: string;
      totp_secret: string | null;
      totp_enabled: boolean;
      totp_last_step: number;
      recovery_codes: string | null;
      disabled: boolean;
    }>(`SELECT id, totp_secret, totp_enabled, totp_last_step, recovery_codes, disabled FROM users WHERE id = $1`, [data.uid]);
    if (!user || user.disabled || !user.totp_enabled || !user.totp_secret) throw new HttpError(401, "Please sign in again.");

    const code = body.code.trim();
    let ok = false;
    if (/^\d{6}$/.test(code.replace(/\s/g, ""))) {
      const step = verifyTotp(decryptText(user.totp_secret, "totp"), code, num(user.totp_last_step));
      if (step !== null) {
        ok = true;
        await query(`UPDATE users SET totp_last_step = $2 WHERE id = $1`, [user.id, step]);
      }
    } else {
      // Recovery code (single use)
      const hashes: string[] = user.recovery_codes ? JSON.parse(user.recovery_codes) : [];
      const h = sha256(code.toLowerCase().replace(/\s/g, ""));
      if (hashes.includes(h)) {
        ok = true;
        await query(`UPDATE users SET recovery_codes = $2 WHERE id = $1`, [user.id, JSON.stringify(hashes.filter((x) => x !== h))]);
      }
    }

    if (!ok) {
      await recordHit(key);
      throw new HttpError(401, "That code didn't work. Check your authenticator app and try again.");
    }

    const res = json({ ok: true });
    await createSession(res, user.id, {
      userAgent: req.headers.get("user-agent"),
      ip: clientIp(req),
      secure: isSecureRequest(req),
    });
    return res;
  },
  { auth: "none" },
);
