import { handler, json } from "@/lib/server/http";
import { searchChats } from "@/lib/server/repo/chats";

export const GET = handler(async (req, { user }) => {
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 200);
  return json(await searchChats(user.id, q));
});
