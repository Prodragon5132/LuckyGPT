import { handler, json, HttpError, badRequest } from "@/lib/server/http";
import { listFiles, saveFile, MAX_UPLOAD_BYTES, type FileKind } from "@/lib/server/repo/files";
import { getGpt, getProject } from "@/lib/server/repo/misc";
import { consume } from "@/lib/server/ratelimit";

export const GET = handler(async (req, { user }) => {
  const sp = req.nextUrl.searchParams;
  const projectId = sp.get("projectId");
  const gptId = sp.get("gptId");
  if (projectId) return json(await listFiles(user.id, { projectId }));
  if (gptId) return json(await listFiles(user.id, { gptId }));
  if (sp.get("library") === "1") {
    return json(await listFiles(user.id, { kinds: ["generated", "upload"], imagesOnly: true }));
  }
  return json(await listFiles(user.id, { kinds: ["upload", "generated"] }));
});

export const POST = handler(async (req, { user }) => {
  const wait = await consume(`upload:${user.id}`, 60_000, 60);
  if (wait) throw new HttpError(429, "Too many uploads at once. Wait a moment.");
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_UPLOAD_BYTES + 100_000) throw new HttpError(413, "That file is too large (max 4 MB).");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("No file received.");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "That file is too large (max 4 MB).");
  const purpose = String(form.get("purpose") || "upload");
  let kind: FileKind = "upload";
  let projectId: string | null = null;
  let gptId: string | null = null;
  if (purpose === "project") {
    projectId = String(form.get("projectId") || "");
    await getProject(user.id, projectId);
    kind = "project";
  } else if (purpose === "gpt") {
    gptId = String(form.get("gptId") || "");
    await getGpt(user.id, gptId);
    kind = "gpt";
  } else if (purpose === "temp") {
    kind = "temp";
  }
  const data = Buffer.from(await file.arrayBuffer());
  const info = await saveFile({ userId: user.id, kind, name: file.name, mime: file.type, data, projectId, gptId });
  return json(info);
});
