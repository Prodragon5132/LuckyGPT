import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every page request:
 *  - adds a strict Content-Security-Policy with a per-request nonce (blocks injected scripts)
 *  - sends people who aren't logged in to /login (the pages and APIs check the session properly too)
 */

const PUBLIC_PAGES = ["/login", "/setup", "/share/"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (!isApi) {
    const hasSession =
      request.cookies.has("__Host-lgpt_session") || request.cookies.has("lgpt_session");
    const isPublic = PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(p));
    if (!hasSession && !isPublic) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const https = (request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "")) === "https";

  const csp = isApi
    ? "default-src 'none'; img-src 'self' data: blob:; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox"
    : [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' blob: data:",
        "font-src 'self' data:",
        "media-src 'self' blob: data:",
        `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
        "worker-src 'self' blob:",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        https ? "upgrade-insecure-requests" : "",
      ]
        .filter(Boolean)
        .join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|robots.txt|sw.js).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
