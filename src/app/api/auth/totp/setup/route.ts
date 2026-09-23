import QRCode from "qrcode";
import { handler, json, HttpError } from "@/lib/server/http";
import { query, queryOne } from "@/lib/server/db";
import { encryptText } from "@/lib/server/crypto";
import { generateTotpSecret, totpUri } from "@/lib/server/totp";

/** Starts two-factor setup: creates a secret and returns a QR code to scan. */
export const POST = handler(async (_req, { user }) => {
  const row = await queryOne<{ totp_enabled: boolean }>(`SELECT totp_enabled FROM users WHERE id = $1`, [user.id]);
  if (row?.totp_enabled) throw new HttpError(400, "Two-factor authentication is already on.");
  const secret = generateTotpSecret();
  await query(`UPDATE users SET totp_secret = $2, totp_enabled = FALSE WHERE id = $1`, [user.id, encryptText(secret, "totp")]);
  const uri = totpUri(secret, user.username);
  const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, width: 200 });
  return json({ secret, uri, qrSvg });
});
