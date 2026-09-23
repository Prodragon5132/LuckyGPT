"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/client/store";
import { api, uploadFile } from "@/lib/client/api";
import { cn, formatBytes } from "@/lib/client/utils";
import type { FileInfo, Gpt } from "@/lib/shared/types";
import { GptAvatar } from "./ChatView";
import { ChevronLeft, DotsIcon, EditIcon, FileIcon, PinIcon, PlusIcon, TrashIcon } from "./icons";
import { Button, confirmDialog, Field, IconButton, inputClass, MenuItem, Popover, Select, Spinner, Toggle, useAnchor } from "./ui";

export const GPT_TEMPLATES: Partial<Gpt>[] = [
  {
    name: "Tech Helper",
    icon: "🛠️",
    color: "#dbeafe",
    description: "Patient, step-by-step help with phones, computers and apps.",
    instructions:
      "You are a patient tech support helper for someone who isn't very technical. Ask what device they use, then give short numbered steps one at a time. Avoid jargon, and check in after each step.",
    starters: ["My printer won't print", "How do I free up space on my phone?", "Help me set up a new email account"],
  },
  {
    name: "Recipe Chef",
    icon: "🍳",
    color: "#fef3c7",
    description: "Turns what's in your fridge into a tasty meal.",
    instructions:
      "You are a friendly home chef. Suggest simple recipes from the ingredients the user has, with a short ingredient list and clear steps. Offer substitutions and ask about dietary needs.",
    starters: ["I have chicken, rice and broccoli", "Quick dinner for 4 under 30 minutes", "A healthy breakfast idea"],
  },
  {
    name: "Email Writer",
    icon: "✉️",
    color: "#dcfce7",
    description: "Writes clear, polite emails and messages in your voice.",
    instructions:
      "You help write emails and messages. Ask who it's for and what tone they want if unclear. Keep drafts short, friendly and professional, and offer one alternative version.",
    starters: ["Write a thank-you note to a coworker", "Politely decline a meeting", "Follow up on an unpaid invoice"],
  },
  {
    name: "Travel Planner",
    icon: "🧳",
    color: "#ede9fe",
    description: "Plans trips, itineraries, and packing lists.",
    instructions:
      "You are a travel planner. Ask about dates, budget, and interests, then build a day-by-day itinerary with practical tips. Use web search for current info like opening hours when available.",
    starters: ["Plan a 3-day weekend in Chicago", "Packing list for a beach trip", "Best time to visit Japan?"],
  },
];

export function GptsView() {
  const router = useRouter();
  const gpts = useApp((s) => s.gpts);
  const loadGpts = useApp((s) => s.loadGpts);

  return (
    <div className="scroll-thin flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6 sm:pt-12">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h1 className="text-3xl font-semibold sm:text-4xl">GPTs</h1>
          <Button variant="primary" onClick={() => router.push("/gpts/editor")}>
            <PlusIcon size={16} /> Create
          </Button>
        </div>
        <p className="mb-8 text-fg-2">Custom versions of LuckyGPT that combine instructions, extra knowledge, and skills.</p>

        <h2 className="mb-3 text-lg font-semibold">My GPTs</h2>
        {gpts.length === 0 ? (
          <div className="mb-10 rounded-2xl border border-dashed border-line p-6 text-center text-sm text-fg-3">
            You haven&apos;t made any GPTs yet. Create one, or start from a template below.
          </div>
        ) : (
          <div className="mb-10 divide-y divide-line-2">
            {gpts.map((g) => (
              <GptRow key={g.id} gpt={g} onChanged={loadGpts} />
            ))}
          </div>
        )}

        <h2 className="mb-3 text-lg font-semibold">Start from a template</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {GPT_TEMPLATES.map((t) => (
            <button
              key={t.name}
              onClick={() => {
                sessionStorage.setItem("lgpt-gpt-template", JSON.stringify(t));
                router.push("/gpts/editor");
              }}
              className="flex items-start gap-3 rounded-2xl border border-line p-4 text-left hover:bg-hover"
            >
              <GptAvatar gpt={{ icon: t.icon!, color: t.color! }} size={44} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t.name}</span>
                <span className="line-clamp-2 block text-xs text-fg-3">{t.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function GptRow({ gpt, onChanged }: { gpt: Gpt; onChanged: () => Promise<void> }) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [anchor, setAnchor] = useAnchor<HTMLDivElement>();
  return (
    <div className="flex items-center gap-3 py-3">
      <button onClick={() => router.push(`/g/${gpt.id}`)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <GptAvatar gpt={gpt} size={44} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{gpt.name}</span>
          <span className="block truncate text-xs text-fg-3">{gpt.description || "No description"}</span>
        </span>
      </button>
      <IconButton label="Edit GPT" onClick={() => router.push(`/gpts/editor/${gpt.id}`)}>
        <EditIcon size={18} />
      </IconButton>
      <div ref={setAnchor}>
        <IconButton label="More" onClick={() => setMenu((m) => !m)}>
          <DotsIcon size={18} />
        </IconButton>
      </div>
      <Popover anchor={anchor} open={menu} onClose={() => setMenu(false)} placement="bottom-end">
        <MenuItem
          icon={<PinIcon size={18} />}
          label={gpt.pinned ? "Hide from sidebar" : "Keep in sidebar"}
          onClick={async () => {
            setMenu(false);
            await api(`/api/gpts/${gpt.id}`, { method: "PATCH", body: { pinned: !gpt.pinned } });
            await onChanged();
          }}
        />
        <MenuItem
          icon={<TrashIcon size={18} />}
          label="Delete GPT"
          danger
          onClick={async () => {
            setMenu(false);
            if (!(await confirmDialog({ title: `Delete ${gpt.name}?`, body: "Chats with it will stay in your history.", confirmLabel: "Delete", danger: true }))) return;
            await api(`/api/gpts/${gpt.id}`, { method: "DELETE" });
            await onChanged();
          }}
        />
      </Popover>
    </div>
  );
}

const EMOJIS = ["✨", "🤖", "🧠", "📚", "🍳", "🛠️", "✉️", "🧳", "💡", "🎨", "🏋️", "🌱", "💼", "🎵", "🧮", "🩺", "🐶", "⚽", "📈", "🏠"];
const BG = ["", "#dbeafe", "#fef3c7", "#dcfce7", "#ede9fe", "#fce7f3", "#ffedd5", "#e5e7eb"];

type Draft = Omit<Gpt, "id" | "pinned" | "createdAt" | "updatedAt">;

const EMPTY: Draft = {
  name: "",
  description: "",
  instructions: "",
  starters: [],
  icon: "✨",
  color: "",
  modelId: null,
  capabilities: { search: true, image: true },
};

export function GptEditor({ gptId }: { gptId: string | null }) {
  const router = useRouter();
  const models = useApp((s) => s.models);
  const loadGpts = useApp((s) => s.loadGpts);
  const toast = useApp((s) => s.toast);
  const [draft, setDraft] = useState<Draft | null>(() => {
    if (gptId) return null;
    try {
      const t = sessionStorage.getItem("lgpt-gpt-template");
      if (t) {
        sessionStorage.removeItem("lgpt-gpt-template");
        return { ...EMPTY, ...JSON.parse(t) };
      }
    } catch {
      /* ignore */
    }
    return EMPTY;
  });
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (gptId) {
      api<Gpt>(`/api/gpts/${gptId}`)
        .then((g) => {
          const { id: _i, pinned: _p, createdAt: _c, updatedAt: _u, ...rest } = g;
          setDraft(rest);
        })
        .catch((e) => toast(e.message, "error"));
      void api<FileInfo[]>(`/api/files?gptId=${gptId}`).then(setFiles);
    }
  }, [gptId, toast]);

  if (!draft) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size={20} />
      </div>
    );
  }

  const up = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const starters = [...draft.starters, ""].slice(0, 4);

  const save = async () => {
    setSaving(true);
    try {
      const body = { ...draft, starters: draft.starters.filter((s) => s.trim()) };
      const g = gptId
        ? await api<Gpt>(`/api/gpts/${gptId}`, { method: "PATCH", body })
        : await api<Gpt>("/api/gpts", { body });
      await loadGpts();
      toast(gptId ? "GPT updated" : "GPT created", "success");
      if (!gptId) router.replace(`/gpts/editor/${g.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line-2 px-3">
        <IconButton label="Back" onClick={() => router.push("/gpts")}>
          <ChevronLeft size={20} />
        </IconButton>
        <GptAvatar gpt={draft} size={28} />
        <div className="min-w-0 flex-1 truncate text-sm font-medium">{draft.name || "New GPT"}</div>
        {gptId && (
          <Button size="sm" onClick={() => router.push(`/g/${gptId}`)}>
            Open chat
          </Button>
        )}
        <Button size="sm" variant="primary" onClick={save} disabled={saving || !draft.name.trim()}>
          {saving && <Spinner size={14} />} {gptId ? "Update" : "Create"}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:px-6">
            <div className="flex flex-col items-center gap-3">
              <GptAvatar gpt={draft} size={72} />
              <div className="flex flex-wrap justify-center gap-1">
                {EMOJIS.map((e) => (
                  <button key={e} onClick={() => up({ icon: e })} className={cn("h-8 w-8 rounded-lg text-lg hover:bg-hover", draft.icon === e && "bg-active")}>
                    {e}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                {BG.map((c) => (
                  <button
                    key={c || "none"}
                    onClick={() => up({ color: c })}
                    className={cn("h-5 w-5 rounded-full border border-line", draft.color === c && "ring-2 ring-fg-3 ring-offset-1 ring-offset-surface")}
                    style={{ background: c || "var(--muted)" }}
                    aria-label="Background color"
                  />
                ))}
              </div>
            </div>
            <Field label="Name">
              <input className={inputClass} value={draft.name} maxLength={80} onChange={(e) => up({ name: e.target.value })} placeholder="Name your GPT" />
            </Field>
            <Field label="Description">
              <input
                className={inputClass}
                value={draft.description}
                maxLength={300}
                onChange={(e) => up({ description: e.target.value })}
                placeholder="Add a short description about what this GPT does"
              />
            </Field>
            <Field label="Instructions" hint="What does this GPT do? How does it behave? What should it avoid doing?">
              <textarea
                className={cn(inputClass, "min-h-[160px] resize-y")}
                value={draft.instructions}
                maxLength={8000}
                onChange={(e) => up({ instructions: e.target.value })}
              />
            </Field>
            <Field label="Conversation starters">
              <div className="space-y-2">
                {starters.map((s, i) => (
                  <input
                    key={i}
                    className={inputClass}
                    value={s}
                    maxLength={300}
                    placeholder={i === 0 ? "e.g. Help me plan a birthday party" : ""}
                    onChange={(e) => {
                      const next = [...draft.starters];
                      next[i] = e.target.value;
                      up({ starters: next.filter((x, j) => x.trim() || j < next.length - 1).slice(0, 4) });
                    }}
                  />
                ))}
              </div>
            </Field>
            <Field label="Knowledge" hint={gptId ? "Files this GPT can use in every chat (PDF, Word, text)." : "Create the GPT first, then you can add files."}>
              <div className="space-y-2">
                {files.map((f) => (
                  <div key={f.id} className="flex items-center gap-2 rounded-xl border border-line-2 px-3 py-2 text-sm">
                    <FileIcon size={16} className="text-fg-3" />
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="text-xs text-fg-3">{formatBytes(f.size)}</span>
                    <button
                      onClick={async () => {
                        await api(`/api/files/${f.id}`, { method: "DELETE" });
                        setFiles((all) => all.filter((x) => x.id !== f.id));
                      }}
                      className="rounded-md p-1 text-fg-3 hover:text-danger"
                      aria-label="Remove file"
                    >
                      <TrashIcon size={14} />
                    </button>
                  </div>
                ))}
                <Button size="sm" disabled={!gptId} onClick={() => fileRef.current?.click()}>
                  Upload files
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  multiple
                  accept=".pdf,.docx,.txt,.md,.csv,.json,.html"
                  onChange={async (e) => {
                    const list = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    for (const file of list) {
                      try {
                        const info = await uploadFile(file, file.name, { purpose: "gpt", gptId: gptId! });
                        setFiles((all) => [...all, info]);
                      } catch (err) {
                        toast((err as Error).message, "error");
                      }
                    }
                  }}
                />
              </div>
            </Field>
            <Field label="Recommended model">
              <Select
                value={draft.modelId ?? ""}
                onChange={(v) => up({ modelId: v || null })}
                options={[{ value: "", label: "No recommendation (use selected model)" }, ...models.map((m) => ({ value: m.id, label: m.name }))]}
                className="border border-line"
              />
            </Field>
            <div>
              <div className="mb-2 text-sm font-medium">Capabilities</div>
              <div className="flex items-center justify-between py-2 text-sm">
                <span>Web search</span>
                <Toggle checked={draft.capabilities.search} onChange={(search) => up({ capabilities: { ...draft.capabilities, search } })} />
              </div>
              <div className="flex items-center justify-between py-2 text-sm">
                <span>Image generation</span>
                <Toggle checked={draft.capabilities.image} onChange={(image) => up({ capabilities: { ...draft.capabilities, image } })} />
              </div>
            </div>
          </div>
        </div>
        <div className="hidden w-[42%] flex-col items-center justify-center border-l border-line-2 p-8 text-center lg:flex">
          <div className="mb-4 text-xs font-medium uppercase tracking-wide text-fg-3">Preview</div>
          <GptAvatar gpt={draft} size={64} />
          <div className="mt-3 text-2xl font-semibold">{draft.name || "Your GPT"}</div>
          <div className="mt-1 max-w-xs text-sm text-fg-2">{draft.description}</div>
          <div className="mt-6 grid w-full max-w-md grid-cols-2 gap-2">
            {draft.starters
              .filter((s) => s.trim())
              .map((s) => (
                <div key={s} className="rounded-2xl border border-line px-3 py-2.5 text-left text-xs text-fg-2">
                  {s}
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
