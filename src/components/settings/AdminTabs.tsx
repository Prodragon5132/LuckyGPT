"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/client/utils";
import type { ModelCapabilities, ProviderKind } from "@/lib/shared/types";
import { Button, confirmDialog, inputClass, Modal, promptDialog, Select, Spinner, Toggle } from "../ui";
import { Row, Section } from "./common";
import { ChevronDown, ChevronLeft, ChevronRight, ExternalIcon, PlusIcon, SearchIcon, TrashIcon } from "../icons";

// ---------- Shared admin config state ----------

type SecretProvider = "openai" | "anthropic" | "google" | "openrouter" | "openrouterChat" | "groq" | "elevenlabs";

interface ModelConfig {
  id: string;
  provider: ProviderKind;
  customId?: string;
  modelId: string;
  name: string;
  description: string;
  enabled: boolean;
  capabilities: ModelCapabilities;
}

interface AppConfig {
  models: ModelConfig[];
  defaultModel: string | null;
  taskModel: string | null;
  visionHelper: string;
  image: { provider: "none" | "openai" | "google" | "openrouter"; modelId: string };
  voice: {
    chatModel: string | null;
    stt: { provider: "browser" | "openai" | "groq" | "google" | "openrouter" | "elevenlabs"; model: string };
    tts: { provider: "browser" | "openai" | "google" | "openrouter" | "elevenlabs"; model: string; defaultVoice: string; elevenVoices: string };
  };
  webSearch: "auto" | "manual";
  maxOutputTokens: number;
}

interface AdminView {
  config: AppConfig;
  keys: Record<SecretProvider, string | null>;
  custom: { id: string; name: string; baseURL: string; key: string | null }[];
}

function useAdminConfig() {
  const [view, setView] = useState<AdminView | null>(null);
  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useApp((s) => s.toast);
  const loadModels = useApp((s) => s.loadModels);

  const load = useCallback(
    () =>
      api<AdminView>("/api/admin/config").then((v) => {
        setView(v);
        setDraft(v.config);
      }),
    [],
  );

  useEffect(() => {
    let alive = true;
    api<AdminView>("/api/admin/config")
      .then((v) => {
        if (!alive) return;
        setView(v);
        setDraft(v.config);
      })
      .catch((e) => toast(e.message, "error"));
    return () => {
      alive = false;
    };
  }, [toast]);

  const save = async (next?: AppConfig) => {
    const config = next ?? draft;
    if (!config) return;
    setSaving(true);
    try {
      const v = await api<AdminView>("/api/admin/config", { method: "PUT", body: config });
      setView(v);
      setDraft(v.config);
      await loadModels();
      toast("Saved", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const dirty = !!view && !!draft && JSON.stringify(view.config) !== JSON.stringify(draft);
  return { view, setView, draft, setDraft, save, saving, dirty, reload: load };
}

function SaveBar({ dirty, saving, onSave, onReset }: { dirty: boolean; saving: boolean; onSave: () => void; onReset: () => void }) {
  if (!dirty) return null;
  return (
    <div className="sticky bottom-0 -mx-5 mt-4 flex items-center justify-end gap-2 border-t border-line-2 bg-elevated px-5 py-3 dark:bg-[#2f2f2f]">
      <span className="mr-auto text-xs text-fg-3">You have unsaved changes</span>
      <Button size="sm" onClick={onReset}>
        Discard
      </Button>
      <Button size="sm" variant="primary" onClick={onSave} disabled={saving}>
        {saving && <Spinner size={14} />} Save changes
      </Button>
    </div>
  );
}

// ---------- API keys ----------

/**
 * API keys aren't passwords: a masked text field (not type="password") keeps
 * Google/browser password managers from offering to save them to an account.
 */
const SECRET_INPUT = {
  type: "text",
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  "data-1p-ignore": "true",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
} as const;

const PROVIDERS: { id: SecretProvider; name: string; blurb: string; url: string; placeholder: string }[] = [
  { id: "openai", name: "OpenAI", blurb: "GPT models, image generation, and natural voices.", url: "https://platform.openai.com/api-keys", placeholder: "sk-..." },
  { id: "anthropic", name: "Anthropic", blurb: "Claude models.", url: "https://console.anthropic.com/settings/keys", placeholder: "sk-ant-..." },
  { id: "google", name: "Google Gemini", blurb: "Gemini models and image generation. Has a free tier.", url: "https://aistudio.google.com/apikey", placeholder: "AIza..." },
  { id: "openrouter", name: "OpenRouter", blurb: "Hundreds of models with one key, including some free ones. Also voices and images.", url: "https://openrouter.ai/keys", placeholder: "sk-or-..." },
  {
    id: "openrouterChat",
    name: "OpenRouter — chat only (optional)",
    blurb: "A second OpenRouter key used only for chat. Voice and images keep using the main OpenRouter key.",
    url: "https://openrouter.ai/keys",
    placeholder: "sk-or-...",
  },
  { id: "groq", name: "Groq", blurb: "Very fast speech-to-text for voice (has a free tier).", url: "https://console.groq.com/keys", placeholder: "gsk_..." },
  { id: "elevenlabs", name: "ElevenLabs", blurb: "Very natural text-to-speech voices.", url: "https://elevenlabs.io/app/settings/api-keys", placeholder: "sk_..." },
];

export function KeysTab() {
  const { view, setView, reload } = useAdminConfig();
  const toast = useApp((s) => s.toast);
  const loadModels = useApp((s) => s.loadModels);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [custom, setCustom] = useState({ name: "", baseURL: "", apiKey: "" });

  if (!view) return <Spinner size={18} />;

  const act = async (id: string, body: Record<string, unknown>, success: string) => {
    setBusy(id);
    try {
      const res = await api<{ keys: AdminView["keys"]; custom: AdminView["custom"]; config: AppConfig; addedModels: number }>("/api/admin/keys", {
        method: "PUT",
        body,
      });
      setView({ ...view, keys: res.keys, custom: res.custom, config: res.config });
      setInputs((i) => ({ ...i, [id]: "" }));
      await loadModels();
      toast(res.addedModels ? `${success} Added ${res.addedModels} models — you can change them in Models.` : success, "success");
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <p className="mb-4 text-sm text-fg-2">
        Keys are encrypted and stored only on your server. They&apos;re never shown again or sent to anyone&apos;s browser. You only pay the provider for
        what you use.
      </p>
      {PROVIDERS.map((p) => (
        <div key={p.id} className="border-b border-line-2 py-4 last:border-b-0">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                {p.name}
                {view.keys[p.id] ? (
                  <span className="rounded-full bg-[#1f9d63]/15 px-2 py-px text-[11px] font-medium text-[#1f9d63]">Connected {view.keys[p.id]}</span>
                ) : (
                  <span className="rounded-full bg-muted px-2 py-px text-[11px] text-fg-3">Not set</span>
                )}
              </div>
              <div className="mt-0.5 text-xs text-fg-3">{p.blurb}</div>
            </div>
            <a href={p.url} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 text-xs text-link hover:underline">
              Get a key <ExternalIcon size={12} />
            </a>
          </div>
          <div className="flex gap-2">
            <input
              {...SECRET_INPUT}
              placeholder={view.keys[p.id] ? "Paste a new key to replace it" : p.placeholder}
              value={inputs[p.id] ?? ""}
              onChange={(e) => setInputs((i) => ({ ...i, [p.id]: e.target.value }))}
              className={cn(inputClass, "secret-input py-2")}
            />
            <Button
              size="sm"
              variant="primary"
              className="h-10"
              disabled={!inputs[p.id]?.trim() || busy === p.id}
              onClick={() => act(p.id, { action: "set", provider: p.id, apiKey: inputs[p.id].trim() }, `${p.name} key saved.`)}
            >
              {busy === p.id ? <Spinner size={14} /> : "Save"}
            </Button>
            {view.keys[p.id] && (
              <Button
                size="sm"
                className="h-10"
                onClick={async () => {
                  if (await confirmDialog({ title: `Remove the ${p.name} key?`, confirmLabel: "Remove", danger: true }))
                    await act(p.id, { action: "remove", provider: p.id }, `${p.name} key removed.`);
                }}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      ))}

      <Section
        title="Custom endpoints"
        description="Any OpenAI-compatible API: Ollama or LM Studio on your own computer, Groq, Together, Mistral, DeepSeek, xAI, etc. (Local models only work when LuckyGPT runs on the same machine or network.)"
      >
        {view.custom.map((c) => (
          <Row key={c.id} label={c.name} description={`${c.baseURL}${c.key ? ` · key ${c.key}` : ""}`}>
            <Button
              size="sm"
              onClick={async () => {
                if (await confirmDialog({ title: `Remove ${c.name}?`, body: "Its models will be removed too.", confirmLabel: "Remove", danger: true }))
                  await act(c.id, { action: "removeCustom", id: c.id }, `${c.name} removed.`);
              }}
            >
              Remove
            </Button>
          </Row>
        ))}
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_2fr]">
          <input className={inputClass} placeholder="Name (e.g. Ollama)" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
          <input
            className={inputClass}
            placeholder="Base URL (e.g. http://localhost:11434/v1)"
            value={custom.baseURL}
            onChange={(e) => setCustom({ ...custom, baseURL: e.target.value })}
          />
          <input
            className={cn(inputClass, "secret-input sm:col-span-2")}
            {...SECRET_INPUT}
            placeholder="API key (optional)"
            value={custom.apiKey}
            onChange={(e) => setCustom({ ...custom, apiKey: e.target.value })}
          />
        </div>
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            disabled={!custom.name.trim() || !custom.baseURL.trim() || busy === "custom"}
            onClick={async () => {
              await act("custom", { action: "addCustom", name: custom.name.trim(), baseURL: custom.baseURL.trim(), apiKey: custom.apiKey.trim() || undefined }, "Endpoint added. Add its models in Models.");
              setCustom({ name: "", baseURL: "", apiKey: "" });
            }}
          >
            <PlusIcon size={16} /> Add endpoint
          </Button>
        </div>
      </Section>
    </div>
  );
}

// ---------- Models ----------

const CAP_LABELS: [keyof ModelCapabilities, string][] = [
  ["vision", "Images in"],
  ["pdf", "PDFs"],
  ["tools", "Tools"],
  ["reasoning", "Thinking"],
  ["webSearch", "Web search"],
  ["imageOutput", "Makes images"],
];

const PROVIDER_LABEL: Record<ProviderKind, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  openrouter: "OpenRouter",
  custom: "Custom",
};

interface RemoteModel {
  modelId: string;
  name: string;
  description?: string;
  capabilities: ModelCapabilities;
}

function AddModelsModal({
  open,
  onClose,
  view,
  existing,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  view: AdminView;
  existing: ModelConfig[];
  onAdd: (m: ModelConfig) => void;
}) {
  const sources = useMemo(() => {
    const list: { key: string; label: string; provider: ProviderKind; customId?: string }[] = [];
    (["openai", "anthropic", "google", "openrouter"] as const).forEach((p) => {
      if (view.keys[p] || p === "openrouter") list.push({ key: p, label: PROVIDER_LABEL[p], provider: p });
    });
    view.custom.forEach((c) => list.push({ key: `custom:${c.id}`, label: c.name, provider: "custom", customId: c.id }));
    return list;
  }, [view]);
  const [source, setSource] = useState(sources[0]?.key ?? "");
  const [loaded, setLoaded] = useState<{ key: string; list: RemoteModel[] | null; error: string } | null>(null);
  const [q, setQ] = useState("");
  const [manual, setManual] = useState({ modelId: "", name: "" });
  const src = sources.find((s) => s.key === source);
  const list = loaded?.key === source ? loaded.list : null;
  const error = loaded?.key === source ? loaded.error : "";

  useEffect(() => {
    if (!open || !src) return;
    let alive = true;
    const qs = new URLSearchParams({ provider: src.provider, ...(src.customId ? { customId: src.customId } : {}) });
    api<RemoteModel[]>(`/api/admin/provider-models?${qs}`)
      .then((l) => alive && setLoaded({ key: src.key, list: l, error: "" }))
      .catch((e) => alive && setLoaded({ key: src.key, list: null, error: e.message }));
    return () => {
      alive = false;
    };
  }, [open, src]);

  const add = (r: { modelId: string; name: string; description?: string; capabilities?: ModelCapabilities }) => {
    if (!src) return;
    const id = `${src.provider}${src.customId ? `-${src.customId}` : ""}:${r.modelId}`.slice(0, 100);
    onAdd({
      id,
      provider: src.provider,
      customId: src.customId,
      modelId: r.modelId,
      name: r.name || r.modelId,
      description: (r.description ?? "").slice(0, 120),
      enabled: true,
      capabilities: r.capabilities ?? { vision: false, pdf: false, tools: src.provider !== "custom", reasoning: false, webSearch: false, imageOutput: false },
    });
  };

  const filtered = (list ?? []).filter((m) => !q || `${m.modelId} ${m.name}`.toLowerCase().includes(q.toLowerCase())).slice(0, 300);

  return (
    <Modal open={open} onClose={onClose} title="Add models" className="max-w-2xl">
      <div className="px-5 pb-5 pt-3">
        {sources.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-2">Add an API key first.</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {sources.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSource(s.key)}
                  className={cn("rounded-full px-3 py-1.5 text-sm", s.key === source ? "bg-accent text-accent-fg" : "border border-line hover:bg-hover")}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-line px-3">
              <SearchIcon size={16} className="text-fg-3" />
              <input className="w-full bg-transparent py-2 text-sm outline-none" placeholder="Search models" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="h-80 overflow-y-auto rounded-xl border border-line scroll-thin">
              {error ? (
                <p className="p-4 text-sm text-danger">{error}</p>
              ) : !list ? (
                <div className="flex justify-center p-6">
                  <Spinner size={18} />
                </div>
              ) : filtered.length === 0 ? (
                <p className="p-4 text-sm text-fg-3">No models found.</p>
              ) : (
                filtered.map((m) => {
                  const already = existing.some((e) => e.provider === src?.provider && e.modelId === m.modelId && e.customId === src?.customId);
                  return (
                    <div key={m.modelId} className="flex items-center gap-3 border-b border-line-2 px-3 py-2 last:border-b-0">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{m.name}</div>
                        <div className="truncate font-mono text-xs text-fg-3">{m.modelId}</div>
                      </div>
                      <Button size="sm" disabled={already} onClick={() => add(m)}>
                        {already ? "Added" : "Add"}
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
            <div className="mt-4 text-sm font-medium">Or add by model ID</div>
            <div className="mt-2 flex gap-2">
              <input className={cn(inputClass, "font-mono")} placeholder="model-id" value={manual.modelId} onChange={(e) => setManual({ ...manual, modelId: e.target.value })} />
              <input className={inputClass} placeholder="Display name" value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} />
              <Button
                size="sm"
                className="h-10"
                disabled={!manual.modelId.trim()}
                onClick={async () => {
                  let capabilities: ModelCapabilities | undefined;
                  const found = list?.find((m) => m.modelId === manual.modelId.trim());
                  if (found) capabilities = found.capabilities;
                  add({ modelId: manual.modelId.trim(), name: manual.name.trim() || manual.modelId.trim(), capabilities });
                  setManual({ modelId: "", name: "" });
                }}
              >
                Add
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function ModelRow({
  m,
  onChange,
  onDelete,
  onMove,
  first,
  last,
}: {
  m: ModelConfig;
  onChange: (m: ModelConfig) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  first: boolean;
  last: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [test, setTest] = useState<{ busy?: boolean; ok?: boolean; text?: string } | null>(null);
  return (
    <div className="border-b border-line-2 py-2.5 last:border-b-0">
      <div className="flex items-center gap-2">
        <Toggle checked={m.enabled} onChange={(enabled) => onChange({ ...m, enabled })} label={`Enable ${m.name}`} />
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{m.name}</span>
            <span className="block truncate font-mono text-xs text-fg-3">
              {PROVIDER_LABEL[m.provider]} · {m.modelId}
            </span>
          </span>
          <ChevronDown size={16} className={cn("shrink-0 text-fg-3 transition", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <div className="mt-3 space-y-3 rounded-xl bg-muted/60 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={inputClass} value={m.name} onChange={(e) => onChange({ ...m, name: e.target.value })} placeholder="Display name" />
            <input className={cn(inputClass, "font-mono")} value={m.modelId} onChange={(e) => onChange({ ...m, modelId: e.target.value })} placeholder="Model ID" />
            <input
              className={cn(inputClass, "sm:col-span-2")}
              value={m.description}
              onChange={(e) => onChange({ ...m, description: e.target.value })}
              placeholder="Short description shown in the model picker"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CAP_LABELS.map(([k, label]) => (
              <button
                key={k}
                onClick={() => onChange({ ...m, capabilities: { ...m.capabilities, [k]: !m.capabilities[k] } })}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs",
                  m.capabilities[k] ? "bg-accent text-accent-fg" : "border border-line text-fg-2 hover:bg-hover",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={async () => {
                setTest({ busy: true });
                try {
                  const r = await api<{ ok: boolean; text?: string; error?: string; ms?: number }>("/api/admin/test", { body: { id: m.id } });
                  setTest({ ok: r.ok, text: r.ok ? `“${r.text}” (${((r.ms ?? 0) / 1000).toFixed(1)}s)` : r.error });
                } catch (e) {
                  setTest({ ok: false, text: (e as Error).message });
                }
              }}
            >
              {test?.busy ? <Spinner size={14} /> : null} Test
            </Button>
            <Button size="sm" onClick={() => onMove(-1)} disabled={first}>
              <ChevronLeft size={14} className="rotate-90" /> Up
            </Button>
            <Button size="sm" onClick={() => onMove(1)} disabled={last}>
              <ChevronRight size={14} className="rotate-90" /> Down
            </Button>
            <Button size="sm" variant="ghost" className="ml-auto text-danger" onClick={onDelete}>
              <TrashIcon size={16} /> Remove
            </Button>
          </div>
          {test && !test.busy && <p className={cn("text-xs", test.ok ? "text-[#1f9d63]" : "text-danger")}>{test.ok ? `Works! ${test.text}` : test.text}</p>}
          <p className="text-xs text-fg-3">Save changes before testing edits.</p>
        </div>
      )}
    </div>
  );
}

/** Off, one of the configured models that can see images, or any OpenRouter model ID. */
function VisionHelperPicker({ value, models, onChange }: { value: string; models: ModelConfig[]; onChange: (v: string) => void }) {
  const vision = models.filter((m) => m.capabilities.vision);
  const [typing, setTyping] = useState(false);
  const custom = typing || (!!value && !vision.some((m) => m.id === value));
  if (custom) {
    return (
      <div className="flex items-center gap-2">
        <input
          className={cn(inputClass, "w-56 py-1.5 font-mono")}
          placeholder="e.g. google/gemini-2.5-flash"
          value={value.replace(/^openrouter:/, "")}
          onChange={(e) => onChange(e.target.value.trim() ? `openrouter:${e.target.value.trim()}` : "openrouter:")}
        />
        <button
          className="text-xs text-link hover:underline"
          onClick={() => {
            setTyping(false);
            onChange("");
          }}
        >
          Cancel
        </button>
      </div>
    );
  }
  return (
    <Select
      value={value}
      onChange={(v) => {
        if (v === "__openrouter") {
          setTyping(true);
          onChange("openrouter:");
        } else onChange(v);
      }}
      options={[
        { value: "", label: "Off" },
        ...vision.map((m) => ({ value: m.id, label: m.name })),
        { value: "__openrouter", label: "Any OpenRouter model…" },
      ]}
      className="max-w-[200px]"
    />
  );
}

export function ModelsTab() {
  const { view, draft, setDraft, save, saving, dirty } = useAdminConfig();
  const [adding, setAdding] = useState(false);
  if (!view || !draft) return <Spinner size={18} />;
  const enabled = draft.models.filter((m) => m.enabled);
  const modelOptions = enabled.map((m) => ({ value: m.id, label: m.name }));
  const update = (patch: Partial<AppConfig>) => setDraft({ ...draft, ...patch });

  return (
    <div>
      <Section title="Defaults">
        <Row label="Default model" description="What new chats use unless someone picks another.">
          <Select value={draft.defaultModel ?? ""} onChange={(v) => update({ defaultModel: v || null })} options={[{ value: "", label: "First in list" }, ...modelOptions]} className="max-w-[200px]" />
        </Row>
        <Row label="Background model" description="A small, cheap model used to name chats.">
          <Select value={draft.taskModel ?? ""} onChange={(v) => update({ taskModel: v || null })} options={[{ value: "", label: "Same as chat" }, ...modelOptions]} className="max-w-[200px]" />
        </Row>
        <Row
          label="Image understanding"
          description="Describes photos for text-only models that can't see images."
        >
          <VisionHelperPicker value={draft.visionHelper ?? ""} models={enabled} onChange={(visionHelper) => update({ visionHelper })} />
        </Row>
        <Row label="Web search" description="Auto lets models search whenever they need fresh info (costs a little per search).">
          <Select
            value={draft.webSearch}
            onChange={(webSearch) => update({ webSearch })}
            options={[
              { value: "auto", label: "Auto" },
              { value: "manual", label: "Only when chosen" },
            ]}
          />
        </Row>
        <Row label="Max answer length" description="Upper limit on tokens per answer.">
          <input
            type="number"
            min={256}
            max={200000}
            step={1000}
            value={draft.maxOutputTokens}
            onChange={(e) => update({ maxOutputTokens: Math.max(256, Math.min(200000, Number(e.target.value) || 16000)) })}
            className={cn(inputClass, "w-28 py-1.5")}
          />
        </Row>
      </Section>

      <Section title="Image generation" description="Used for “Create image” and when someone asks for a picture.">
        <Row label="Provider">
          <Select
            value={draft.image.provider}
            onChange={(provider) =>
              update({
                image: {
                  provider,
                  modelId:
                    provider === "openai" ? "gpt-image-1.5" : provider === "google" ? "gemini-2.5-flash-image" : provider === "openrouter" ? "google/gemini-2.5-flash-image" : "",
                },
              })
            }
            options={[
              { value: "none", label: "Off" },
              { value: "openai", label: "OpenAI" },
              { value: "google", label: "Google" },
              { value: "openrouter", label: "OpenRouter" },
            ]}
          />
        </Row>
        {draft.image.provider !== "none" && (
          <Row label="Image model ID">
            <input className={cn(inputClass, "w-56 py-1.5 font-mono")} value={draft.image.modelId} onChange={(e) => update({ image: { ...draft.image, modelId: e.target.value } })} />
          </Row>
        )}
      </Section>

      <Section title="Models" description="These appear in everyone's model picker, in this order.">
        {draft.models.length === 0 && <p className="py-3 text-sm text-fg-3">No models yet. Add an API key first, then add models here.</p>}
        {draft.models.map((m, i) => (
          <ModelRow
            key={m.id}
            m={m}
            first={i === 0}
            last={i === draft.models.length - 1}
            onChange={(nm) => update({ models: draft.models.map((x) => (x.id === m.id ? nm : x)) })}
            onDelete={() => update({ models: draft.models.filter((x) => x.id !== m.id) })}
            onMove={(dir) => {
              const list = [...draft.models];
              const j = i + dir;
              [list[i], list[j]] = [list[j], list[i]];
              update({ models: list });
            }}
          />
        ))}
        <div className="mt-3">
          <Button size="sm" onClick={() => setAdding(true)}>
            <PlusIcon size={16} /> Add models
          </Button>
        </div>
      </Section>

      <AddModelsModal
        open={adding}
        onClose={() => setAdding(false)}
        view={view}
        existing={draft.models}
        onAdd={(m) => {
          if (draft.models.some((x) => x.id === m.id)) return;
          setDraft({ ...draft, models: [...draft.models, m], defaultModel: draft.defaultModel ?? m.id });
        }}
      />
      <SaveBar dirty={dirty} saving={saving} onSave={() => save()} onReset={() => setDraft(view.config)} />
    </div>
  );
}

// ---------- Voice ----------

const STT_DEFAULTS: Record<string, string> = {
  openai: "gpt-4o-mini-transcribe",
  groq: "whisper-large-v3-turbo",
  google: "gemini-3.5-transcribe",
  openrouter: "openai/gpt-4o-mini-transcribe",
  elevenlabs: "scribe_v2",
};
const TTS_DEFAULTS: Record<string, string> = {
  openai: "gpt-4o-mini-tts",
  google: "gemini-3.1-flash-tts-preview",
  openrouter: "google/gemini-3.1-flash-tts-preview",
  elevenlabs: "eleven_flash_v2_5",
};
const OPENAI_VOICES = ["alloy", "ash", "ballad", "cedar", "coral", "echo", "fable", "marin", "nova", "onyx", "sage", "shimmer", "verse"];
const GEMINI_VOICES = ["Kore", "Puck", "Zephyr", "Charon", "Fenrir", "Leda", "Aoede", "Orus", "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat"];

/** Pick an OpenRouter text-to-speech model from OpenRouter's list, or type any model ID. */
function OpenRouterTtsModel({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [list, setList] = useState<{ modelId: string; name: string }[] | null>(null);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    let alive = true;
    api<{ modelId: string; name: string }[]>("/api/admin/provider-models?kind=tts")
      .then((l) => alive && setList(l))
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, []);
  if (!list) return <Spinner size={16} />;
  const known = list.some((m) => m.modelId === value);
  if (typing || !list.length || (!known && value)) {
    return (
      <div className="flex items-center gap-2">
        <input className={cn(inputClass, "w-56 py-1.5 font-mono")} value={value} placeholder="provider/model-id" onChange={(e) => onChange(e.target.value)} />
        {list.length > 0 && (
          <button className="text-xs text-link hover:underline" onClick={() => (setTyping(false), onChange(list[0].modelId))}>
            List
          </button>
        )}
      </div>
    );
  }
  return (
    <Select
      value={value}
      onChange={(v) => (v === "__other" ? (setTyping(true), onChange("")) : onChange(v))}
      options={[...list.map((m) => ({ value: m.modelId, label: m.name })), { value: "__other", label: "Other (type a model ID)…" }]}
      className="max-w-[240px]"
    />
  );
}

export function VoiceTab() {
  const { view, draft, setDraft, save, saving, dirty } = useAdminConfig();
  if (!view || !draft) return <Spinner size={18} />;
  const v = draft.voice;
  const setV = (patch: Partial<AppConfig["voice"]>) => setDraft({ ...draft, voice: { ...v, ...patch } });
  const keyMissing = (p: string) => p !== "browser" && !view.keys[p as SecretProvider];
  // OpenRouter voices depend on the model family (openai/… or google/…); other models take a typed voice name.
  const ttsFamily = v.tts.provider === "openrouter" ? v.tts.model.split("/")[0].toLowerCase() : v.tts.provider;
  const voiceOptions = ttsFamily === "openai" ? OPENAI_VOICES : ttsFamily === "google" ? GEMINI_VOICES : [];

  return (
    <div>
      <p className="mb-4 text-sm text-fg-2">
        Voice mode listens with a speech-to-text model, answers with a (preferably small and fast) text model, and speaks with a text-to-speech
        model. “Browser” options are free but sound more robotic and need Chrome, Edge or Safari.
      </p>
      <Section title="Speech to text (listening)">
        <Row label="Provider">
          <Select
            value={v.stt.provider}
            onChange={(provider) => setV({ stt: { provider, model: STT_DEFAULTS[provider] ?? "" } })}
            options={[
              { value: "browser", label: "Browser (free)" },
              { value: "openai", label: "OpenAI" },
              { value: "groq", label: "Groq (fast)" },
              { value: "google", label: "Google" },
              { value: "openrouter", label: "OpenRouter" },
              { value: "elevenlabs", label: "ElevenLabs" },
            ]}
          />
        </Row>
        {v.stt.provider !== "browser" && (
          <Row label="Model" description={keyMissing(v.stt.provider) ? <span className="text-danger">Add this provider&apos;s API key first.</span> : undefined}>
            <input className={cn(inputClass, "w-56 py-1.5 font-mono")} value={v.stt.model} onChange={(e) => setV({ stt: { ...v.stt, model: e.target.value } })} />
          </Row>
        )}
      </Section>
      <Section title="Voice chat model (thinking)">
        <Row label="Model used in voice mode" description="A small model answers faster, which feels more natural.">
          <Select
            value={v.chatModel ?? ""}
            onChange={(chatModel) => setV({ chatModel: chatModel || null })}
            options={[{ value: "", label: "Same as selected model" }, ...draft.models.filter((m) => m.enabled).map((m) => ({ value: m.id, label: m.name }))]}
            className="max-w-[200px]"
          />
        </Row>
      </Section>
      <Section title="Text to speech (talking)">
        <Row label="Provider">
          <Select
            value={v.tts.provider}
            onChange={(provider) =>
              setV({
                tts: {
                  ...v.tts,
                  provider,
                  model: TTS_DEFAULTS[provider] ?? "",
                  defaultVoice: provider === "openai" ? "marin" : provider === "google" || provider === "openrouter" ? "Kore" : "",
                },
              })
            }
            options={[
              { value: "browser", label: "Browser (free)" },
              { value: "openai", label: "OpenAI" },
              { value: "google", label: "Google" },
              { value: "openrouter", label: "OpenRouter" },
              { value: "elevenlabs", label: "ElevenLabs" },
            ]}
          />
        </Row>
        {v.tts.provider !== "browser" && (
          <>
            <Row
              label="Model"
              description={
                keyMissing(v.tts.provider) ? (
                  <span className="text-danger">Add this provider&apos;s API key first.</span>
                ) : v.tts.provider === "openrouter" ? (
                  "OpenRouter's voice models."
                ) : undefined
              }
            >
              {v.tts.provider === "openrouter" ? (
                <OpenRouterTtsModel value={v.tts.model} onChange={(model) => setV({ tts: { ...v.tts, model } })} />
              ) : (
                <input className={cn(inputClass, "w-56 py-1.5 font-mono")} value={v.tts.model} onChange={(e) => setV({ tts: { ...v.tts, model: e.target.value } })} />
              )}
            </Row>
            {v.tts.provider === "openrouter" && !voiceOptions.length ? (
              <Row label="Voice" description="The voice name this model uses (see the model's page on OpenRouter).">
                <input
                  className={cn(inputClass, "w-56 py-1.5 font-mono")}
                  value={v.tts.defaultVoice}
                  onChange={(e) => setV({ tts: { ...v.tts, defaultVoice: e.target.value } })}
                />
              </Row>
            ) : v.tts.provider === "elevenlabs" ? (
              <div className="py-3">
                <div className="mb-1.5 text-sm">Voices</div>
                <textarea
                  className={cn(inputClass, "min-h-[80px] font-mono text-xs")}
                  placeholder={"Rachel=21m00Tcm4TlvDq8ikWAM\nAdam=pNInz6obpgDQGcFmaJgB"}
                  value={v.tts.elevenVoices}
                  onChange={(e) => setV({ tts: { ...v.tts, elevenVoices: e.target.value } })}
                />
                <p className="mt-1 text-xs text-fg-3">One per line as Name=VoiceID. Find voice IDs in your ElevenLabs voice library.</p>
              </div>
            ) : (
              <Row label="Default voice" description="People can pick their own in Settings → General.">
                <Select value={v.tts.defaultVoice} onChange={(defaultVoice) => setV({ tts: { ...v.tts, defaultVoice } })} options={voiceOptions.map((x) => ({ value: x, label: x }))} />
              </Row>
            )}
          </>
        )}
      </Section>
      <SaveBar dirty={dirty} saving={saving} onSave={() => save()} onReset={() => setDraft(view.config)} />
    </div>
  );
}

// ---------- Users ----------

interface UserRow {
  id: string;
  username: string;
  name: string;
  role: "admin" | "user";
  totpEnabled: boolean;
  disabled: boolean;
  createdAt: number;
  lastSeen: number | null;
}

function generatePassword() {
  const words = ["sunny", "maple", "river", "tiger", "cloud", "piano", "lemon", "rocket", "garden", "silver", "ocean", "falcon", "clover", "amber", "hazel"];
  const pick = () => words[crypto.getRandomValues(new Uint32Array(1))[0] % words.length];
  const num = crypto.getRandomValues(new Uint32Array(1))[0] % 90 + 10;
  return `${pick()}-${pick()}-${pick()}-${num}`;
}

export function UsersTab() {
  const me = useApp((s) => s.user!);
  const toast = useApp((s) => s.toast);
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [form, setForm] = useState({ name: "", username: "", password: "", role: "user" as "user" | "admin" });
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => void api<UserRow[]>("/api/admin/users").then(setUsers), []);
  useEffect(load, [load]);

  const patch = async (id: string, body: Record<string, unknown>, msg: string) => {
    try {
      await api(`/api/admin/users/${id}`, { method: "PATCH", body });
      toast(msg, "success");
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div>
      <p className="mb-4 text-sm text-fg-2">
        Create accounts for family members. Each person has their own private chats, memories and settings. Admins can&apos;t read other people&apos;s
        chats here.
      </p>
      <Section title="People">
        {!users ? (
          <Spinner size={16} />
        ) : (
          users.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-2 border-b border-line-2 py-3 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm">
                  {u.name}
                  {u.role === "admin" && <span className="rounded bg-muted px-1.5 py-px text-[10px] text-fg-2">Admin</span>}
                  {u.totpEnabled && <span className="rounded bg-muted px-1.5 py-px text-[10px] text-fg-2">2FA</span>}
                  {u.disabled && <span className="rounded bg-danger/15 px-1.5 py-px text-[10px] text-danger">Disabled</span>}
                </div>
                <div className="text-xs text-fg-3">
                  @{u.username} · {u.lastSeen ? `active ${new Date(u.lastSeen).toLocaleDateString()}` : "never logged in"}
                </div>
              </div>
              {u.id !== me.id && (
                <>
                  <Button
                    size="sm"
                    onClick={async () => {
                      const password = await promptDialog({ title: `New password for ${u.name}`, value: generatePassword(), confirmLabel: "Set password" });
                      if (password) await patch(u.id, { password }, `Password changed. Tell ${u.name} the new password: ${password}`);
                    }}
                  >
                    Reset password
                  </Button>
                  {u.totpEnabled && (
                    <Button size="sm" onClick={() => patch(u.id, { resetTwoFactor: true }, "2FA reset")}>
                      Reset 2FA
                    </Button>
                  )}
                  <Button size="sm" onClick={() => patch(u.id, { role: u.role === "admin" ? "user" : "admin" }, "Role updated")}>
                    {u.role === "admin" ? "Make member" : "Make admin"}
                  </Button>
                  <Button size="sm" onClick={() => patch(u.id, { disabled: !u.disabled }, u.disabled ? "Account enabled" : "Account disabled")}>
                    {u.disabled ? "Enable" : "Disable"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    onClick={async () => {
                      if (!(await confirmDialog({ title: `Delete ${u.name}'s account?`, body: "All of their chats and data will be permanently deleted.", confirmLabel: "Delete", danger: true }))) return;
                      try {
                        await api(`/api/admin/users/${u.id}`, { method: "DELETE" });
                        load();
                      } catch (e) {
                        toast((e as Error).message, "error");
                      }
                    }}
                  >
                    <TrashIcon size={16} />
                  </Button>
                </>
              )}
            </div>
          ))
        )}
      </Section>

      <Section title="Add a person">
        <form
          className="grid gap-2 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api("/api/admin/users", { body: form });
              setCreated({ username: form.username.trim().toLowerCase(), password: form.password });
              setForm({ name: "", username: "", password: "", role: "user" });
              load();
            } catch (err) {
              toast((err as Error).message, "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          <input className={inputClass} placeholder="Name (e.g. Dad)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={inputClass} placeholder="Username" autoCapitalize="none" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <div className="flex gap-2 sm:col-span-2">
            <input className={cn(inputClass, "font-mono")} placeholder="Password (10+ characters)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <Button size="sm" className="h-10 shrink-0" onClick={() => setForm({ ...form, password: generatePassword() })}>
              Generate
            </Button>
          </div>
          <div className="flex items-center justify-between sm:col-span-2">
            <Select
              value={form.role}
              onChange={(role) => setForm({ ...form, role })}
              options={[
                { value: "user", label: "Member" },
                { value: "admin", label: "Admin (can manage keys & people)" },
              ]}
            />
            <Button type="submit" variant="primary" size="sm" disabled={busy || !form.name || !form.username || !form.password}>
              Create account
            </Button>
          </div>
        </form>
      </Section>

      <Modal open={!!created} onClose={() => setCreated(null)} title="Account created" className="max-w-md">
        <div className="space-y-3 px-5 pb-5 pt-3 text-sm">
          <p className="text-fg-2">Send these to them (in person or by text). They can change the password in Settings → Security.</p>
          <div className="rounded-xl bg-muted p-4 font-mono text-sm">
            <div>Website: {typeof window !== "undefined" ? window.location.origin : ""}</div>
            <div>Username: {created?.username}</div>
            <div>Password: {created?.password}</div>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setCreated(null)}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
