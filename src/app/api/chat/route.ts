import { handler, readJson, HttpError } from "@/lib/server/http";
import { chatRequestSchema, runChat } from "@/lib/server/engine";
import { consume } from "@/lib/server/ratelimit";

// Long answers (reasoning, deep research) can take a few minutes.
export const maxDuration = 300;

export const POST = handler(async (req, { user }) => {
  const wait = await consume(`chat:${user.id}`, 60_000, 40);
  if (wait) throw new HttpError(429, "You're sending messages too quickly. Wait a moment and try again.");
  const body = chatRequestSchema.parse(await readJson(req, 1_500_000));
  return runChat(user, body, req.signal);
});
