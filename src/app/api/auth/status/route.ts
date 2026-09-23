import { handler, json } from "@/lib/server/http";
import { userCount } from "@/lib/server/auth";
import { setupCodeRequired } from "@/lib/server/env";

export const GET = handler(
  async (_req, { user }) => {
    const needsSetup = (await userCount()) === 0;
    return json({ needsSetup, setupCodeRequired: needsSetup ? setupCodeRequired() : false, loggedIn: !!user });
  },
  { auth: "none" },
);
