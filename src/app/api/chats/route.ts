import { handler, json } from "@/lib/server/http";
import { listChats } from "@/lib/server/repo/chats";

export const GET = handler(async (req, { user }) => {
  const sp = req.nextUrl.searchParams;
  const archived = sp.get("archived") === "1";
  const projectId = sp.get("projectId");
  return json(await listChats(user.id, { archived, projectId: projectId ?? undefined }));
});
