import { z } from "zod";
import { handler, json, readJson, HttpError, clientIp, isSecureRequest } from "@/lib/server/http";
import { createSession, insertUser, normalizeUsername, userCount, usernameProblem } from "@/lib/server/auth";
import { hashPassword, passwordProblem } from "@/lib/server/password";
import { setupCode, setupCodeRequired, isProd } from "@/lib/server/env";
import { safeEqual } from "@/lib/server/crypto";
import { consume, formatWait } from "@/lib/server/ratelimit";

const schema = z.object({
  code: z.string().max(500).optional(),
  name: z.string().trim().min(1).max(60),
  username: z.string().max(64),
  password: z.string().max(200),
});

export const POST = handler(
  async (req) => {
    const ip = clientIp(req);
    const wait = await consume(`setup:${ip}`, 15 * 60_000, 10);
    if (wait) throw new HttpError(429, `Too many attempts. Try again in ${formatWait(wait)}.`);

    if ((await userCount()) > 0) throw new HttpError(403, "Setup is already complete. Please log in.");
    const body = schema.parse(await readJson(req));

    if (setupCodeRequired()) {
      const expected = setupCode();
      if (!expected) {
        throw new HttpError(
          403,
          isProd
            ? "Set the SETUP_CODE environment variable on your server, redeploy, then enter it here."
            : "Setup code is not configured.",
        );
      }
      if (!body.code || !safeEqual(body.code.trim(), expected)) throw new HttpError(403, "That setup code is wrong.");
    }

    const username = normalizeUsername(body.username);
    const uProblem = usernameProblem(username);
    if (uProblem) throw new HttpError(400, uProblem);
    const pProblem = passwordProblem(body.password);
    if (pProblem) throw new HttpError(400, pProblem);

    const passwordHash = await hashPassword(body.password);
    // Re-check right before insert so two tabs can't both become owner.
    if ((await userCount()) > 0) throw new HttpError(403, "Setup is already complete. Please log in.");
    const id = await insertUser({ username, name: body.name, passwordHash, role: "admin" });

    const res = json({ ok: true });
    await createSession(res, id, { userAgent: req.headers.get("user-agent"), ip, secure: isSecureRequest(req) });
    return res;
  },
  { auth: "none" },
);
