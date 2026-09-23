import { z } from "zod";
import { handler, json, readJson, HttpError } from "@/lib/server/http";
import { query, queryOne, num } from "@/lib/server/db";
import { destroyAllSessions } from "@/lib/server/auth";
import { hashPassword, passwordProblem } from "@/lib/server/password";

const schema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  role: z.enum(["admin", "user"]).optional(),
  disabled: z.boolean().optional(),
  password: z.string().max(200).optional(),
  resetTwoFactor: z.boolean().optional(),
});

async function otherActiveAdmins(exceptId: string): Promise<number> {
  const row = await queryOne<{ c: number }>(
    `SELECT count(*) AS c FROM users WHERE role = 'admin' AND disabled = FALSE AND id <> $1`,
    [exceptId],
  );
  return num(row?.c);
}

export const PATCH = handler(
  async (req, { user, params }) => {
    const id = z.string().uuid().parse(params.id);
    const body = schema.parse(await readJson(req));
    const target = await queryOne<{ id: string; role: string }>(`SELECT id, role FROM users WHERE id = $1`, [id]);
    if (!target) throw new HttpError(404, "User not found");
    const losingAdmin = (body.role === "user" || body.disabled === true) && target.role === "admin";
    if (losingAdmin && (await otherActiveAdmins(id)) === 0) {
      throw new HttpError(400, "You can't remove the last admin.");
    }
    const now = Date.now();
    if (body.name !== undefined) await query(`UPDATE users SET name = $2, updated_at = $3 WHERE id = $1`, [id, body.name, now]);
    if (body.role !== undefined) await query(`UPDATE users SET role = $2, updated_at = $3 WHERE id = $1`, [id, body.role, now]);
    if (body.disabled !== undefined) {
      if (id === user.id && body.disabled) throw new HttpError(400, "You can't disable your own account.");
      await query(`UPDATE users SET disabled = $2, updated_at = $3 WHERE id = $1`, [id, body.disabled, now]);
      if (body.disabled) await destroyAllSessions(id);
    }
    if (body.password !== undefined) {
      const problem = passwordProblem(body.password);
      if (problem) throw new HttpError(400, problem);
      await query(`UPDATE users SET password_hash = $2, updated_at = $3 WHERE id = $1`, [id, await hashPassword(body.password), now]);
      await destroyAllSessions(id, id === user.id ? user.sessionId : undefined);
    }
    if (body.resetTwoFactor) {
      await query(
        `UPDATE users SET totp_enabled = FALSE, totp_secret = NULL, recovery_codes = NULL, updated_at = $2 WHERE id = $1`,
        [id, now],
      );
    }
    return json({ ok: true });
  },
  { auth: "admin" },
);

export const DELETE = handler(
  async (_req, { user, params }) => {
    const id = z.string().uuid().parse(params.id);
    if (id === user.id) throw new HttpError(400, "You can't delete your own account here.");
    const target = await queryOne<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [id]);
    if (target?.role === "admin" && (await otherActiveAdmins(id)) === 0) throw new HttpError(400, "You can't remove the last admin.");
    await query(`DELETE FROM users WHERE id = $1`, [id]);
    return json({ ok: true });
  },
  { auth: "admin" },
);
