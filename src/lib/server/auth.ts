import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { query, queryOne, num } from "./db";
import { decryptJson, encryptJson, randomToken, sha256, newId } from "./crypto";
import { DEFAULT_PREFS, type UserInfo, type UserPrefs } from "@/lib/shared/types";

export const SESSION_TTL_MS = 30 * 24 * 3600_000; // 30 days, renewed while in use
const SESSION_REFRESH_MS = 3600_000;
export const COOKIE_SECURE = "__Host-lgpt_session";
export const COOKIE_PLAIN = "lgpt_session";

export interface SessionUser {
  id: string;
  username: string;
  name: string;
  role: "admin" | "user";
  totpEnabled: boolean;
  sessionId: string;
}

interface UserRow extends Record<string, unknown> {
  id: string;
  username: string;
  name: string;
  role: string;
  totp_enabled: boolean;
  prefs: string | null;
  disabled: boolean;
}

export function prefsFromRow(prefs: string | null): UserPrefs {
  const stored = decryptJson<Partial<UserPrefs>>(prefs, {}, "prefs");
  return {
    ...DEFAULT_PREFS,
    ...stored,
    customInstructions: { ...DEFAULT_PREFS.customInstructions, ...(stored.customInstructions ?? {}) },
  };
}

export function encryptPrefs(prefs: UserPrefs): string {
  return encryptJson(prefs, "prefs");
}

export async function loadUserInfo(userId: string): Promise<UserInfo | null> {
  const row = await queryOne<UserRow>(
    `SELECT id, username, name, role, totp_enabled, prefs, disabled FROM users WHERE id = $1`,
    [userId],
  );
  if (!row || row.disabled) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role === "admin" ? "admin" : "user",
    totpEnabled: !!row.totp_enabled,
    prefs: prefsFromRow(row.prefs),
  };
}

async function userForToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const sid = sha256(token);
  const row = await queryOne<{
    id: string;
    username: string;
    name: string;
    role: string;
    totp_enabled: boolean;
    last_seen_at: number;
    expires_at: number;
    disabled: boolean;
  }>(
    `SELECT u.id, u.username, u.name, u.role, u.totp_enabled, u.disabled, s.last_seen_at, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1`,
    [sid],
  );
  if (!row || row.disabled) return null;
  const now = Date.now();
  if (num(row.expires_at) < now) {
    await query(`DELETE FROM sessions WHERE id = $1`, [sid]);
    return null;
  }
  if (now - num(row.last_seen_at) > SESSION_REFRESH_MS) {
    await query(`UPDATE sessions SET last_seen_at = $2, expires_at = $3 WHERE id = $1`, [
      sid,
      now,
      now + SESSION_TTL_MS,
    ]);
  }
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role === "admin" ? "admin" : "user",
    totpEnabled: !!row.totp_enabled,
    sessionId: sid,
  };
}

export async function getRequestUser(req: NextRequest): Promise<SessionUser | null> {
  const token = req.cookies.get(COOKIE_SECURE)?.value ?? req.cookies.get(COOKIE_PLAIN)?.value;
  return userForToken(token);
}

/** For server components (pages/layouts). */
export async function getPageUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_SECURE)?.value ?? jar.get(COOKIE_PLAIN)?.value;
  return userForToken(token);
}

export async function createSession(
  res: NextResponse,
  userId: string,
  meta: { userAgent: string | null; ip: string; secure: boolean },
): Promise<void> {
  const token = randomToken(32);
  const now = Date.now();
  await query(
    `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, user_agent, ip) VALUES ($1,$2,$3,$3,$4,$5,$6)`,
    [sha256(token), userId, now, now + SESSION_TTL_MS, (meta.userAgent || "").slice(0, 300), meta.ip],
  );
  // Clean up expired sessions now and then.
  if (Math.random() < 0.1) await query(`DELETE FROM sessions WHERE expires_at < $1`, [now]).catch(() => {});
  setSessionCookie(res, token, meta.secure);
}

export function setSessionCookie(res: NextResponse, token: string, secure: boolean) {
  res.cookies.set({
    name: secure ? COOKIE_SECURE : COOKIE_PLAIN,
    value: token,
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000) * 6, // browser keeps it; server enforces the real expiry
  });
}

export function clearSessionCookies(res: NextResponse) {
  for (const name of [COOKIE_SECURE, COOKIE_PLAIN]) {
    res.cookies.set({ name, value: "", httpOnly: true, secure: name === COOKIE_SECURE, sameSite: "lax", path: "/", maxAge: 0 });
  }
}

export async function destroySession(sessionId: string) {
  await query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
}

export async function destroyAllSessions(userId: string, exceptSessionId?: string) {
  if (exceptSessionId) {
    await query(`DELETE FROM sessions WHERE user_id = $1 AND id <> $2`, [userId, exceptSessionId]);
  } else {
    await query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
  }
}

export async function userCount(): Promise<number> {
  const row = await queryOne<{ c: number }>(`SELECT count(*) AS c FROM users`);
  return num(row?.c);
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function usernameProblem(username: string): string | null {
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    return "Username must be 3–32 characters: letters, numbers, dots, dashes or underscores.";
  }
  return null;
}

export async function insertUser(opts: {
  username: string;
  name: string;
  passwordHash: string;
  role: "admin" | "user";
}): Promise<string> {
  const id = newId();
  const now = Date.now();
  await query(
    `INSERT INTO users (id, username, name, password_hash, role, prefs, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
    [id, opts.username, opts.name, opts.passwordHash, opts.role, encryptPrefs(DEFAULT_PREFS), now],
  );
  return id;
}
