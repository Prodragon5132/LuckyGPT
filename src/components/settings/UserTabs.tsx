"use client";

import { useEffect, useState } from "react";
import { useApp, applyTheme } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import { cn, formatDate } from "@/lib/client/utils";
import { browserVoices, readAloud, stopSpeaking } from "@/lib/client/voice";
import type { ChatSummary, Memory, Personality, UserPrefs } from "@/lib/shared/types";
import { Button, confirmDialog, inputClass, Modal, promptDialog, Select, Spinner, Toggle } from "../ui";
import { Row, Section } from "./common";
import { SpeakerIcon, TrashIcon, ArchiveIcon } from "../icons";
import { useRouter } from "next/navigation";

const ACCENTS: { value: UserPrefs["accent"]; label: string; color: string }[] = [
  { value: "default", label: "Default", color: "#8f8f8f" },
  { value: "blue", label: "Blue", color: "#0169cc" },
  { value: "green", label: "Green", color: "#00a240" },
  { value: "yellow", label: "Yellow", color: "#e0ac00" },
  { value: "pink", label: "Pink", color: "#e0569e" },
  { value: "orange", label: "Orange", color: "#e25507" },
  { value: "purple", label: "Purple", color: "#924ff7" },
];

const LANGUAGES = [
  ["auto", "Auto-detect"],
  ["en-US", "English"],
  ["es-ES", "Spanish"],
  ["fr-FR", "French"],
  ["de-DE", "German"],
  ["it-IT", "Italian"],
  ["pt-BR", "Portuguese"],
  ["nl-NL", "Dutch"],
  ["pl-PL", "Polish"],
  ["ru-RU", "Russian"],
  ["uk-UA", "Ukrainian"],
  ["tr-TR", "Turkish"],
  ["ar-SA", "Arabic"],
  ["hi-IN", "Hindi"],
  ["zh-CN", "Chinese"],
  ["ja-JP", "Japanese"],
  ["ko-KR", "Korean"],
  ["vi-VN", "Vietnamese"],
  ["tl-PH", "Filipino"],
] as const;

export function GeneralTab() {
  const prefs = useApp((s) => s.user!.prefs);
  const setPrefs = useApp((s) => s.setPrefs);
  const models = useApp((s) => s.models);
  const voiceCfg = useApp((s) => s.voiceCfg);
  const [bVoices, setBVoices] = useState<{ id: string; name: string }[]>(() => browserVoices());

  useEffect(() => {
    if (voiceCfg.tts !== "browser" || typeof speechSynthesis === "undefined") return;
    const load = () => setBVoices(browserVoices());
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, [voiceCfg.tts]);

  const voices = voiceCfg.tts === "server" ? voiceCfg.voices : bVoices;

  return (
    <div>
      <Row label="Theme">
        <Select
          value={prefs.theme}
          onChange={(theme) => {
            applyTheme(theme, prefs.accent);
            void setPrefs({ theme });
          }}
          options={[
            { value: "system", label: "System" },
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
          ]}
        />
      </Row>
      <Row label="Accent color">
        <div className="flex items-center gap-1.5">
          {ACCENTS.map((a) => (
            <button
              key={a.value}
              title={a.label}
              onClick={() => {
                applyTheme(prefs.theme, a.value);
                void setPrefs({ accent: a.value });
              }}
              className={cn("h-5 w-5 rounded-full ring-offset-2 ring-offset-elevated", prefs.accent === a.value && "ring-2 ring-fg-3")}
              style={{ background: a.color }}
              aria-label={a.label}
            />
          ))}
        </div>
      </Row>
      <Row label="Default model" description="Used for new chats.">
        <Select
          value={prefs.defaultModel ?? ""}
          onChange={(v) => void setPrefs({ defaultModel: v || null })}
          options={[{ value: "", label: "Admin's default" }, ...models.map((m) => ({ value: m.id, label: m.name }))]}
          className="max-w-[200px]"
        />
      </Row>
      <Row label="Spoken language" description="For voice input. Auto-detect works for most languages.">
        <Select
          value={prefs.spokenLanguage}
          onChange={(v) => void setPrefs({ spokenLanguage: v })}
          options={LANGUAGES.map(([value, label]) => ({ value, label }))}
        />
      </Row>
      <Row label="Voice" description={voiceCfg.tts === "server" ? "Used in voice mode and Read aloud." : "Your browser's built-in voices (free)."}>
        <button
          onClick={() =>
            void readAloud("voice-preview", "Hi! This is how I sound. How can I help you today?", {
              tts: voiceCfg.tts,
              voice: prefs.voice !== "default" ? prefs.voice : undefined,
              lang: prefs.spokenLanguage,
            })
          }
          onBlur={() => stopSpeaking()}
          className="flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-sm hover:bg-hover"
        >
          <SpeakerIcon size={16} /> Play
        </button>
        <Select
          value={prefs.voice}
          onChange={(v) => void setPrefs({ voice: v })}
          options={[{ value: "default", label: "Default" }, ...voices.map((v) => ({ value: v.id, label: v.name }))]}
          className="max-w-[180px]"
        />
      </Row>
      <Row label="Read responses aloud automatically" description="Reads each new answer out loud (not in voice mode).">
        <Toggle checked={!!prefs.autoReadAloud} onChange={(v) => void setPrefs({ autoReadAloud: v })} />
      </Row>
    </div>
  );
}

const TRAITS = ["Chatty", "Witty", "Straight shooting", "Encouraging", "Gen Z", "Skeptical", "Traditional", "Forward thinking", "Poetic"];

export function PersonalizationTab() {
  const prefs = useApp((s) => s.user!.prefs);
  const setPrefs = useApp((s) => s.setPrefs);
  const set = useApp((s) => s.set);
  const [ci, setCi] = useState(prefs.customInstructions);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(ci) !== JSON.stringify(prefs.customInstructions);

  return (
    <div>
      <Section title="Custom instructions" description="LuckyGPT uses these in every chat. Changes apply to new messages.">
        <Row label="Enable customization">
          <Toggle checked={ci.enabled} onChange={(enabled) => setCi({ ...ci, enabled })} />
        </Row>
        <Row label="LuckyGPT personality" description="Set the style and tone LuckyGPT uses when responding.">
          <Select<Personality>
            value={prefs.personality}
            onChange={(personality) => void setPrefs({ personality })}
            options={[
              { value: "default", label: "Default" },
              { value: "cynic", label: "Cynic" },
              { value: "robot", label: "Robot" },
              { value: "listener", label: "Listener" },
              { value: "nerd", label: "Nerd" },
            ]}
          />
        </Row>
        <div className={cn("mt-3 space-y-4", !ci.enabled && "pointer-events-none opacity-50")}>
          <label className="block">
            <span className="mb-1.5 block text-sm">What should LuckyGPT call you?</span>
            <input className={inputClass} value={ci.nickname} maxLength={100} onChange={(e) => setCi({ ...ci, nickname: e.target.value })} placeholder="Nickname" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm">What do you do?</span>
            <input className={inputClass} value={ci.occupation} maxLength={200} onChange={(e) => setCi({ ...ci, occupation: e.target.value })} placeholder="e.g. Retired engineer" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm">What traits should LuckyGPT have?</span>
            <textarea
              className={cn(inputClass, "min-h-[88px] resize-y")}
              value={ci.traits}
              maxLength={1500}
              onChange={(e) => setCi({ ...ci, traits: e.target.value })}
              placeholder="Describe or select traits"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TRAITS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setCi({ ...ci, traits: ci.traits ? `${ci.traits.trim()} ${t}.` : `${t}.` })}
                  className="rounded-full border border-line px-2.5 py-1 text-xs hover:bg-hover"
                >
                  + {t}
                </button>
              ))}
            </div>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm">Anything else LuckyGPT should know about you?</span>
            <textarea
              className={cn(inputClass, "min-h-[88px] resize-y")}
              value={ci.about}
              maxLength={1500}
              onChange={(e) => setCi({ ...ci, about: e.target.value })}
              placeholder="Interests, values, or preferences to keep in mind"
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" onClick={() => setCi(prefs.customInstructions)} disabled={!dirty}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!dirty || saving}
            onClick={async () => {
              setSaving(true);
              await setPrefs({ customInstructions: ci });
              setSaving(false);
            }}
          >
            {saving ? <Spinner size={14} /> : null} Save
          </Button>
        </div>
      </Section>

      <Section title="Memory">
        <Row
          label="Reference saved memories"
          description="Let LuckyGPT save and use memories when responding. You can see and delete them any time."
        >
          <Toggle checked={prefs.memoryEnabled} onChange={(memoryEnabled) => void setPrefs({ memoryEnabled })} />
        </Row>
        <Row label="Manage memories">
          <Button size="sm" onClick={() => set({ memoriesOpen: true })}>
            Manage
          </Button>
        </Row>
      </Section>
    </div>
  );
}

/** Loads data once when mounted (dialogs mount their content only while open). */
function useLoad<T>(url: string): [T | null, React.Dispatch<React.SetStateAction<T | null>>] {
  const [data, setData] = useState<T | null>(null);
  const toast = useApp((s) => s.toast);
  useEffect(() => {
    let alive = true;
    api<T>(url)
      .then((d) => alive && setData(d))
      .catch((e) => toast(e.message, "error"));
    return () => {
      alive = false;
    };
  }, [url, toast]);
  return [data, setData];
}

export function MemoriesModal() {
  const open = useApp((s) => s.memoriesOpen);
  const set = useApp((s) => s.set);
  return (
    <Modal open={open} onClose={() => set({ memoriesOpen: false })} title="Saved memories" className="max-w-2xl">
      <MemoriesList />
    </Modal>
  );
}

function MemoriesList() {
  const [items, setItems] = useLoad<Memory[]>("/api/memories");
  return (
      <div className="px-5 pb-5 pt-2">
        <p className="mb-3 text-sm text-fg-2">LuckyGPT remembers helpful things you share and uses them in future chats.</p>
        {!items ? (
          <div className="flex justify-center py-8">
            <Spinner size={20} />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-line p-6 text-center text-sm text-fg-3">
            No memories yet. Tell LuckyGPT something like “Remember that I like short answers.”
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line">
            {items.map((m) => (
              <div key={m.id} className="group flex items-start gap-3 border-b border-line-2 px-4 py-3 last:border-b-0">
                <span className="flex-1 text-sm">{m.content}</span>
                <button
                  onClick={async () => {
                    await api(`/api/memories/${m.id}`, { method: "DELETE" });
                    setItems((all) => all!.filter((x) => x.id !== m.id));
                  }}
                  className="rounded-md p-1 text-fg-3 hover:bg-hover hover:text-danger"
                  aria-label="Delete memory"
                >
                  <TrashIcon size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
        {items && items.length > 0 && (
          <div className="mt-4 flex justify-end">
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                if (!(await confirmDialog({ title: "Clear all memories?", body: "LuckyGPT will forget everything it has saved about you.", confirmLabel: "Clear memory", danger: true }))) return;
                await api("/api/memories", { method: "DELETE" });
                setItems([]);
              }}
            >
              Delete all
            </Button>
          </div>
        )}
      </div>
  );
}

export function DataTab() {
  const set = useApp((s) => s.set);
  const toast = useApp((s) => s.toast);
  const loadChats = useApp((s) => s.loadChats);
  const router = useRouter();
  return (
    <div>
      <Row label="Shared links">
        <Button size="sm" onClick={() => set({ sharedLinksOpen: true })}>
          Manage
        </Button>
      </Row>
      <Row label="Archived chats">
        <Button size="sm" onClick={() => set({ archivedOpen: true })}>
          Manage
        </Button>
      </Row>
      <Row label="Archive all chats">
        <Button
          size="sm"
          onClick={async () => {
            if (!(await confirmDialog({ title: "Archive all chats?", body: "You can find them later in Archived chats.", confirmLabel: "Archive all" }))) return;
            await api("/api/chats/bulk", { body: { action: "archiveAll" } });
            await loadChats();
            router.push("/");
            toast("All chats archived", "success");
          }}
        >
          Archive all
        </Button>
      </Row>
      <Row label="Delete all chats">
        <Button
          size="sm"
          variant="danger"
          onClick={async () => {
            if (!(await confirmDialog({ title: "Delete all chats?", body: "This permanently deletes every chat, including archived ones and chats in projects. This can't be undone.", confirmLabel: "Delete all", danger: true }))) return;
            await api("/api/chats/bulk", { body: { action: "deleteAll" } });
            useApp.setState({ sessions: {} });
            await loadChats();
            router.push("/");
            toast("All chats deleted", "success");
          }}
        >
          Delete all
        </Button>
      </Row>
      <Row label="Export data" description="Download all your chats, memories, projects and GPTs as a file.">
        <a href="/api/export" className="flex h-8 items-center rounded-full border border-line px-3 text-sm font-medium hover:bg-hover">
          Export
        </a>
      </Row>
      <p className="mt-4 text-xs leading-5 text-fg-3">
        Your chats are stored encrypted in your own database and are never used to train AI models. When you chat, your message is sent to the AI
        provider of the model you picked (for example OpenAI, Anthropic, Google or OpenRouter) under their API privacy terms.
      </p>
    </div>
  );
}

export function ArchivedModal() {
  const open = useApp((s) => s.archivedOpen);
  const set = useApp((s) => s.set);
  return (
    <Modal open={open} onClose={() => set({ archivedOpen: false })} title="Archived chats" className="max-w-2xl">
      <ArchivedList />
    </Modal>
  );
}

function ArchivedList() {
  const set = useApp((s) => s.set);
  const loadChats = useApp((s) => s.loadChats);
  const router = useRouter();
  const [items, setItems] = useLoad<ChatSummary[]>("/api/chats?archived=1");
  return (
      <div className="px-5 pb-5 pt-2">
        {!items ? (
          <div className="flex justify-center py-8">
            <Spinner size={20} />
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-fg-3">You have no archived chats.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line">
            {items.map((c) => (
              <div key={c.id} className="flex items-center gap-3 border-b border-line-2 px-4 py-2.5 last:border-b-0">
                <button
                  className="min-w-0 flex-1 truncate text-left text-sm text-link hover:underline"
                  onClick={() => {
                    set({ archivedOpen: false, settingsTab: null });
                    router.push(`/c/${c.id}`);
                  }}
                >
                  {c.title}
                </button>
                <span className="hidden text-xs text-fg-3 sm:inline">{formatDate(c.createdAt)}</span>
                <button
                  title="Unarchive"
                  onClick={async () => {
                    await api(`/api/chats/${c.id}`, { method: "PATCH", body: { archived: false } });
                    setItems((all) => all!.filter((x) => x.id !== c.id));
                    await loadChats();
                  }}
                  className="rounded-md p-1.5 text-fg-2 hover:bg-hover"
                  aria-label="Unarchive"
                >
                  <ArchiveIcon size={16} />
                </button>
                <button
                  title="Delete"
                  onClick={async () => {
                    await api(`/api/chats/${c.id}`, { method: "DELETE" });
                    setItems((all) => all!.filter((x) => x.id !== c.id));
                  }}
                  className="rounded-md p-1.5 text-fg-2 hover:bg-hover hover:text-danger"
                  aria-label="Delete"
                >
                  <TrashIcon size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
  );
}

export function SharedLinksModal() {
  const open = useApp((s) => s.sharedLinksOpen);
  const set = useApp((s) => s.set);
  return (
    <Modal open={open} onClose={() => set({ sharedLinksOpen: false })} title="Shared links" className="max-w-2xl">
      <SharedLinksList />
    </Modal>
  );
}

function SharedLinksList() {
  const [items, setItems] = useLoad<{ id: string; chatId: string; title: string; createdAt: number }[]>("/api/shares");
  return (
      <div className="px-5 pb-5 pt-2">
        {!items ? (
          <div className="flex justify-center py-8">
            <Spinner size={20} />
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-fg-3">You haven&apos;t shared any chats.</p>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-line">
              {items.map((s) => (
                <div key={s.id} className="flex items-center gap-3 border-b border-line-2 px-4 py-2.5 last:border-b-0">
                  <a href={`/share/${s.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm text-link hover:underline">
                    {s.title}
                  </a>
                  <span className="hidden text-xs text-fg-3 sm:inline">{formatDate(s.createdAt)}</span>
                  <button
                    onClick={async () => {
                      await api(`/api/shares/${s.id}`, { method: "DELETE" });
                      setItems((all) => all!.filter((x) => x.id !== s.id));
                    }}
                    className="rounded-md p-1.5 text-fg-2 hover:bg-hover hover:text-danger"
                    aria-label="Delete shared link"
                  >
                    <TrashIcon size={16} />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  if (!(await confirmDialog({ title: "Delete all shared links?", confirmLabel: "Delete all", danger: true }))) return;
                  await api("/api/shares", { method: "DELETE" });
                  setItems([]);
                }}
              >
                Delete all
              </Button>
            </div>
          </>
        )}
      </div>
  );
}

interface SessionRow {
  id: string;
  device: string;
  ip: string | null;
  lastSeenAt: number;
  current: boolean;
}

export function SecurityTab() {
  const user = useApp((s) => s.user!);
  const set = useApp((s) => s.set);
  const toast = useApp((s) => s.toast);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [setup, setSetup] = useState<{ qrSvg: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwOpen, setPwOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadSessions = () => void api<SessionRow[]>("/api/auth/sessions").then(setSessions);
  useEffect(loadSessions, []);

  const refreshUser = async () => set({ user: await api("/api/auth/me") });

  return (
    <div>
      <Section title="Multi-factor authentication" description="Adds a second step when logging in: a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).">
        <Row label="Authenticator app" description={user.totpEnabled ? "On — your account requires a code to log in." : "Off"}>
          {user.totpEnabled ? (
            <Button
              size="sm"
              onClick={async () => {
                const password = await promptDialog({ title: "Enter your password to turn off 2FA", confirmLabel: "Turn off" });
                if (!password) return;
                try {
                  await api("/api/auth/totp/disable", { body: { password } });
                  await refreshUser();
                  toast("Two-factor authentication turned off");
                } catch (e) {
                  toast((e as Error).message, "error");
                }
              }}
            >
              Turn off
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              onClick={async () => {
                try {
                  setSetup(await api("/api/auth/totp/setup", { body: {} }));
                } catch (e) {
                  toast((e as Error).message, "error");
                }
              }}
            >
              Set up
            </Button>
          )}
        </Row>
      </Section>

      <Section title="Password">
        <Row label="Change password">
          <Button size="sm" onClick={() => setPwOpen(true)}>
            Change
          </Button>
        </Row>
      </Section>

      <Section title="Devices">
        {!sessions ? (
          <Spinner size={16} />
        ) : (
          sessions.map((s) => (
            <Row
              key={s.id}
              label={
                <span>
                  {s.device} {s.current && <span className="ml-1 rounded bg-muted px-1.5 py-px text-[10px] text-fg-2">This device</span>}
                </span>
              }
              description={`Last active ${new Date(s.lastSeenAt).toLocaleString()}${s.ip ? ` · ${s.ip}` : ""}`}
            >
              {!s.current && (
                <Button
                  size="sm"
                  onClick={async () => {
                    await api("/api/auth/sessions", { method: "DELETE", body: { id: s.id } });
                    loadSessions();
                  }}
                >
                  Log out
                </Button>
              )}
            </Row>
          ))
        )}
        <Row label="Log out of this device">
          <Button
            size="sm"
            onClick={async () => {
              await api("/api/auth/logout", { body: {} });
              window.location.href = "/login";
            }}
          >
            Log out
          </Button>
        </Row>
        <Row label="Log out of all devices" description="Logs out every browser and phone, including this one.">
          <Button
            size="sm"
            variant="danger"
            onClick={async () => {
              if (!(await confirmDialog({ title: "Log out of all devices?", confirmLabel: "Log out all", danger: true }))) return;
              await api("/api/auth/logout-all", { body: {} });
              window.location.href = "/login";
            }}
          >
            Log out all
          </Button>
        </Row>
      </Section>

      <Modal open={!!setup} onClose={() => { setSetup(null); setCode(""); }} title="Set up two-factor authentication" className="max-w-md">
        {setup && (
          <div className="space-y-4 px-5 pb-5 pt-3 text-sm">
            <p className="text-fg-2">1. Scan this QR code with your authenticator app.</p>
            <div className="mx-auto w-fit rounded-xl bg-white p-3" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
            <p className="text-center text-xs text-fg-3">
              Can&apos;t scan? Enter this key: <code className="select-all break-all font-mono">{setup.secret}</code>
            </p>
            <p className="text-fg-2">2. Enter the 6-digit code it shows.</p>
            <input
              className={cn(inputClass, "text-center font-mono text-lg tracking-[0.4em]")}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <div className="flex justify-end">
              <Button
                variant="primary"
                disabled={code.length !== 6 || busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const res = await api<{ recoveryCodes: string[] }>("/api/auth/totp/enable", { body: { code } });
                    setSetup(null);
                    setCode("");
                    setRecovery(res.recoveryCodes);
                    await refreshUser();
                    loadSessions();
                  } catch (e) {
                    toast((e as Error).message, "error");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Turn on
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!recovery} onClose={() => setRecovery(null)} title="Save your recovery codes" className="max-w-md">
        <div className="space-y-4 px-5 pb-5 pt-3 text-sm">
          <p className="text-fg-2">
            If you lose your phone, each of these codes can be used once instead of an authenticator code. Write them down or store them somewhere
            safe. They won&apos;t be shown again.
          </p>
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-4 font-mono text-sm">
            {recovery?.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setRecovery(null)}>
              I saved them
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={pwOpen} onClose={() => setPwOpen(false)} title="Change password" className="max-w-md">
        <form
          className="space-y-3 px-5 pb-5 pt-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (pw.next !== pw.confirm) return toast("The new passwords don't match.", "error");
            setBusy(true);
            try {
              await api("/api/auth/password", { body: { current: pw.current, next: pw.next } });
              toast("Password changed. Other devices were logged out.", "success");
              setPw({ current: "", next: "", confirm: "" });
              setPwOpen(false);
              loadSessions();
            } catch (err) {
              toast((err as Error).message, "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          <input type="password" autoComplete="current-password" placeholder="Current password" className={inputClass} value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          <input type="password" autoComplete="new-password" placeholder="New password (10+ characters)" className={inputClass} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          <input type="password" autoComplete="new-password" placeholder="Confirm new password" className={inputClass} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          <div className="flex justify-end pt-1">
            <Button type="submit" variant="primary" disabled={busy || !pw.current || !pw.next}>
              Change password
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export function AccountTab() {
  const user = useApp((s) => s.user!);
  const setName = useApp((s) => s.setName);
  const toast = useApp((s) => s.toast);
  const [name, setNameDraft] = useState(user.name);
  return (
    <div>
      <Row label="Name">
        <input className={cn(inputClass, "w-48 py-1.5")} value={name} maxLength={60} onChange={(e) => setNameDraft(e.target.value)} />
        <Button
          size="sm"
          variant="primary"
          disabled={!name.trim() || name === user.name}
          onClick={async () => {
            try {
              await setName(name.trim());
              toast("Name updated", "success");
            } catch (e) {
              toast((e as Error).message, "error");
            }
          }}
        >
          Save
        </Button>
      </Row>
      <Row label="Username" description="Used to log in.">
        <span className="text-sm text-fg-2">@{user.username}</span>
      </Row>
      <Row label="Role">
        <span className="text-sm text-fg-2">{user.role === "admin" ? "Admin" : "Member"}</span>
      </Row>
      <Row label="Plan" description="LuckyGPT is your own private app. There's no subscription.">
        <span className="text-sm text-fg-2">Free</span>
      </Row>
    </div>
  );
}
