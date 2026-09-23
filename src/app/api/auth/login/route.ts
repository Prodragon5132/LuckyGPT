import { z } from "zod";
import { handler, json, readJson, HttpError, clientIp, isSecureRequest } from "@/lib/server/http";
import { createSession, normalizeUsername } from "@/lib/server/auth";
import { burnPasswordCheck, verifyPassword } from "@/lib/server/password";
import { queryOne } from "@/lib/server/db";
import { signToken } from "@/lib/server/crypto";
import { clearHits, formatWait, limitedFor, recordHit } from "@/lib/server/ratelimit";

const schema = z.object({
  username: z.string().max(64),
  password: z.string().max(200),
});

const WINDOW = 15 * 60_000;

export const POST = handler(
  async (req) => {
    const body = schema.parse(await readJson(req));
    const username = normalizeUsername(body.username);
    const ip = clientIp(req);
    // Three limits: this device+account (tight), the account from anywhere, and this device overall.
    // The looser account-wide limit makes it harder for a stranger to lock someone else out.
    const ipKey = `login-ip:${ip}`;
    const userKey = `login-user:${username}`;
    const pairKey = `login-pair:${username}:${ip}`;

    const wait = Math.max(
      await limitedFor(pairKey, WINDOW, 6),
      await limitedFor(userKey, WINDOW, 30),
      await limitedFor(ipKey, WINDOW, 30),
    );
    if (wait) throw new HttpError(429, `Too many failed attempts. Try again in ${formatWait(wait)}.`);

    const user = await queryOne<{ id: string; password_hash: string; totp_enabled: boolean; disabled: boolean }>(
      `SELECT id, password_hash, totp_enabled, disabled FROM users WHERE username = $1`,
      [username],
    );

    let ok = false;
    if (user) ok = await verifyPassword(body.password, user.password_hash);
    else await burnPasswordCheck(body.password);

    if (!user || !ok || user.disabled) {
      await recordHit(ipKey);
      await recordHit(userKey);
      await recordHit(pairKey);
      throw new HttpError(401, "Wrong username or password.");
    }

    if (user.totp_enabled) {
      const mfaToken = signToken({ uid: user.id, purpose: "mfa" }, 5 * 60);
      return json({ mfaRequired: true, mfaToken });
    }

    await clearHits(pairKey);
    const res = json({ ok: true });
    await createSession(res, user.id, { userAgent: req.headers.get("user-agent"), ip, secure: isSecureRequest(req) });
    return res;
  },
  { auth: "none" },
);
