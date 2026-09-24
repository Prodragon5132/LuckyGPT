"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/client/store";
import { api, fileUrl } from "@/lib/client/api";
import type { FileInfo } from "@/lib/shared/types";
import { DownloadIcon, ExternalIcon, TrashIcon } from "./icons";
import { confirmDialog, Spinner } from "./ui";

export function LibraryView() {
  const [items, setItems] = useState<FileInfo[] | null>(null);
  const [filter, setFilter] = useState<"all" | "generated" | "upload">("all");
  const set = useApp((s) => s.set);
  const router = useRouter();

  useEffect(() => {
    void api<FileInfo[]>("/api/files?library=1").then(setItems).catch(() => setItems([]));
  }, []);

  const shown = (items ?? []).filter((f) => filter === "all" || f.kind === filter);

  return (
    <div className="scroll-thin flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
        <h1 className="mb-4 text-3xl font-semibold">Library</h1>
        <div className="mb-6 flex gap-1.5">
          {(
            [
              ["all", "All"],
              ["generated", "Created"],
              ["upload", "Uploaded"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`rounded-full px-3 py-1.5 text-sm ${filter === k ? "bg-accent text-accent-fg" : "border border-line hover:bg-hover"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {!items ? (
          <div className="flex justify-center py-16">
            <Spinner size={22} />
          </div>
        ) : shown.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line p-10 text-center text-fg-3">
            Images you create or upload will show up here. Try asking “Create an image of a lighthouse at sunset”.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {shown.map((f) => (
              <div key={f.id} className="group relative aspect-square overflow-hidden rounded-xl bg-muted">
                <button className="h-full w-full" onClick={() => set({ lightbox: { id: f.id, name: f.name } })}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fileUrl(f.id)} alt={f.name} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
                </button>
                <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100 touch:opacity-100">
                  {f.chatId && (
                    <button
                      onClick={() => router.push(`/c/${f.chatId}`)}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white"
                      aria-label="Go to chat"
                      title="Go to chat"
                    >
                      <ExternalIcon size={15} />
                    </button>
                  )}
                  <a href={fileUrl(f.id, { download: true })} className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white" aria-label="Download" title="Download">
                    <DownloadIcon size={15} />
                  </a>
                  <button
                    onClick={async () => {
                      if (!(await confirmDialog({ title: "Delete this image?", confirmLabel: "Delete", danger: true }))) return;
                      await api(`/api/files/${f.id}`, { method: "DELETE" });
                      setItems((all) => all!.filter((x) => x.id !== f.id));
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white"
                    aria-label="Delete"
                    title="Delete"
                  >
                    <TrashIcon size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
