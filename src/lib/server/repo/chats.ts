import "server-only";
import { query, queryOne, num, transaction } from "../db";
import { decryptJson, decryptText, encryptJson, encryptText, newId } from "../crypto";
import { notFound } from "../http";
import type { ChatDetail, ChatMessage, ChatSummary, MessageBody, MessageStatus } from "@/lib/shared/types";

interface ChatRow extends Record<string, unknown> {
  id: string;
  title: string | null;
  project_id: string | null;
  gpt_id: string | null;
  pinned: boolean;
  archived: boolean;
  current_leaf: string | null;
  created_at: number;
  updated_at: number;
}

interface MessageRow extends Record<string, unknown> {
  id: string;
  chat_id: string;
  parent_id: string | null;
  role: string;
  content: string;
  model: string | null;
  status: string;
  feedback: number | null;
  created_at: number;
}

const titleCtx = (id: string) => `title:${id}`;
const msgCtx = (chatId: string) => `msg:${chatId}`;

function toSummary(row: ChatRow): ChatSummary {
  let title = "";
  try {
    title = decryptText(row.title, titleCtx(row.id));
  } catch {
    title = "";
  }
  return {
    id: row.id,
    title: title || "New chat",
    projectId: row.project_id,
    gptId: row.gpt_id,
    pinned: !!row.pinned,
    archived: !!row.archived,
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

type StoredBody = MessageBody & { modelName?: string };

export function toMessage(row: MessageRow): ChatMessage {
  const body = decryptJson<StoredBody>(row.content, { text: "" }, msgCtx(row.chat_id));
  const { modelName, ...rest } = body;
  return {
    ...rest,
    text: rest.text ?? "",
    id: row.id,
    parentId: row.parent_id,
    role: row.role === "assistant" ? "assistant" : "user",
    model: row.model,
    modelName: modelName ?? null,
    status: (row.status as MessageStatus) || "done",
    feedback: row.feedback == null ? null : Number(row.feedback),
    createdAt: num(row.created_at),
  };
}

const CHAT_COLS = `id, title, project_id, gpt_id, pinned, archived, current_leaf, created_at, updated_at`;

export async function listChats(
  userId: string,
  opts: { archived?: boolean; projectId?: string | null } = {},
): Promise<ChatSummary[]> {
  const params: unknown[] = [userId, !!opts.archived];
  let where = `user_id = $1 AND archived = $2`;
  if (opts.projectId !== undefined) {
    if (opts.projectId === null) {
      where += ` AND project_id IS NULL`;
    } else {
      params.push(opts.projectId);
      where += ` AND project_id = $${params.length}`;
    }
  }
  const rows = await query<ChatRow>(
    `SELECT ${CHAT_COLS} FROM chats WHERE ${where} ORDER BY updated_at DESC LIMIT 2000`,
    params,
  );
  return rows.map(toSummary);
}

export async function getChatRow(userId: string, chatId: string): Promise<ChatRow> {
  const row = await queryOne<ChatRow>(`SELECT ${CHAT_COLS} FROM chats WHERE id = $1 AND user_id = $2`, [chatId, userId]);
  if (!row) throw notFound("Chat not found");
  return row;
}

export async function getChatSummary(userId: string, chatId: string): Promise<ChatSummary> {
  return toSummary(await getChatRow(userId, chatId));
}

export async function getChat(userId: string, chatId: string): Promise<ChatDetail> {
  const row = await getChatRow(userId, chatId);
  const messages = await query<MessageRow>(
    `SELECT id, chat_id, parent_id, role, content, model, status, feedback, created_at
       FROM messages WHERE chat_id = $1 ORDER BY created_at ASC, id ASC`,
    [chatId],
  );
  return { ...toSummary(row), currentLeaf: row.current_leaf, messages: messages.map(toMessage) };
}

export async function createChat(
  userId: string,
  opts: { projectId?: string | null; gptId?: string | null; title?: string },
): Promise<string> {
  const id = newId();
  const now = Date.now();
  await query(
    `INSERT INTO chats (id, user_id, title, project_id, gpt_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6)`,
    [id, userId, opts.title ? encryptText(opts.title, titleCtx(id)) : null, opts.projectId ?? null, opts.gptId ?? null, now],
  );
  return id;
}

export async function updateChat(
  userId: string,
  chatId: string,
  patch: { title?: string; pinned?: boolean; archived?: boolean; projectId?: string | null; currentLeaf?: string | null },
  touch = false,
): Promise<void> {
  await getChatRow(userId, chatId);
  const sets: string[] = [];
  const params: unknown[] = [chatId, userId];
  const add = (col: string, value: unknown) => {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.title !== undefined) add("title", encryptText(patch.title.slice(0, 300), titleCtx(chatId)));
  if (patch.pinned !== undefined) add("pinned", patch.pinned);
  if (patch.archived !== undefined) add("archived", patch.archived);
  if (patch.projectId !== undefined) add("project_id", patch.projectId);
  if (patch.currentLeaf !== undefined) add("current_leaf", patch.currentLeaf);
  if (touch) add("updated_at", Date.now());
  if (!sets.length) return;
  await query(`UPDATE chats SET ${sets.join(", ")} WHERE id = $1 AND user_id = $2`, params);
}

export async function deleteChat(userId: string, chatId: string): Promise<void> {
  await query(`DELETE FROM chats WHERE id = $1 AND user_id = $2`, [chatId, userId]);
}

export async function deleteAllChats(userId: string): Promise<void> {
  await query(`DELETE FROM chats WHERE user_id = $1`, [userId]);
}

export async function archiveAllChats(userId: string): Promise<void> {
  await query(`UPDATE chats SET archived = TRUE WHERE user_id = $1`, [userId]);
}

export async function insertMessage(opts: {
  chatId: string;
  parentId: string | null;
  role: "user" | "assistant";
  body: MessageBody;
  model?: string | null;
  modelName?: string | null;
  status?: MessageStatus;
}): Promise<ChatMessage> {
  const id = newId();
  const now = Date.now();
  const stored: StoredBody = { ...opts.body, modelName: opts.modelName ?? undefined };
  await transaction(async (q) => {
    await q.query(
      `INSERT INTO messages (id, chat_id, parent_id, role, content, model, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
      [id, opts.chatId, opts.parentId, opts.role, encryptJson(stored, msgCtx(opts.chatId)), opts.model ?? null, opts.status ?? "done", now],
    );
    await q.query(`UPDATE chats SET current_leaf = $2, updated_at = $3 WHERE id = $1`, [opts.chatId, id, now]);
  });
  return {
    ...opts.body,
    id,
    parentId: opts.parentId,
    role: opts.role,
    model: opts.model ?? null,
    modelName: opts.modelName ?? null,
    status: opts.status ?? "done",
    feedback: null,
    createdAt: now,
  };
}

export async function updateMessageBody(
  chatId: string,
  messageId: string,
  body: MessageBody,
  status: MessageStatus,
  modelName?: string | null,
): Promise<void> {
  const stored: StoredBody = { ...body, modelName: modelName ?? undefined };
  await query(`UPDATE messages SET content = $3, status = $4, updated_at = $5 WHERE id = $1 AND chat_id = $2`, [
    messageId,
    chatId,
    encryptJson(stored, msgCtx(chatId)),
    status,
    Date.now(),
  ]);
}

export async function getMessage(userId: string, messageId: string): Promise<{ chatId: string; message: ChatMessage }> {
  const row = await queryOne<MessageRow>(
    `SELECT m.id, m.chat_id, m.parent_id, m.role, m.content, m.model, m.status, m.feedback, m.created_at
       FROM messages m JOIN chats c ON c.id = m.chat_id
      WHERE m.id = $1 AND c.user_id = $2`,
    [messageId, userId],
  );
  if (!row) throw notFound("Message not found");
  return { chatId: row.chat_id, message: toMessage(row) };
}

export async function setFeedback(userId: string, messageId: string, value: number | null): Promise<void> {
  await getMessage(userId, messageId);
  await query(`UPDATE messages SET feedback = $2 WHERE id = $1`, [messageId, value]);
}

/** Walk from `leafId` to the root and return the path in order (root first). */
export async function getBranch(chatId: string, leafId: string | null): Promise<ChatMessage[]> {
  if (!leafId) return [];
  const rows = await query<MessageRow>(
    `SELECT id, chat_id, parent_id, role, content, model, status, feedback, created_at FROM messages WHERE chat_id = $1`,
    [chatId],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const path: ChatMessage[] = [];
  let cur = byId.get(leafId);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.push(toMessage(cur));
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return path.reverse();
}

export interface SearchHit {
  chat: ChatSummary;
  snippet: string;
}

/** Chats are encrypted, so search decrypts the user's chats in memory. */
export async function searchChats(userId: string, q: string, limit = 30): Promise<SearchHit[]> {
  const needle = q.trim().toLowerCase();
  const chats = await query<ChatRow>(
    `SELECT ${CHAT_COLS} FROM chats WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1000`,
    [userId],
  );
  if (!needle) return chats.slice(0, limit).map((c) => ({ chat: toSummary(c), snippet: "" }));
  const hits: SearchHit[] = [];
  const titleMatches = new Set<string>();
  for (const c of chats) {
    const s = toSummary(c);
    if (s.title.toLowerCase().includes(needle)) {
      hits.push({ chat: s, snippet: "" });
      titleMatches.add(c.id);
    }
  }
  const ids = chats.map((c) => c.id).filter((id) => !titleMatches.has(id));
  const rows = ids.length
    ? await query<MessageRow>(
        `SELECT id, chat_id, parent_id, role, content, model, status, feedback, created_at
           FROM messages WHERE chat_id = ANY($1::text[])`,
        [ids],
      )
    : [];
  const found = new Map<string, string>();
  for (const r of rows) {
    if (found.has(r.chat_id)) continue;
    const text = toMessage(r).text;
    const idx = text.toLowerCase().indexOf(needle);
    if (idx >= 0) {
      const start = Math.max(0, idx - 40);
      found.set(r.chat_id, (start > 0 ? "…" : "") + text.slice(start, idx + needle.length + 80).replace(/\s+/g, " "));
    }
  }
  for (const c of chats) {
    const snippet = found.get(c.id);
    if (snippet !== undefined) hits.push({ chat: toSummary(c), snippet });
  }
  hits.sort((a, b) => b.chat.updatedAt - a.chat.updatedAt);
  return hits.slice(0, limit);
}

export interface HistoryHit {
  chatId: string;
  title: string;
  date: number;
  excerpts: { role: "user" | "assistant"; text: string; date: number }[];
}

const STOPWORDS = new Set(
  "a an and are as at be but by can did do does for from had has have how i in is it its me my of on or our so that the their them then there these they this to was we were what when where which who why will with you your about did said tell told remember find search chat chats talked talk earlier before last time".split(
    " ",
  ),
);

/**
 * Keyword search over the user's past conversations, for the AI's search_chats tool.
 * Chats are encrypted at rest, so they're decrypted in memory here; no plaintext index is ever stored.
 */
export async function searchChatHistory(
  userId: string,
  q: string,
  opts: { excludeChatId?: string | null; limit?: number } = {},
): Promise<HistoryHit[]> {
  const phrase = q.trim().toLowerCase();
  const terms = [...new Set(phrase.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2 && !STOPWORDS.has(t)))].slice(0, 12);
  if (!terms.length && !phrase) return [];
  const chats = await query<ChatRow>(`SELECT ${CHAT_COLS} FROM chats WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1000`, [userId]);
  const byId = new Map(chats.filter((c) => c.id !== opts.excludeChatId).map((c) => [c.id, c]));
  if (!byId.size) return [];
  const rows = await query<MessageRow>(
    `SELECT id, chat_id, parent_id, role, content, model, status, feedback, created_at FROM messages WHERE chat_id = ANY($1::text[])`,
    [[...byId.keys()]],
  );

  const scoreText = (lower: string) => {
    let score = phrase.length > 3 && lower.includes(phrase) ? 6 : 0;
    for (const t of terms) {
      let n = 0;
      for (let i = lower.indexOf(t); i >= 0 && n < 3; i = lower.indexOf(t, i + t.length)) n++;
      score += n ? 1 + Math.min(n, 3) * 0.5 : 0;
    }
    return score;
  };
  const excerpt = (text: string, lower: string) => {
    const at = Math.max(0, Math.min(...[phrase, ...terms].map((t) => lower.indexOf(t)).filter((i) => i >= 0)));
    const start = Math.max(0, at - 160);
    return (start > 0 ? "…" : "") + text.slice(start, at + 340).replace(/\s+/g, " ").trim() + (at + 340 < text.length ? "…" : "");
  };

  const perChat = new Map<string, { score: number; hits: { score: number; ex: HistoryHit["excerpts"][number] }[] }>();
  for (const r of rows) {
    if (r.role !== "user" && r.role !== "assistant") continue;
    const text = toMessage(r).text;
    if (!text) continue;
    const lower = text.toLowerCase();
    const s = scoreText(lower);
    if (!s) continue;
    const entry = perChat.get(r.chat_id) ?? { score: 0, hits: [] };
    entry.score += s;
    entry.hits.push({ score: s, ex: { role: r.role as "user" | "assistant", text: excerpt(text, lower), date: num(r.created_at) } });
    perChat.set(r.chat_id, entry);
  }
  for (const [id, c] of byId) {
    const title = toSummary(c).title.toLowerCase();
    const s = scoreText(title);
    if (s) {
      const entry = perChat.get(id) ?? { score: 0, hits: [] };
      entry.score += s * 1.5;
      perChat.set(id, entry);
    }
  }

  return [...perChat.entries()]
    .map(([id, e]) => {
      const c = toSummary(byId.get(id)!);
      // Slightly prefer recent chats when scores are close.
      const ageDays = (Date.now() - c.updatedAt) / 86_400_000;
      return { id, c, e, rank: e.score / (1 + ageDays / 365) };
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, opts.limit ?? 5)
    .map(({ id, c, e }) => ({
      chatId: id,
      title: c.title,
      date: c.updatedAt,
      excerpts: e.hits
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((h) => h.ex)
        .sort((a, b) => a.date - b.date),
    }));
}
