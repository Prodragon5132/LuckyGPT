import { z } from "zod";
import { handler, json, readJson, HttpError } from "@/lib/server/http";
import { encryptPrefs, loadUserInfo } from "@/lib/server/auth";
import { query } from "@/lib/server/db";

const prefsSchema = z
  .object({
    theme: z.enum(["system", "light", "dark"]),
    accent: z.enum(["default", "blue", "green", "yellow", "pink", "orange", "purple"]),
    defaultModel: z.string().max(100).nullable(),
    voice: z.string().max(100),
    spokenLanguage: z.string().max(20),
    personality: z.enum(["default", "cynic", "robot", "listener", "nerd"]),
    customInstructions: z.object({
      enabled: z.boolean(),
      nickname: z.string().max(100),
      occupation: z.string().max(200),
      traits: z.string().max(1500),
      about: z.string().max(1500),
    }),
    memoryEnabled: z.boolean(),
    followUps: z.boolean(),
    autoReadAloud: z.boolean(),
  })
  .partial();

const schema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  prefs: prefsSchema.optional(),
});

export const PATCH = handler(async (req, { user }) => {
  const body = schema.parse(await readJson(req));
  const current = await loadUserInfo(user.id);
  if (!current) throw new HttpError(401, "Please log in again.");
  const prefs = {
    ...current.prefs,
    ...(body.prefs ?? {}),
    customInstructions: { ...current.prefs.customInstructions, ...(body.prefs?.customInstructions ?? {}) },
  };
  await query(`UPDATE users SET name = $2, prefs = $3, updated_at = $4 WHERE id = $1`, [
    user.id,
    body.name ?? current.name,
    encryptPrefs(prefs),
    Date.now(),
  ]);
  return json(await loadUserInfo(user.id));
});
