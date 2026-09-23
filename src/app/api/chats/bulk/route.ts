import { z } from "zod";
import { handler, json, readJson } from "@/lib/server/http";
import { archiveAllChats, deleteAllChats } from "@/lib/server/repo/chats";
import { query } from "@/lib/server/db";

const schema = z.object({ action: z.enum(["archiveAll", "deleteAll", "unarchiveAll"]) });

export const POST = handler(async (req, { user }) => {
  const { action } = schema.parse(await readJson(req));
  if (action === "archiveAll") await archiveAllChats(user.id);
  if (action === "unarchiveAll") await query(`UPDATE chats SET archived = FALSE WHERE user_id = $1`, [user.id]);
  if (action === "deleteAll") await deleteAllChats(user.id);
  return json({ ok: true });
});
