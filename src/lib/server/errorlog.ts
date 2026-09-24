import "server-only";
import { APICallError } from "ai";
import { query } from "./db";
import { decryptJson, encryptJson, newId } from "./crypto";
import { getConfig } from "./settings";

/**
 * Private error log for fixing problems later (Admin → Error logs).
 * It records WHAT broke, never WHO or WHAT they were talking about: no user ids, chat ids, names,
 * messages, prompts or file contents are stored, and anything that looks personal or secret
 * (emails, keys, tokens, ids, phone numbers, long numbers) is scrubbed. Entries are encrypted at
 * rest like everything else and never leave your server.
 */

export interface ErrorEntry {
  id: string;
  at: number;
  source: string;
  message: string;
  kind?: string;
  status?: number;
  where?: string;
  provider?: string;
  model?: string;
  stack?: string;
}

const MAX_ROWS = 1000;
const MAX_AGE = 60 * 24 * 3600_000;

/** Removes anything personal or secret from an error text. */
export function scrub(text: string, max = 600): string {
  return text
    .replace(/\b(sk|gsk|xai|AIza|pk|rk)[-_][A-Za-z0-9_-]{6,}|\bsk-(or|ant|proj)-[A-Za-z0-9_-]{6,}/g, "[key]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [token]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(/\b[A-Za-z0-9+/_-]{32,}={0,2}/g, "[data]")
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "[ip]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[number]")
    .replace(/([?&][^=\s&]+=)[^&\s"']+/g, "$1[…]")
    .replace(/"(content|text|prompt|input|messages|system|name|username|title)"\s*:\s*"(?:[^"\\]|\\.)*"/gi, '"$1":"[removed]"')
    .slice(0, max);
}

/** Turns "/api/chats/3f2a…/share" into "/api/chats/:id/share". */
export function routePattern(path: string): string {
  return path
    .split("/")
    .map((seg) => (/^[0-9a-f-]{16,}$/i.test(seg) || /^[A-Za-z0-9_-]{20,}$/.test(seg) ? ":id" : seg))
    .join("/")
    .slice(0, 120);
}

function describe(err: unknown): Pick<ErrorEntry, "message" | "kind" | "status" | "stack"> {
  if (APICallError.isInstance(err)) {
    let detail = "";
    try {
      const body = JSON.parse(err.responseBody ?? "") as { error?: { message?: string } | string; message?: string };
      detail = (typeof body.error === "string" ? body.error : body.error?.message) || body.message || "";
    } catch {
      detail = err.responseBody ?? "";
    }
    return { kind: "APICallError", status: err.statusCode, message: scrub(detail || err.message) };
  }
  if (err instanceof Error) {
    const stack = err.stack
      ?.split("\n")
      .slice(1, 7)
      .map((l) => l.trim().replace(/\(?\/[^\s)]*\/(src|node_modules|\.next)\//, "($1/"))
      .join("\n");
    return { kind: err.name, message: scrub(err.message), stack: stack ? scrub(stack, 800) : undefined };
  }
  return { message: scrub(String(err)) };
}

/** Records an error. Never throws and never slows down the request much. */
export async function logError(
  source: string,
  err: unknown,
  meta: { where?: string; provider?: string; model?: string; message?: string } = {},
): Promise<void> {
  try {
    const config = await getConfig();
    if (config.errorLogging === false) return;
    const d = describe(err);
    const entry: Omit<ErrorEntry, "id" | "at"> = {
      source: source.slice(0, 40),
      ...d,
      message: meta.message ? scrub(meta.message) : d.message,
      where: meta.where ? routePattern(meta.where) : undefined,
      provider: meta.provider?.slice(0, 40),
      model: meta.model ? scrub(meta.model, 120) : undefined,
    };
    const id = newId();
    await query(`INSERT INTO error_logs (id, at, source, data) VALUES ($1, $2, $3, $4)`, [
      id,
      Date.now(),
      entry.source,
      encryptJson(entry, `errlog:${id}`),
    ]);
    if (Math.random() < 0.05) {
      await query(
        `DELETE FROM error_logs WHERE at < $1 OR id IN (SELECT id FROM error_logs ORDER BY at DESC OFFSET ${MAX_ROWS})`,
        [Date.now() - MAX_AGE],
      );
    }
  } catch {
    // Logging must never break the app.
  }
}

export async function listErrors(limit = 500): Promise<ErrorEntry[]> {
  const rows = await query<{ id: string; at: number; source: string; data: string }>(
    `SELECT id, at, source, data FROM error_logs ORDER BY at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    ...decryptJson<Omit<ErrorEntry, "id" | "at">>(r.data, { source: r.source, message: "(unreadable)" }, `errlog:${r.id}`),
    id: r.id,
    at: Number(r.at),
  }));
}

export async function clearErrors(): Promise<void> {
  await query(`DELETE FROM error_logs`);
}
