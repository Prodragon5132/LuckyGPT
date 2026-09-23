"use client";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const BASE_HEADERS = { "x-lgpt": "1" };

async function parseError(res: Response): Promise<ApiError> {
  let data: Record<string, unknown> | undefined;
  try {
    data = await res.json();
  } catch {
    /* not json */
  }
  const message = (data?.error as string) || `Request failed (${res.status})`;
  return new ApiError(res.status, message, data);
}

function handleUnauthorized(status: number) {
  if (status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/login")) {
    location.href = "/login";
  }
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers: opts.body !== undefined ? { ...BASE_HEADERS, "Content-Type": "application/json" } : BASE_HEADERS,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!res.ok) {
    handleUnauthorized(res.status);
    throw await parseError(res);
  }
  return (await res.json()) as T;
}

export async function apiRaw(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, {
    ...init,
    headers: { ...BASE_HEADERS, ...(init.headers as Record<string, string> | undefined) },
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!res.ok) {
    handleUnauthorized(res.status);
    throw await parseError(res);
  }
  return res;
}

export function uploadFile(
  file: Blob,
  name: string,
  extra: Record<string, string> = {},
  onProgress?: (fraction: number) => void,
): Promise<import("@/lib/shared/types").FileInfo> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file, name);
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files");
    xhr.setRequestHeader("x-lgpt", "1");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as never);
      else {
        handleUnauthorized(xhr.status);
        reject(new ApiError(xhr.status, (data.error as string) || "Upload failed"));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "Upload failed. Check your connection."));
    xhr.send(form);
  });
}

export const fileUrl = (id: string, opts: { share?: string; download?: boolean } = {}) => {
  const q = new URLSearchParams();
  if (opts.share) q.set("share", opts.share);
  if (opts.download) q.set("download", "1");
  const s = q.toString();
  return `/api/files/${id}${s ? `?${s}` : ""}`;
};
