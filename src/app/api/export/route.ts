import { handler } from "@/lib/server/http";
import { getChat, listChats } from "@/lib/server/repo/chats";
import { listGpts, listMemories, listProjects } from "@/lib/server/repo/misc";
import { loadUserInfo } from "@/lib/server/auth";
import { consume } from "@/lib/server/ratelimit";
import { HttpError } from "@/lib/server/http";

export const maxDuration = 120;

/** Download all of your data (chats, memories, projects, GPTs) as JSON. */
export const GET = handler(async (_req, { user }) => {
  const wait = await consume(`export:${user.id}`, 10 * 60_000, 5);
  if (wait) throw new HttpError(429, "Please wait a few minutes before exporting again.");
  const info = await loadUserInfo(user.id);
  const summaries = [...(await listChats(user.id)), ...(await listChats(user.id, { archived: true }))];
  const conversations = [];
  for (const s of summaries) {
    const chat = await getChat(user.id, s.id);
    conversations.push({
      id: chat.id,
      title: chat.title,
      created: new Date(chat.createdAt).toISOString(),
      updated: new Date(chat.updatedAt).toISOString(),
      archived: chat.archived,
      projectId: chat.projectId,
      messages: chat.messages.map((m) => ({
        id: m.id,
        parentId: m.parentId,
        role: m.role,
        model: m.modelName,
        text: m.text,
        reasoning: m.reasoning,
        sources: m.sources,
        attachments: m.attachments?.map((a) => a.name),
        created: new Date(m.createdAt).toISOString(),
      })),
    });
  }
  const payload = {
    exportedAt: new Date().toISOString(),
    user: { username: info?.username, name: info?.name, customInstructions: info?.prefs.customInstructions },
    memories: await listMemories(user.id),
    projects: await listProjects(user.id),
    gpts: await listGpts(user.id),
    conversations,
  };
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="luckygpt-export-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
});
