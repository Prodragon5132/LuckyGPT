import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Central place for runtime configuration.
 *
 * Required in production:
 *   APP_SECRET   – long random string. Used to encrypt API keys, chats and files at rest.
 *   DATABASE_URL – Postgres connection string (e.g. a free Neon database).
 *   SETUP_CODE   – one-time code needed to create the first (owner) account.
 *
 * For local development / Docker all three are optional: an embedded Postgres
 * (PGlite) is stored in ./data and a secret is generated into ./data/secret.key.
 */

export const isProd = process.env.NODE_ENV === "production";
export const isVercel = !!process.env.VERCEL;

export function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

let cachedSecret: string | null = null;

export function appSecret(): string {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.APP_SECRET?.trim();
  if (fromEnv) {
    if (fromEnv.length < 32) {
      throw new Error("APP_SECRET must be at least 32 characters long. Generate one with: openssl rand -base64 48");
    }
    cachedSecret = fromEnv;
    return fromEnv;
  }
  if (isVercel) {
    throw new Error(
      "APP_SECRET environment variable is missing. Add it in your hosting dashboard (see README).",
    );
  }
  // Self-hosted fallback: persist a generated secret next to the embedded database.
  const dir = dataDir();
  const file = path.join(dir, "secret.key");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.existsSync(file)) {
    cachedSecret = fs.readFileSync(file, "utf8").trim();
  } else {
    cachedSecret = crypto.randomBytes(48).toString("base64url");
    fs.writeFileSync(file, cachedSecret, { mode: 0o600 });
    console.warn(`[luckygpt] APP_SECRET not set. Generated one and saved it to ${file}. Keep this file safe and private.`);
  }
  return cachedSecret;
}

export function setupCode(): string | null {
  const code = process.env.SETUP_CODE?.trim();
  return code ? code : null;
}

/** Setup requires a code in production. In local development it is optional. */
export function setupCodeRequired(): boolean {
  return isProd || !!setupCode();
}
