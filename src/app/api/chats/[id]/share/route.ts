import { z } from "zod";
import { handler, json } from "@/lib/server/http";
import { getBranch, getChatRow, getChatSummary } from "@/lib/server/repo/chats";
import { createShare } from "@/lib/server/repo/misc";

/** Creates (or refreshes) a read-only public link to the current conversation branch. */
export const POST = handler(async (_req, { user, params }) => {
  const id = z.string().uuid().parse(params.id);
  const row = await getChatRow(user.id, id);
  const summary = await getChatSummary(user.id, id);
  const branch = await getBranch(id, row.current_leaf);
  const shareId = await createShare(user.id, id, {
    title: summary.title,
    sharedBy: user.name,
    messages: branch
      .filter((m) => m.text || m.images?.length)
      .map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        modelName: m.modelName,
        sources: m.sources,
        images: m.images,
        attachments: m.attachments?.filter((a) => a.mime.startsWith("image/")),
      })),
  });
  return json({ id: shareId, path: `/share/${shareId}` });
});
