import { z } from "zod";
import { handler, json, readJson, HttpError } from "@/lib/server/http";
import { query, num } from "@/lib/server/db";
import { insertUser, normalizeUsername, usernameProblem } from "@/lib/server/auth";
import { hashPassword, passwordProblem } from "@/lib/server/password";

export const GET = handler(
  async () => {
    const rows = await query<{
      id: string;
      username: string;
      name: string;
      role: string;
      totp_enabled: boolean;
      disabled: boolean;
      created_at: number;
      last_seen: number | null;
    }>(
      `SELECT u.id, u.username, u.name, u.role, u.totp_enabled, u.disabled, u.created_at,
              (SELECT max(last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen
         FROM users u ORDER BY u.created_at ASC`,
    );
    return json(
      rows.map((r) => ({
        id: r.id,
        username: r.username,
        name: r.name,
        role: r.role,
        totpEnabled: !!r.totp_enabled,
        disabled: !!r.disabled,
        createdAt: num(r.created_at),
        lastSeen: r.last_seen ? num(r.last_seen) : null,
      })),
    );
  },
  { auth: "admin" },
);

const schema = z.object({
  name: z.string().trim().min(1).max(60),
  username: z.string().max(64),
  password: z.string().max(200),
  role: z.enum(["admin", "user"]).default("user"),
});

export const POST = handler(
  async (req) => {
    const body = schema.parse(await readJson(req));
    const username = normalizeUsername(body.username);
    const problem = usernameProblem(username) ?? passwordProblem(body.password);
    if (problem) throw new HttpError(400, problem);
    const exists = await query(`SELECT 1 FROM users WHERE username = $1`, [username]);
    if (exists.length) throw new HttpError(400, "That username is taken.");
    const id = await insertUser({ username, name: body.name, passwordHash: await hashPassword(body.password), role: body.role });
    return json({ id });
  },
  { auth: "admin" },
);
