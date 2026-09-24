import { handler, json } from "@/lib/server/http";
import { getConfig, getSecrets } from "@/lib/server/settings";
import { enabledModels } from "@/lib/server/providers";
import { countRecent, OPENROUTER_USAGE_KEY } from "@/lib/server/ratelimit";
import type { UsageInfo } from "@/lib/shared/types";

/** OpenRouter allows 1000 requests a day on free models (after a $10 top-up), so that's the fallback bar. */
const DAILY_PROMPTS = 1000;

let cache: { key: string; at: number; credits: UsageInfo["credits"] } | null = null;

async function openRouterJson(path: string, key: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`https://openrouter.ai/api/v1${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Record<string, unknown> };
    return body.data ?? null;
  } catch {
    return null;
  }
}

/** Spend vs. the key's limit, or vs. the account's credits. null if OpenRouter doesn't say. */
async function openRouterCredits(key: string): Promise<UsageInfo["credits"]> {
  if (cache && cache.key === key && Date.now() - cache.at < 60_000) return cache.credits;
  let credits: UsageInfo["credits"] = null;
  const k = await openRouterJson("/key", key);
  if (k && typeof k.limit === "number" && k.limit > 0) {
    const remaining = typeof k.limit_remaining === "number" ? k.limit_remaining : k.limit - Number(k.usage ?? 0);
    credits = { used: Math.max(0, k.limit - remaining), total: k.limit, label: "Key spending limit" };
  } else {
    const c = await openRouterJson("/credits", key);
    if (c && typeof c.total_credits === "number" && c.total_credits > 0) {
      credits = { used: Number(c.total_usage ?? 0), total: c.total_credits, label: "OpenRouter credits" };
    }
  }
  cache = { key, at: Date.now(), credits };
  return credits;
}

export const GET = handler(async () => {
  const [config, secrets] = await Promise.all([getConfig(), getSecrets()]);
  const key = secrets.openrouterChat?.apiKey || secrets.openrouter?.apiKey;
  const usesOpenRouter = !!key && enabledModels(config, secrets).some((m) => m.provider === "openrouter");
  if (!usesOpenRouter) return json({ openrouter: false, credits: null, prompts: null } satisfies UsageInfo);

  const now = new Date();
  const midnightUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const [credits, today] = await Promise.all([openRouterCredits(key), countRecent(OPENROUTER_USAGE_KEY, Date.now() - midnightUtc)]);
  return json({
    openrouter: true,
    credits,
    prompts: { used: today.count, total: DAILY_PROMPTS, resetsAt: midnightUtc + 24 * 3600_000 },
  } satisfies UsageInfo);
});
