"use client";

import { useState } from "react";
import { create } from "zustand";
import { api } from "@/lib/client/api";
import { copyText } from "@/lib/client/utils";
import { useApp } from "@/lib/client/store";
import { Button, Modal, Spinner } from "./ui";
import { CheckIcon, CopyIcon, LockIcon } from "./icons";

const useShare = create<{ chatId: string | null }>(() => ({ chatId: null }));

export function openShareDialog(chatId: string) {
  useShare.setState({ chatId });
}

export function ShareDialog() {
  const chatId = useShare((s) => s.chatId);
  const chat = useApp((s) => s.chats.find((c) => c.id === chatId));
  const toast = useApp((s) => s.toast);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const close = () => {
    useShare.setState({ chatId: null });
    setUrl(null);
    setCopied(false);
  };

  const create = async () => {
    if (!chatId) return;
    setBusy(true);
    try {
      const res = await api<{ path: string }>(`/api/chats/${chatId}/share`, { method: "POST", body: {} });
      const full = `${window.location.origin}${res.path}`;
      setUrl(full);
      if (await copyText(full)) setCopied(true);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!chatId} onClose={close} title={chat ? `Share "${chat.title}"` : "Share chat"} className="max-w-xl">
      <div className="space-y-4 px-5 pb-5 pt-4 text-sm">
        <p className="text-fg-2">
          Anyone with the link can view this conversation as it is right now. Messages you send after sharing won&apos;t be visible unless you
          update the link. Your name, memories and other chats stay private.
        </p>
        <div className="flex items-center gap-2 rounded-full border border-line p-1.5 pl-4">
          <span className="flex-1 truncate text-fg-2">{url ?? `${typeof window !== "undefined" ? window.location.origin : ""}/share/…`}</span>
          {url ? (
            <Button
              variant="primary"
              onClick={async () => {
                if (await copyText(url)) setCopied(true);
              }}
            >
              {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />} {copied ? "Copied" : "Copy link"}
            </Button>
          ) : (
            <Button variant="primary" onClick={create} disabled={busy}>
              {busy ? <Spinner size={14} /> : null} Create link
            </Button>
          )}
        </div>
        <p className="flex items-center gap-1.5 text-xs text-fg-3">
          <LockIcon size={14} /> You can delete shared links any time in Settings → Data controls.
        </p>
      </div>
    </Modal>
  );
}
