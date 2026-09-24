import "server-only";
import { query, queryOne, num } from "./db";

/**
 * Database-backed rate limiting (works on serverless where memory isn't shared).
 */

export async function countRecent(key: string, windowMs: number): Promise<{ count: number; oldest: number }> {
  const row = await queryOne<{ c: number; oldest: number | null }>(
    `SELECT count(*) AS c, min(at) AS oldest FROM rate_limits WHERE key = $1 AND at > $2`,
    [key, Date.now() - windowMs],
  );
  return { count: num(row?.c), oldest: num(row?.oldest) };
}

/** One row per prompt sent to an OpenRouter model (for the daily usage bar). */
export const OPENROUTER_USAGE_KEY = "usage:openrouter";

export async function recordHit(key: string): Promise<void> {
  await query(`INSERT INTO rate_limits (key, at) VALUES ($1, $2)`, [key, Date.now()]);
  if (Math.random() < 0.02) {
    await query(`DELETE FROM rate_limits WHERE at < $1`, [Date.now() - 2 * 24 * 3600_000]).catch(() => {});
  }
}

export async function clearHits(key: string): Promise<void> {
  await query(`DELETE FROM rate_limits WHERE key = $1`, [key]);
}

/** Returns milliseconds until the caller may try again, or 0 if allowed. */
export async function limitedFor(key: string, windowMs: number, max: number): Promise<number> {
  const { count, oldest } = await countRecent(key, windowMs);
  if (count < max) return 0;
  return Math.max(1000, oldest + windowMs - Date.now());
}

/** Check-and-record in one call. Returns ms to wait (0 = allowed and recorded). */
export async function consume(key: string, windowMs: number, max: number): Promise<number> {
  const wait = await limitedFor(key, windowMs, max);
  if (wait) return wait;
  await recordHit(key);
  return 0;
}

export function formatWait(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  return minutes <= 1 ? "a minute" : `${minutes} minutes`;
}
