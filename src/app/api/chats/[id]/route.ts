import { z } from "zod";
import { handler, json, readJson, badRequest } from "@/lib/server/http";
import { deleteChat, getBranch, getChat, getChatSummary, updateChat } from "@/lib/server/repo/chats";
import { getProject } from "@/lib/server/repo/misc";

const uuid = z.string().uuid();

export const GET = handler(async (_req, { user, params }) => {
  return json(await getChat(user.id, uuid.parse(params.id)));
});

const patchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  projectId: z.string().uuid().nullable().optional(),
  currentLeaf: z.string().uuid().optional(),
});

export const PATCH = handler(async (req, { user, params }) => {
  const id = uuid.parse(params.id);
  const body = patchSchema.parse(await readJson(req));
  if (body.projectId) await getProject(user.id, body.projectId);
  if (body.currentLeaf) {
    const branch = await getBranch(id, body.currentLeaf);
    if (!branch.length) throw badRequest("Unknown message");
  }
  await updateChat(user.id, id, body);
  return json(await getChatSummary(user.id, id));
});

export const DELETE = handler(async (_req, { user, params }) => {
  await deleteChat(user.id, uuid.parse(params.id));
  return json({ ok: true });
});
