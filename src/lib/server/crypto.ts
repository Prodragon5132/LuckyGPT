import "server-only";
import crypto from "node:crypto";
import { appSecret } from "./env";

/**
 * Encryption at rest (AES-256-GCM).
 *
 * Everything private (API keys, chat titles and messages, memories, custom
 * instructions, uploaded files) is encrypted with a key derived from
 * APP_SECRET before it is written to the database. Someone who only gets a
 * copy of the database cannot read any of it.
 */

let dataKey: Buffer | null = null;
let macKey: Buffer | null = null;

function keys() {
  if (!dataKey || !macKey) {
    const secret = Buffer.from(appSecret(), "utf8");
    const salt = Buffer.from("luckygpt-v1", "utf8");
    dataKey = Buffer.from(crypto.hkdfSync("sha256", secret, salt, "data-encryption", 32));
    macKey = Buffer.from(crypto.hkdfSync("sha256", secret, salt, "token-signing", 32));
  }
  return { dataKey, macKey };
}

const VERSION = 1;

export function encryptBytes(plain: Uint8Array, context = ""): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keys().dataKey, iv);
  if (context) cipher.setAAD(Buffer.from(context, "utf8"));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ct]);
}

export function decryptBytes(blob: Uint8Array, context = ""): Buffer {
  const buf = Buffer.from(blob);
  if (buf.length < 29 || buf[0] !== VERSION) throw new Error("Unsupported ciphertext");
  const iv = buf.subarray(1, 13);
  const tag = buf.subarray(13, 29);
  const ct = buf.subarray(29);
  const decipher = crypto.createDecipheriv("aes-256-gcm", keys().dataKey, iv);
  if (context) decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export function encryptText(plain: string, context = ""): string {
  return encryptBytes(Buffer.from(plain, "utf8"), context).toString("base64");
}

export function decryptText(value: string | null | undefined, context = ""): string {
  if (!value) return "";
  return decryptBytes(Buffer.from(value, "base64"), context).toString("utf8");
}

export function encryptJson(value: unknown, context = ""): string {
  return encryptText(JSON.stringify(value), context);
}

export function decryptJson<T>(value: string | null | undefined, fallback: T, context = ""): T {
  if (!value) return fallback;
  try {
    return JSON.parse(decryptText(value, context)) as T;
  } catch {
    return fallback;
  }
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hmac(value: string): string {
  return crypto.createHmac("sha256", keys().macKey).update(value).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // still do a comparison to keep timing roughly constant
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

/** Short-lived signed token (used between password and 2FA steps). */
export function signToken(payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 })).toString("base64url");
  return `${body}.${hmac(body)}`;
}

export function verifyToken<T extends Record<string, unknown>>(token: string): T | null {
  const [body, sig] = token.split(".");
  if (!body || !sig || !safeEqual(sig, hmac(body))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function newId(): string {
  return crypto.randomUUID();
}
