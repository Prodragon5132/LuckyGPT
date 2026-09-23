import { z } from "zod";
import { handler, json, readJson, badRequest } from "@/lib/server/http";
import { getMessage, setFeedback, updateMessageBody } from "@/lib/server/repo/chats";

const schema = z.object({
  feedback: z.union([z.literal(1), z.literal(-1), z.null()]).optional(),
  canvas: z
    .object({
      id: z.string().max(64),
      title: z.string().max(300),
      kind: z.enum(["document", "code"]),
      language: z.string().max(40).optional(),
      content: z.string().max(500_000),
    })
    .optional(),
});

export const PATCH = handler(async (req, { user, params }) => {
  const id = z.string().uuid().parse(params.id);
  const body = schema.parse(await readJson(req, 1_000_000));
  if (body.feedback !== undefined) await setFeedback(user.id, id, body.feedback);
  if (body.canvas) {
    const { chatId, message } = await getMessage(user.id, id);
    if (message.role !== "assistant") throw badRequest("Only assistant messages have a canvas.");
    const { id: _id, parentId: _p, role: _r, model: _m, modelName, status, feedback: _f, createdAt: _c, ...rest } = message;
    await updateMessageBody(chatId, id, { ...rest, canvas: body.canvas }, status, modelName);
  }
  return json({ ok: true });
});
