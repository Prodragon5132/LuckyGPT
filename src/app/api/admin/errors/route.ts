import { handler, json } from "@/lib/server/http";
import { clearErrors, listErrors } from "@/lib/server/errorlog";

export const GET = handler(async () => json(await listErrors()), { auth: "admin" });

export const DELETE = handler(
  async () => {
    await clearErrors();
    return json({ ok: true });
  },
  { auth: "admin" },
);
