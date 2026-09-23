import "server-only";
import { query, queryOne, num } from "../db";
import { decryptJson, decryptText, encryptJson, encryptText, newId, randomToken } from "../crypto";
import { notFound } from "../http";
import type { ChatMessage, Gpt, Memory, Project } from "@/lib/shared/types";

// ---------- Projects ----------

interface DataRow extends Record<string, unknown> {
  id: string;
  data: string;
  created_at: number;
  updated_at: number;
}

type ProjectData = Pick<Project, "name" | "instructions" | "color">;

function toProject(row: DataRow): Project {
  const d = decryptJson<ProjectData>(row.data, { name: "Project", instructions: "", color: "" }, `project:${row.id}`);
  return { id: row.id, ...d, createdAt: num(row.created_at), updatedAt: num(row.updated_at) };
}

export async function listProjects(userId: string): Promise<Project[]> {
  const rows = await query<DataRow>(
    `SELECT id, data, created_at, updated_at FROM projects WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(toProject);
}

export async function getProject(userId: string, id: string): Promise<Project> {
  const row = await queryOne<DataRow>(
    `SELECT id, data, created_at, updated_at FROM projects WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (!row) throw notFound("Project not found");
  return toProject(row);
}

export async function saveProject(userId: string, id: string | null, data: ProjectData): Promise<Project> {
  const now = Date.now();
  if (id) {
    await getProject(userId, id);
    await query(`UPDATE projects SET data = $3, updated_at = $4 WHERE id = $1 AND user_id = $2`, [
      id,
      userId,
      encryptJson(data, `project:${id}`),
      now,
    ]);
    return getProject(userId, id);
  }
  const newProjectId = newId();
  await query(`INSERT INTO projects (id, user_id, data, created_at, updated_at) VALUES ($1,$2,$3,$4,$4)`, [
    newProjectId,
    userId,
    encryptJson(data, `project:${newProjectId}`),
    now,
  ]);
  return getProject(userId, newProjectId);
}

export async function deleteProject(userId: string, id: string): Promise<void> {
  await query(`DELETE FROM projects WHERE id = $1 AND user_id = $2`, [id, userId]);
}

// ---------- GPTs ----------

type GptData = Omit<Gpt, "id" | "pinned" | "createdAt" | "updatedAt">;

function toGpt(row: DataRow & { pinned: boolean }): Gpt {
  const d = decryptJson<GptData>(
    row.data,
    {
      name: "GPT",
      description: "",
      instructions: "",
      starters: [],
      icon: "✨",
      color: "",
      modelId: null,
      capabilities: { search: true, image: true },
    },
    `gpt:${row.id}`,
  );
  return { id: row.id, ...d, pinned: !!row.pinned, createdAt: num(row.created_at), updatedAt: num(row.updated_at) };
}

export async function listGpts(userId: string): Promise<Gpt[]> {
  const rows = await query<DataRow & { pinned: boolean }>(
    `SELECT id, data, pinned, created_at, updated_at FROM gpts WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(toGpt);
}

export async function getGpt(userId: string, id: string): Promise<Gpt> {
  const row = await queryOne<DataRow & { pinned: boolean }>(
    `SELECT id, data, pinned, created_at, updated_at FROM gpts WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (!row) throw notFound("GPT not found");
  return toGpt(row);
}

export async function saveGpt(userId: string, id: string | null, data: GptData, pinned?: boolean): Promise<Gpt> {
  const now = Date.now();
  if (id) {
    const existing = await getGpt(userId, id);
    await query(`UPDATE gpts SET data = $3, pinned = $4, updated_at = $5 WHERE id = $1 AND user_id = $2`, [
      id,
      userId,
      encryptJson(data, `gpt:${id}`),
      pinned ?? existing.pinned,
      now,
    ]);
    return getGpt(userId, id);
  }
  const gptId = newId();
  await query(`INSERT INTO gpts (id, user_id, data, pinned, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$5)`, [
    gptId,
    userId,
    encryptJson(data, `gpt:${gptId}`),
    pinned ?? true,
    now,
  ]);
  return getGpt(userId, gptId);
}

export async function setGptPinned(userId: string, id: string, pinned: boolean): Promise<void> {
  await query(`UPDATE gpts SET pinned = $3 WHERE id = $1 AND user_id = $2`, [id, userId, pinned]);
}

export async function deleteGpt(userId: string, id: string): Promise<void> {
  await query(`DELETE FROM gpts WHERE id = $1 AND user_id = $2`, [id, userId]);
}

// ---------- Memories ----------

export async function listMemories(userId: string): Promise<Memory[]> {
  const rows = await query<{ id: string; content: string; created_at: number }>(
    `SELECT id, content, created_at FROM memories WHERE user_id = $1 ORDER BY created_at ASC`,
    [userId],
  );
  return rows.map((r) => ({ id: r.id, content: decryptText(r.content, `memory:${userId}`), createdAt: num(r.created_at) }));
}

export async function addMemory(userId: string, content: string): Promise<Memory> {
  const id = newId();
  const now = Date.now();
  const text = content.trim().slice(0, 1000);
  await query(`INSERT INTO memories (id, user_id, content, created_at) VALUES ($1,$2,$3,$4)`, [
    id,
    userId,
    encryptText(text, `memory:${userId}`),
    now,
  ]);
  return { id, content: text, createdAt: now };
}

export async function deleteMemory(userId: string, id: string): Promise<void> {
  await query(`DELETE FROM memories WHERE id = $1 AND user_id = $2`, [id, userId]);
}

export async function deleteAllMemories(userId: string): Promise<void> {
  await query(`DELETE FROM memories WHERE user_id = $1`, [userId]);
}

// ---------- Shared links ----------

export interface ShareSnapshot {
  title: string;
  messages: Pick<ChatMessage, "id" | "role" | "text" | "modelName" | "sources" | "images" | "attachments">[];
  sharedBy: string;
}

export async function createShare(userId: string, chatId: string, snapshot: ShareSnapshot): Promise<string> {
  const existing = await queryOne<{ id: string }>(`SELECT id FROM shares WHERE user_id = $1 AND chat_id = $2`, [
    userId,
    chatId,
  ]);
  const now = Date.now();
  if (existing) {
    await query(`UPDATE shares SET snapshot = $2, updated_at = $3 WHERE id = $1`, [
      existing.id,
      encryptJson(snapshot, `share:${existing.id}`),
      now,
    ]);
    return existing.id;
  }
  const id = randomToken(18);
  await query(`INSERT INTO shares (id, user_id, chat_id, snapshot, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$5)`, [
    id,
    userId,
    chatId,
    encryptJson(snapshot, `share:${id}`),
    now,
  ]);
  return id;
}

export async function getShare(id: string): Promise<(ShareSnapshot & { userId: string; createdAt: number }) | null> {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(id)) return null;
  const row = await queryOne<{ id: string; user_id: string; snapshot: string; updated_at: number }>(
    `SELECT id, user_id, snapshot, updated_at FROM shares WHERE id = $1`,
    [id],
  );
  if (!row) return null;
  const snap = decryptJson<ShareSnapshot | null>(row.snapshot, null, `share:${row.id}`);
  return snap ? { ...snap, userId: row.user_id, createdAt: num(row.updated_at) } : null;
}

export async function listShares(userId: string): Promise<{ id: string; chatId: string; title: string; createdAt: number }[]> {
  const rows = await query<{ id: string; chat_id: string; snapshot: string; updated_at: number }>(
    `SELECT id, chat_id, snapshot, updated_at FROM shares WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    chatId: r.chat_id,
    title: decryptJson<ShareSnapshot | null>(r.snapshot, null, `share:${r.id}`)?.title ?? "Shared chat",
    createdAt: num(r.updated_at),
  }));
}

export async function deleteShare(userId: string, id: string): Promise<void> {
  await query(`DELETE FROM shares WHERE id = $1 AND user_id = $2`, [id, userId]);
}

export async function deleteAllShares(userId: string): Promise<void> {
  await query(`DELETE FROM shares WHERE user_id = $1`, [userId]);
}

/** Is this file referenced by one of the owner's shared chats? (lets public viewers load its images) */
export async function shareContainsFile(shareId: string, fileId: string): Promise<string | null> {
  const share = await getShare(shareId);
  if (!share) return null;
  const has = share.messages.some(
    (m) => m.images?.some((i) => i.id === fileId) || m.attachments?.some((a) => a.id === fileId),
  );
  return has ? share.userId : null;
}
