import { z } from "zod";
import { handler, json, readJson } from "@/lib/server/http";
import { query, num } from "@/lib/server/db";

function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /iPhone|iPad/.test(ua)
    ? "iPhone/iPad"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "Mac"
        : /Windows/.test(ua)
          ? "Windows"
          : /CrOS/.test(ua)
            ? "Chromebook"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  return os ? `${browser} on ${os}` : browser;
}

export const GET = handler(async (_req, { user }) => {
  const rows = await query<{ id: string; created_at: number; last_seen_at: number; user_agent: string | null; ip: string | null }>(
    `SELECT id, created_at, last_seen_at, user_agent, ip FROM sessions WHERE user_id = $1 AND expires_at > $2 ORDER BY last_seen_at DESC`,
    [user.id, Date.now()],
  );
  return json(
    rows.map((r) => ({
      id: r.id.slice(0, 12),
      device: describeAgent(r.user_agent),
      ip: r.ip,
      createdAt: num(r.created_at),
      lastSeenAt: num(r.last_seen_at),
      current: r.id === user.sessionId,
    })),
  );
});

const del = z.object({ id: z.string().min(6).max(64) });

/** Sign out one specific device. */
export const DELETE = handler(async (req, { user }) => {
  const { id } = del.parse(await readJson(req));
  await query(`DELETE FROM sessions WHERE user_id = $1 AND id LIKE $2 AND id <> $3`, [
    user.id,
    `${id.replace(/[^0-9a-f]/g, "")}%`,
    user.sessionId,
  ]);
  return json({ ok: true });
});
