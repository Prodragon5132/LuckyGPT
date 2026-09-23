import { handler, json, HttpError } from "@/lib/server/http";
import { loadUserInfo } from "@/lib/server/auth";

export const GET = handler(async (_req, { user }) => {
  const info = await loadUserInfo(user.id);
  if (!info) throw new HttpError(401, "Please log in again.");
  return json(info);
});
