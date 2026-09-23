import { z } from "zod";
import { handler, json, readJson } from "@/lib/server/http";
import { deleteProject, getProject, saveProject } from "@/lib/server/repo/misc";

const uuid = z.string().uuid();
const patch = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  instructions: z.string().max(8000).optional(),
  color: z.string().max(20).optional(),
});

export const GET = handler(async (_req, { user, params }) => json(await getProject(user.id, uuid.parse(params.id))));

export const PATCH = handler(async (req, { user, params }) => {
  const id = uuid.parse(params.id);
  const current = await getProject(user.id, id);
  const body = patch.parse(await readJson(req));
  return json(
    await saveProject(user.id, id, {
      name: body.name ?? current.name,
      instructions: body.instructions ?? current.instructions,
      color: body.color ?? current.color,
    }),
  );
});

export const DELETE = handler(async (_req, { user, params }) => {
  await deleteProject(user.id, uuid.parse(params.id));
  return json({ ok: true });
});
