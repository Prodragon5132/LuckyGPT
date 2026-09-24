import { z } from "zod";
import { handler, json, readJson } from "@/lib/server/http";
import { logError } from "@/lib/server/errorlog";
import { consume } from "@/lib/server/ratelimit";

/** Browser errors (crashes in the page), recorded anonymously. See errorlog.ts. */
const schema = z.object({
  message: z.string().max(1000),
  stack: z.string().max(4000).optional(),
  where: z.string().max(200).optional(),
});

export const POST = handler(async (req, { user }) => {
  const body = schema.parse(await readJson(req, 10_000));
  // A broken page shouldn't be able to flood the log.
  if (await consume(`errlog:${user.id}`, 60_000, 20)) return json({ ok: true });
  const err = new Error(body.message);
  err.name = "BrowserError";
  err.stack = `BrowserError: ${body.message}\n${body.stack ?? ""}`;
  await logError("browser", err, { where: body.where });
  return json({ ok: true });
});
