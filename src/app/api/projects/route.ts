import { handler, json, readJson } from "@/lib/server/http";
import { listProjects, saveProject } from "@/lib/server/repo/misc";
import { projectSchema } from "@/lib/server/schemas";

export const GET = handler(async (_req, { user }) => json(await listProjects(user.id)));

export const POST = handler(async (req, { user }) => {
  const body = projectSchema.parse(await readJson(req));
  return json(await saveProject(user.id, null, body));
});
