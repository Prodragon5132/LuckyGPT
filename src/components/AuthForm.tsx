"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/client/utils";
import { Logo } from "./icons";
import { Spinner } from "./ui";

const input =
  "h-[52px] w-full rounded-full border border-line bg-transparent px-5 text-base text-fg outline-none transition-colors focus:border-[#10a37f]";

function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center bg-surface px-4 text-fg">
      <div className="flex w-full max-w-sm flex-1 flex-col justify-center py-10">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size={44} className="mb-6 text-[#1f9d63]" />
          <h1 className="text-[28px] font-semibold leading-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-fg-2">{subtitle}</p>}
        </div>
        {children}
      </div>
      <p className="pb-6 text-xs text-fg-3">LuckyGPT · private and secure</p>
    </div>
  );
}

export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mfaToken) {
        await api("/api/auth/mfa", { body: { mfaToken, code } });
        window.location.href = "/";
        return;
      }
      const res = await api<{ ok?: boolean; mfaRequired?: boolean; mfaToken?: string }>("/api/auth/login", {
        body: { username, password },
      });
      if (res.mfaRequired && res.mfaToken) {
        setMfaToken(res.mfaToken);
        setPassword("");
      } else {
        window.location.href = "/";
        return;
      }
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };

  if (mfaToken) {
    return (
      <Shell title="Check your authenticator" subtitle="Enter the 6-digit code from your authenticator app, or one of your recovery codes.">
        <form onSubmit={submit} className="space-y-3">
          <input
            autoFocus
            className={cn(input, "text-center font-mono tracking-[0.3em]")}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={20}
          />
          {error && <p className="px-2 text-sm text-danger">{error}</p>}
          <button disabled={busy || !code.trim()} className="flex h-[52px] w-full items-center justify-center rounded-full bg-[#0d0d0d] text-base font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black">
            {busy ? <Spinner size={18} /> : "Continue"}
          </button>
          <button type="button" onClick={() => { setMfaToken(null); setCode(""); setError(""); }} className="w-full text-sm text-fg-2 hover:underline">
            Back
          </button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell title="Welcome back">
      <form onSubmit={submit} className="space-y-3">
        <input
          autoFocus
          className={input}
          placeholder="Username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input className={input} type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="px-2 text-sm text-danger">{error}</p>}
        <button
          disabled={busy || !username || !password}
          className="flex h-[52px] w-full items-center justify-center rounded-full bg-[#0d0d0d] text-base font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {busy ? <Spinner size={18} /> : "Continue"}
        </button>
        <p className="pt-2 text-center text-xs text-fg-3">Forgot your password? Ask the person who set up LuckyGPT to reset it.</p>
      </form>
    </Shell>
  );
}

export function SetupForm({ codeRequired }: { codeRequired: boolean }) {
  const [form, setForm] = useState({ code: "", name: "", username: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const up = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <Shell title="Set up LuckyGPT" subtitle="Create the owner account. You'll add API keys and invite family members next.">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (form.password !== form.confirm) return setError("The passwords don't match.");
          setBusy(true);
          setError("");
          try {
            await api("/api/auth/setup", { body: { code: form.code || undefined, name: form.name, username: form.username, password: form.password } });
            window.location.href = "/";
            return;
          } catch (err) {
            setError((err as Error).message);
          }
          setBusy(false);
        }}
      >
        {codeRequired && (
          <input className={input} type="password" placeholder="Setup code (SETUP_CODE)" autoComplete="off" value={form.code} onChange={up("code")} />
        )}
        <input className={input} placeholder="Your name" value={form.name} onChange={up("name")} autoComplete="name" />
        <input className={input} placeholder="Username" autoCapitalize="none" autoComplete="username" value={form.username} onChange={up("username")} />
        <input className={input} type="password" placeholder="Password (10+ characters)" autoComplete="new-password" value={form.password} onChange={up("password")} />
        <input className={input} type="password" placeholder="Confirm password" autoComplete="new-password" value={form.confirm} onChange={up("confirm")} />
        {error && <p className="px-2 text-sm text-danger">{error}</p>}
        <button
          disabled={busy || !form.name || !form.username || !form.password}
          className="flex h-[52px] w-full items-center justify-center rounded-full bg-[#0d0d0d] text-base font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {busy ? <Spinner size={18} /> : "Create account"}
        </button>
      </form>
    </Shell>
  );
}
