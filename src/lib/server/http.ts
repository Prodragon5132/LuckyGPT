import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { getRequestUser, type SessionUser } from "./auth";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg);
export const notFound = (msg = "Not found") => new HttpError(404, msg);
export const forbidden = (msg = "Not allowed") => new HttpError(403, msg);

export function json(data: unknown, init?: ResponseInit): NextResponse {
  const res = NextResponse.json(data, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim().slice(0, 64);
  return (req.headers.get("x-real-ip") || "unknown").slice(0, 64);
}

export function isSecureRequest(req: NextRequest): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  return req.nextUrl.protocol === "https:";
}

/**
 * Cross-site request forgery protection: state-changing requests must come
 * from our own origin and carry our custom header (which cross-site forms
 * cannot set without a CORS preflight that we never allow).
 */
function assertSameOrigin(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (!origin || !host) throw new HttpError(403, "Missing origin");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "Bad origin");
  }
  if (originHost !== host.split(",")[0].trim()) throw new HttpError(403, "Cross-site request blocked");
  if (req.headers.get("x-lgpt") !== "1") throw new HttpError(403, "Missing request header");
}

type Ctx = { params: Promise<Record<string, string | string[]>> };
type Auth = "user" | "admin" | "none";

export interface HandlerCtx {
  user: SessionUser;
  params: Record<string, string>;
}

export interface PublicHandlerCtx {
  user: SessionUser | null;
  params: Record<string, string>;
}

export function handler(
  fn: (req: NextRequest, ctx: HandlerCtx) => Promise<Response>,
  opts?: { auth?: "user" | "admin" },
): (req: NextRequest, ctx: Ctx) => Promise<Response>;
export function handler(
  fn: (req: NextRequest, ctx: PublicHandlerCtx) => Promise<Response>,
  opts: { auth: "none" },
): (req: NextRequest, ctx: Ctx) => Promise<Response>;
export function handler(
  fn: (req: NextRequest, ctx: HandlerCtx & PublicHandlerCtx) => Promise<Response>,
  opts: { auth?: Auth } = {},
) {
  const auth = opts.auth ?? "user";
  return async (req: NextRequest, ctx: Ctx): Promise<Response> => {
    try {
      assertSameOrigin(req);
      const rawParams = ctx?.params ? await ctx.params : {};
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawParams)) params[k] = Array.isArray(v) ? v.join("/") : v;
      const user = await getRequestUser(req);
      if (auth !== "none" && !user) throw new HttpError(401, "Please log in again.");
      if (auth === "admin" && user?.role !== "admin") throw new HttpError(403, "Only admins can do that.");
      const res = await fn(req, { user: user as SessionUser, params });
      if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "no-store");
      return res;
    } catch (err) {
      if (err instanceof HttpError) {
        return json({ error: err.message, ...err.extra }, { status: err.status });
      }
      if (err instanceof ZodError) {
        const first = err.issues[0];
        return json(
          { error: first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input" },
          { status: 400 },
        );
      }
      console.error("[api]", req.method, req.nextUrl.pathname, err);
      void import("./errorlog").then((m) => m.logError("server", err, { where: `${req.method} ${req.nextUrl.pathname}` }));
      return json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
  };
}

export async function readJson<T = unknown>(req: NextRequest, maxBytes = 1_000_000): Promise<T> {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > maxBytes) throw new HttpError(413, "Request too large");
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request too large");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw badRequest("Invalid JSON");
  }
}
