"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import { cn, dateGroup } from "@/lib/client/utils";
import type { ChatSummary } from "@/lib/shared/types";
import { CloseIcon, NewChatIcon, SearchIcon } from "./icons";
import { Portal, Spinner } from "./ui";
import { newChat } from "./Sidebar";

interface Hit {
  chat: ChatSummary;
  snippet: string;
}

export function SearchDialog() {
  const open = useApp((s) => s.searchOpen);
  return open ? <SearchPanel /> : null;
}

function SearchPanel() {
  const chats = useApp((s) => s.chats);
  const set = useApp((s) => s.set);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<{ q: string; hits: Hit[] } | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const query = q.trim();
  const hits = query && result?.q === query ? result.hits : null;
  const loading = !!query && result?.q !== query;

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!query) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const found = await api<Hit[]>(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        setResult({ q: query, hits: found });
        setActive(0);
      } catch {
        /* aborted */
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  const rows = useMemo(() => {
    const list: Hit[] = query ? (hits ?? []) : chats.filter((c) => !c.archived).slice(0, 40).map((chat) => ({ chat, snippet: "" }));
    const out: (Hit & { header: string | null })[] = [];
    for (let i = 0; i < list.length; i++) {
      const group = query ? "" : dateGroup(list[i].chat.updatedAt);
      const prev = i > 0 && !query ? dateGroup(list[i - 1].chat.updatedAt) : "";
      out.push({ ...list[i], header: group && group !== prev ? group : null });
    }
    return out;
  }, [query, hits, chats]);

  const close = () => set({ searchOpen: false });
  const go = (id: string | null) => {
    close();
    if (id) {
      set({ temporary: false, mobileNav: false });
      router.push(`/c/${id}`);
    } else newChat(router);
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--overlay)] p-3 pt-[10vh] fade-in" onMouseDown={close}>
        <div
          className="pop-in flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-elevated shadow-2xl dark:bg-[#2f2f2f]"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 border-b border-line-2 px-4 py-3.5">
            <SearchIcon size={20} className="text-fg-3" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search chats..."
              className="flex-1 bg-transparent text-base outline-none"
              onKeyDown={(e) => {
                if (e.key === "Escape") close();
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, rows.length));
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  go(active === 0 ? null : rows[active - 1]?.chat.id ?? null);
                }
              }}
            />
            {loading && <Spinner size={16} className="text-fg-3" />}
            <button onClick={close} className="rounded-full p-1 text-fg-2 hover:bg-hover" aria-label="Close search">
              <CloseIcon size={18} />
            </button>
          </div>
          <div className="scroll-thin overflow-y-auto p-2">
            <button
              onClick={() => go(null)}
              onMouseEnter={() => setActive(0)}
              className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm", active === 0 && "bg-hover")}
            >
              <NewChatIcon size={18} /> New chat
            </button>
            {rows.length === 0 && hits && <div className="px-3 py-6 text-center text-sm text-fg-3">No chats found.</div>}
            {rows.map((h, i) => {
              return (
                <div key={h.chat.id}>
                  {h.header && <div className="px-3 pb-1 pt-3 text-xs font-medium text-fg-3">{h.header}</div>}
                  <button
                    onClick={() => go(h.chat.id)}
                    onMouseEnter={() => setActive(i + 1)}
                    className={cn("flex w-full flex-col rounded-xl px-3 py-2.5 text-left", active === i + 1 && "bg-hover")}
                  >
                    <span className="truncate text-sm">{h.chat.title}</span>
                    {h.snippet && <span className="mt-0.5 line-clamp-2 text-xs text-fg-3">{h.snippet}</span>}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Portal>
  );
}
