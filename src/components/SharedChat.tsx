"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Markdown } from "./Markdown";
import { fileUrl } from "@/lib/client/api";
import { Logo } from "./icons";
import type { Attachment, Source } from "@/lib/shared/types";

interface SharedMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  modelName?: string | null;
  sources?: Source[];
  images?: Attachment[];
  attachments?: Attachment[];
}

function Images({ items, shareId }: { items: Attachment[]; shareId: string }) {
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {items.map((a) => (
        <a key={a.id} href={fileUrl(a.id, { share: shareId })} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fileUrl(a.id, { share: shareId })} alt={a.name} className="max-h-80 max-w-full rounded-2xl" />
        </a>
      ))}
    </div>
  );
}

export function SharedChat({
  shareId,
  title,
  date,
  messages,
}: {
  shareId: string;
  title: string;
  date: string;
  messages: SharedMessage[];
}) {
  useEffect(() => {
    try {
      const t = localStorage.getItem("lgpt-theme") || "system";
      const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="h-dvh overflow-y-auto bg-surface text-fg scroll-thin">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-line-2 bg-surface/90 px-4 backdrop-blur">
        <Link href="/" className="flex items-center gap-2 font-medium">
          <Logo size={24} className="text-[#1f9d63]" /> LuckyGPT
        </Link>
        <Link href="/login" className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-fg">
          Log in
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-8 sm:px-6">
        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="mb-8 mt-2 border-b border-line-2 pb-6 text-sm text-fg-3">{date}</p>
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="mb-6 flex flex-col items-end">
              {m.attachments?.length ? <Images items={m.attachments} shareId={shareId} /> : null}
              {m.text && <div className="max-w-[85%] whitespace-pre-wrap rounded-[22px] bg-bubble px-4 py-2.5 leading-7 sm:max-w-[70%]">{m.text}</div>}
            </div>
          ) : (
            <div key={m.id} className="mb-8">
              {m.images?.length ? <Images items={m.images} shareId={shareId} /> : null}
              <Markdown text={m.text} />
              {m.sources?.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {m.sources.slice(0, 8).map((s) => (
                    <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="max-w-[220px] truncate rounded-full border border-line px-2.5 py-1 text-xs text-fg-2 hover:bg-hover">
                      {s.title || s.url}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          ),
        )}
        <p className="mt-12 text-center text-xs text-fg-3">This is a copy of a conversation shared from LuckyGPT. AI can make mistakes.</p>
      </main>
    </div>
  );
}
