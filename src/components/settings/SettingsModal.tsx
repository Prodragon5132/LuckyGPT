"use client";

import type { ReactNode } from "react";
import { useApp, type SettingsTab } from "@/lib/client/store";
import { cn } from "@/lib/client/utils";
import { BugIcon, CloseIcon, CpuIcon, DatabaseIcon, HeadphonesIcon, KeyIcon, PaletteIcon, SettingsIcon, ShieldIcon, UserIcon, UsersIcon } from "../icons";
import { Modal } from "../ui";
import { AccountTab, DataTab, GeneralTab, PersonalizationTab, SecurityTab } from "./UserTabs";
import { ErrorsTab, KeysTab, ModelsTab, UsersTab, VoiceTab } from "./AdminTabs";

const TABS: { id: SettingsTab; label: string; icon: ReactNode; admin?: boolean }[] = [
  { id: "general", label: "General", icon: <SettingsIcon size={18} /> },
  { id: "personalization", label: "Personalization", icon: <PaletteIcon size={18} /> },
  { id: "data", label: "Data controls", icon: <DatabaseIcon size={18} /> },
  { id: "security", label: "Security", icon: <ShieldIcon size={18} /> },
  { id: "account", label: "Account", icon: <UserIcon size={18} /> },
  { id: "keys", label: "API keys", icon: <KeyIcon size={18} />, admin: true },
  { id: "models", label: "Models", icon: <CpuIcon size={18} />, admin: true },
  { id: "voice", label: "Voice", icon: <HeadphonesIcon size={18} />, admin: true },
  { id: "users", label: "People", icon: <UsersIcon size={18} />, admin: true },
  { id: "errors", label: "Error logs", icon: <BugIcon size={18} />, admin: true },
];

export function SettingsModal() {
  const tab = useApp((s) => s.settingsTab);
  const isAdmin = useApp((s) => s.user?.role === "admin");
  const set = useApp((s) => s.set);
  const open = !!tab;
  const tabs = TABS.filter((t) => !t.admin || isAdmin);
  const current = TABS.find((t) => t.id === tab);

  const content =
    tab === "general" ? (
      <GeneralTab />
    ) : tab === "personalization" ? (
      <PersonalizationTab />
    ) : tab === "data" ? (
      <DataTab />
    ) : tab === "security" ? (
      <SecurityTab />
    ) : tab === "account" ? (
      <AccountTab />
    ) : tab === "keys" && isAdmin ? (
      <KeysTab />
    ) : tab === "models" && isAdmin ? (
      <ModelsTab />
    ) : tab === "voice" && isAdmin ? (
      <VoiceTab />
    ) : tab === "users" && isAdmin ? (
      <UsersTab />
    ) : tab === "errors" && isAdmin ? (
      <ErrorsTab />
    ) : null;

  return (
    <Modal open={open} onClose={() => set({ settingsTab: null })} hideClose className="h-[min(640px,90dvh)] max-w-[760px]">
      <div className="flex h-full min-h-0 flex-col md:flex-row">
        <nav className="shrink-0 border-b border-line-2 p-2 md:w-52 md:border-b-0 md:border-r">
          <div className="hidden items-center p-1.5 md:flex">
            <button onClick={() => set({ settingsTab: null })} className="rounded-full p-1.5 text-fg-2 hover:bg-hover" aria-label="Close settings">
              <CloseIcon size={18} />
            </button>
          </div>
          <div className="flex gap-1 overflow-x-auto scroll-thin md:flex-col md:overflow-visible">
            {tabs.map((t, i) => (
              <div key={t.id} className="contents">
                {t.admin && !tabs[i - 1]?.admin && <div className="hidden px-2.5 pb-1 pt-4 text-xs text-fg-3 md:block">Admin</div>}
                <button
                  onClick={() => set({ settingsTab: t.id })}
                  className={cn(
                    "flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm",
                    tab === t.id ? "bg-active" : "hover:bg-hover",
                  )}
                >
                  {t.icon}
                  {t.label}
                </button>
              </div>
            ))}
          </div>
        </nav>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-line-2 px-5 py-4">
            <h2 className="text-lg font-semibold">{current?.label}</h2>
            <button onClick={() => set({ settingsTab: null })} className="rounded-full p-1.5 text-fg-2 hover:bg-hover md:hidden" aria-label="Close settings">
              <CloseIcon size={18} />
            </button>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3">{content}</div>
        </div>
      </div>
    </Modal>
  );
}
