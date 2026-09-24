"use client";

import { useSyncExternalStore } from "react";
import type { ChatMessage, ChatSummary } from "@/lib/shared/types";

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export type DateGroup = "Today" | "Yesterday" | "Previous 7 Days" | "Previous 30 Days" | string;

export function dateGroup(ts: number, now = Date.now()): DateGroup {
  const d = new Date(ts);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((today.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "Previous 7 Days";
  if (diffDays < 30) return "Previous 30 Days";
  if (d.getFullYear() === today.getFullYear()) return d.toLocaleString("en-US", { month: "long" });
  return String(d.getFullYear());
}

export function groupChats(chats: ChatSummary[]): { group: string; chats: ChatSummary[] }[] {
  const out: { group: string; chats: ChatSummary[] }[] = [];
  for (const c of chats) {
    const g = dateGroup(c.updatedAt);
    const last = out[out.length - 1];
    if (last && last.group === g) last.chats.push(c);
    else out.push({ group: g, chats: [c] });
  }
  return out;
}

export function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function isMac() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

export function isTouch() {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

/** Visible thread from the root to `leaf`. */
export function threadFor(messages: Record<string, ChatMessage>, leaf: string | null): ChatMessage[] {
  const out: ChatMessage[] = [];
  const seen = new Set<string>();
  let cur = leaf ? messages[leaf] : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    cur = cur.parentId ? messages[cur.parentId] : undefined;
  }
  return out.reverse();
}

export function childrenOf(messages: Record<string, ChatMessage>, parentId: string | null): ChatMessage[] {
  return Object.values(messages)
    .filter((m) => m.parentId === parentId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** Follow the newest child down to a leaf. */
export function deepestLeaf(messages: Record<string, ChatMessage>, id: string): string {
  let cur = id;
  const seen = new Set<string>();
  while (!seen.has(cur)) {
    seen.add(cur);
    const kids = childrenOf(messages, cur);
    if (!kids.length) break;
    cur = kids[kids.length - 1].id;
  }
  return cur;
}

/** Latest message in the chat (used when the server's current leaf is missing). */
export function latestLeaf(messages: Record<string, ChatMessage>): string | null {
  const all = Object.values(messages);
  if (!all.length) return null;
  const newest = all.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  return newest.id;
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

/** Strip Markdown so text can be read aloud naturally. */
export function plainForSpeech(md: string) {
  return md
    .replace(/```[\s\S]*?```/g, " (code block omitted) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\$\$[\s\S]*?\$\$/g, " (equation) ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Resize large photos in the browser before upload (saves bandwidth and tokens). */
export async function prepareImage(file: File, maxSide = 2048): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 3_500_000) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const type = file.type === "image/png" && file.size < 3_000_000 ? "image/png" : "image/jpeg";
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), type, 0.88));
  } catch {
    return file;
  }
}

export function greeting(name: string) {
  const first = name.split(" ")[0];
  const options = [
    "What can I help with?",
    "Where should we begin?",
    "What's on your mind today?",
    "Ready when you are.",
    "What's on the agenda today?",
    first ? `Good to see you, ${first}.` : "Good to see you.",
    first ? `How can I help, ${first}?` : "How can I help?",
  ];
  return options[Math.floor(Math.random() * options.length)];
}

export function useMediaQuery(query: string, serverValue = true): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

export const DESKTOP_QUERY = "(min-width: 768px)";
export const useIsDesktop = () => useMediaQuery(DESKTOP_QUERY);
