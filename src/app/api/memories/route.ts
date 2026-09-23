import { z } from "zod";
import { handler, json, readJson } from "@/lib/server/http";
import { addMemory, deleteAllMemories, listMemories } from "@/lib/server/repo/misc";

export const GET = handler(async (_req, { user }) => json(await listMemories(user.id)));

export const POST = handler(async (req, { user }) => {
  const { content } = z.object({ content: z.string().trim().min(1).max(1000) }).parse(await readJson(req));
  return json(await addMemory(user.id, content));
});

export const DELETE = handler(async (_req, { user }) => {
  await deleteAllMemories(user.id);
  return json({ ok: true });
});
