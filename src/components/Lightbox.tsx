"use client";

import { useEffect } from "react";
import { useApp } from "@/lib/client/store";
import { fileUrl } from "@/lib/client/api";
import { CloseIcon, DownloadIcon } from "./icons";
import { Portal } from "./ui";

export function Lightbox() {
  const lb = useApp((s) => s.lightbox);
  const set = useApp((s) => s.set);
  useEffect(() => {
    if (!lb) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && set({ lightbox: null });
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lb, set]);
  if (!lb) return null;
  return (
    <Portal>
      <div className="safe-area fixed inset-0 z-[65] flex flex-col bg-black/90 fade-in" onClick={() => set({ lightbox: null })}>
        <div className="flex items-center justify-end gap-2 p-3" onClick={(e) => e.stopPropagation()}>
          <a
            href={fileUrl(lb.id, { download: true, share: lb.share })}
            className="flex h-10 items-center gap-2 rounded-full bg-white/10 px-4 text-sm text-white hover:bg-white/20"
          >
            <DownloadIcon size={18} /> Download
          </a>
          <button
            onClick={() => set({ lightbox: null })}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="Close"
          >
            <CloseIcon size={20} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fileUrl(lb.id, { share: lb.share })}
            alt={lb.name}
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>
    </Portal>
  );
}
