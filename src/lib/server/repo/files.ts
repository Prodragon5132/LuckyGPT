import "server-only";
import { query, queryOne, num, bytes } from "../db";
import { decryptBytes, decryptText, encryptBytes, encryptText, newId } from "../crypto";
import { badRequest, notFound } from "../http";
import type { FileInfo } from "@/lib/shared/types";

export type FileKind = "upload" | "generated" | "project" | "gpt" | "temp";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // fits under serverless body limits

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|yaml|yml|toml|ini|log|html?|css|scss|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|bash|zsh|sql|r|lua|pl|dart|vue|svelte|tex|srt|vtt)$/i;

export function isImageMime(mime: string) {
  return IMAGE_TYPES.has(mime);
}

export function classify(name: string, mime: string): "image" | "pdf" | "docx" | "text" | null {
  if (IMAGE_TYPES.has(mime)) return "image";
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || /\.docx$/i.test(name))
    return "docx";
  if (mime.startsWith("text/") || mime === "application/json" || TEXT_EXT.test(name)) return "text";
  return null;
}

/** Checks magic bytes so a renamed file can't pretend to be an image. */
function sniffImage(buf: Buffer): string | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.length > 6 && buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
  return null;
}

async function extractText(kind: "pdf" | "docx" | "text", data: Buffer): Promise<string> {
  const LIMIT = 400_000;
  try {
    if (kind === "text") return data.toString("utf8").slice(0, LIMIT);
    if (kind === "pdf") {
      const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(data));
      const { text } = await pdfText(pdf, { mergePages: true });
      return (Array.isArray(text) ? text.join("\n") : text).slice(0, LIMIT);
    }
    const mammoth = await import("mammoth");
    const res = await mammoth.extractRawText({ buffer: data });
    return res.value.slice(0, LIMIT);
  } catch (err) {
    console.warn("[files] text extraction failed", (err as Error).message);
    return "";
  }
}

export async function saveFile(opts: {
  userId: string;
  kind: FileKind;
  name: string;
  mime: string;
  data: Buffer;
  projectId?: string | null;
  gptId?: string | null;
  chatId?: string | null;
}): Promise<FileInfo> {
  const name = opts.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 200) || "file";
  let mime = opts.mime || "application/octet-stream";
  const kind = classify(name, mime);
  if (!kind) throw badRequest("That file type isn't supported. Try images, PDFs, Word documents, or text/code files.");
  if (kind === "image") {
    const sniffed = sniffImage(opts.data);
    if (!sniffed) throw badRequest("That image file looks damaged.");
    mime = sniffed;
  } else if (kind === "pdf") {
    mime = "application/pdf";
  } else if (kind === "text") {
    mime = "text/plain";
  }
  const text = kind === "image" ? "" : await extractText(kind, opts.data);
  const id = newId();
  const now = Date.now();
  await query(
    `INSERT INTO files (id, user_id, kind, name, mime, size, data, text_content, project_id, gpt_id, chat_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      id,
      opts.userId,
      opts.kind,
      encryptText(name, `fname:${id}`),
      mime,
      opts.data.length,
      encryptBytes(opts.data, `file:${id}`),
      text ? encryptText(text, `ftext:${id}`) : null,
      opts.projectId ?? null,
      opts.gptId ?? null,
      opts.chatId ?? null,
      now,
    ],
  );
  // Temporary-chat uploads are cleaned up after a day.
  if (Math.random() < 0.05) {
    await query(`DELETE FROM files WHERE kind = 'temp' AND created_at < $1`, [now - 24 * 3600_000]).catch(() => {});
  }
  return { id, name, mime, size: opts.data.length, kind: opts.kind, createdAt: now, chatId: opts.chatId ?? null };
}

interface FileRow extends Record<string, unknown> {
  id: string;
  kind: string;
  name: string;
  mime: string;
  size: number;
  created_at: number;
  chat_id: string | null;
}

function toInfo(row: FileRow): FileInfo {
  return {
    id: row.id,
    name: decryptText(row.name, `fname:${row.id}`),
    mime: row.mime,
    size: num(row.size),
    kind: row.kind,
    createdAt: num(row.created_at),
    chatId: row.chat_id,
  };
}

export async function getFileInfo(userId: string, id: string): Promise<FileInfo> {
  const row = await queryOne<FileRow>(
    `SELECT id, kind, name, mime, size, created_at, chat_id FROM files WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (!row) throw notFound("File not found");
  return toInfo(row);
}

export async function getFileData(userId: string, id: string): Promise<{ info: FileInfo; data: Buffer; text: string }> {
  const row = await queryOne<FileRow & { data: unknown; text_content: string | null }>(
    `SELECT id, kind, name, mime, size, created_at, chat_id, data, text_content FROM files WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (!row) throw notFound("File not found");
  return {
    info: toInfo(row),
    data: decryptBytes(bytes(row.data), `file:${row.id}`),
    text: row.text_content ? decryptText(row.text_content, `ftext:${row.id}`) : "",
  };
}

export async function listFiles(
  userId: string,
  filter: { kinds?: FileKind[]; projectId?: string; gptId?: string; imagesOnly?: boolean },
): Promise<FileInfo[]> {
  const params: unknown[] = [userId];
  let where = "user_id = $1";
  if (filter.kinds?.length) {
    params.push(filter.kinds);
    where += ` AND kind = ANY($${params.length}::text[])`;
  }
  if (filter.projectId) {
    params.push(filter.projectId);
    where += ` AND project_id = $${params.length}`;
  }
  if (filter.gptId) {
    params.push(filter.gptId);
    where += ` AND gpt_id = $${params.length}`;
  }
  if (filter.imagesOnly) where += ` AND mime LIKE 'image/%'`;
  const rows = await query<FileRow>(
    `SELECT id, kind, name, mime, size, created_at, chat_id FROM files WHERE ${where} ORDER BY created_at DESC LIMIT 500`,
    params,
  );
  return rows.map(toInfo);
}

/** Saves text for a file (for images: a description made by the image helper, so it's only made once). */
export async function setFileText(userId: string, id: string, text: string): Promise<void> {
  await query(`UPDATE files SET text_content = $3 WHERE id = $1 AND user_id = $2`, [id, userId, encryptText(text, `ftext:${id}`)]);
}

export async function attachFileToChat(userId: string, fileId: string, chatId: string): Promise<void> {
  await query(`UPDATE files SET chat_id = $3 WHERE id = $1 AND user_id = $2 AND chat_id IS NULL`, [fileId, userId, chatId]);
}

export async function deleteFile(userId: string, id: string): Promise<void> {
  await query(`DELETE FROM files WHERE id = $1 AND user_id = $2`, [id, userId]);
}
