import { z } from "zod";
import { handler, json, notFound } from "@/lib/server/http";
import { deleteFile, getFileData, isImageMime } from "@/lib/server/repo/files";
import { shareContainsFile } from "@/lib/server/repo/misc";

const uuid = z.string().uuid();

export const GET = handler(
  async (req, { user, params }) => {
    const id = uuid.parse(params.id);
    const shareId = req.nextUrl.searchParams.get("share");
    let ownerId = user?.id ?? null;
    if (shareId) {
      // Public viewers of a shared chat may load the images that are part of that share.
      ownerId = await shareContainsFile(shareId, id);
    }
    if (!ownerId) throw notFound();
    const { info, data } = await getFileData(ownerId, id);
    const inline = isImageMime(info.mime) && req.nextUrl.searchParams.get("download") !== "1";
    const filename = encodeURIComponent(info.name);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": inline ? info.mime : "application/octet-stream",
        "Content-Length": String(data.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${filename}`,
        "Cache-Control": shareId ? "public, max-age=300" : "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
  { auth: "none" },
);

export const DELETE = handler(async (_req, { user, params }) => {
  await deleteFile(user.id, uuid.parse(params.id));
  return json({ ok: true });
});
