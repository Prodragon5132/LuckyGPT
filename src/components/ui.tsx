"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { create } from "zustand";
import { cn } from "@/lib/client/utils";
import { CheckIcon, ChevronRight, CloseIcon } from "./icons";
import { useApp } from "@/lib/client/store";

// ---------------- Portal ----------------

const noopSubscribe = () => () => {};

export function Portal({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return mounted ? createPortal(children, document.body) : null;
}

/** Callback ref kept in state, so popovers can anchor to it during render. */
export function useAnchor<T extends HTMLElement = HTMLElement>() {
  return useState<T | null>(null);
}

// ---------------- Popover / Menu ----------------

type Placement = "bottom-start" | "bottom-end" | "top-start" | "top-end" | "right-start" | "left-start";

export function Popover({
  anchor,
  open,
  onClose,
  placement = "bottom-start",
  children,
  className,
  offset = 6,
}: {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  placement?: Placement;
  children: ReactNode;
  className?: string;
  offset?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const m = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = 0;
    let left = 0;
    if (placement.startsWith("bottom")) {
      top = a.bottom + offset;
      if (top + m.height > vh - 8 && a.top - offset - m.height > 8) top = a.top - offset - m.height;
    } else if (placement.startsWith("top")) {
      top = a.top - offset - m.height;
      if (top < 8) top = a.bottom + offset;
    } else {
      top = a.top;
    }
    if (placement === "bottom-start" || placement === "top-start") left = a.left;
    else if (placement === "bottom-end" || placement === "top-end") left = a.right - m.width;
    else if (placement === "right-start") {
      left = a.right + offset;
      if (left + m.width > vw - 8) left = a.left - offset - m.width;
    } else {
      left = a.left - offset - m.width;
      if (left < 8) left = a.right + offset;
    }
    left = Math.max(8, Math.min(left, vw - m.width - 8));
    top = Math.max(8, Math.min(top, vh - m.height - 8));
    setPos({ top, left });
  }, [anchor, placement, offset]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      // Clicks inside nested popovers (submenus) shouldn't close the parent.
      if ((t as HTMLElement).closest?.("[data-popover]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onResize = () => place();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open, onClose, anchor, place]);

  if (!open) return null;
  return (
    <Portal>
      <div
        ref={ref}
        data-popover
        className={cn(
          "fixed z-[60] min-w-[200px] rounded-2xl border border-line-2 bg-elevated p-1.5 text-sm shadow-[0_8px_28px_rgba(0,0,0,0.14)] dark:shadow-[0_8px_28px_rgba(0,0,0,0.5)]",
          pos ? "pop-in" : "opacity-0",
          className,
        )}
        style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      >
        {children}
      </div>
    </Portal>
  );
}

export function MenuItem({
  icon,
  label,
  onClick,
  danger,
  right,
  disabled,
  checked,
  description,
}: {
  icon?: ReactNode;
  label: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  right?: ReactNode;
  disabled?: boolean;
  checked?: boolean;
  description?: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
        disabled ? "opacity-40" : "hover:bg-hover",
        danger ? "text-danger" : "text-fg",
      )}
    >
      {icon && <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {description && <span className="block text-xs text-fg-3">{description}</span>}
      </span>
      {checked && <CheckIcon size={18} className="shrink-0" />}
      {right}
    </button>
  );
}

export function SubMenu({
  icon,
  label,
  children,
}: {
  icon?: ReactNode;
  label: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useAnchor<HTMLDivElement>();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = () => {
    timer.current = setTimeout(() => setOpen(false), 180);
  };
  return (
    <div ref={setAnchor} onMouseEnter={show} onMouseLeave={hide}>
      <MenuItem icon={icon} label={label} onClick={() => setOpen((o) => !o)} right={<ChevronRight size={16} className="text-fg-3" />} />
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} placement="right-start" offset={4}>
        <div onMouseEnter={show} onMouseLeave={hide} className="max-h-[60vh] overflow-y-auto scroll-thin">
          {children}
        </div>
      </Popover>
    </div>
  );
}

export function MenuSeparator() {
  return <div className="mx-2 my-1 h-px bg-line-2" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 pb-1 pt-2 text-xs text-fg-3">{children}</div>;
}

// ---------------- Modal ----------------

export function Modal({
  open,
  onClose,
  title,
  children,
  className,
  hideClose,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  hideClose?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-3 fade-in" onMouseDown={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          className={cn(
            "pop-in flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-2xl bg-elevated text-fg shadow-2xl dark:bg-[#2f2f2f]",
            !className?.includes("max-w-") && "max-w-lg",
            className,
          )}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(title || !hideClose) && (
            <div className="flex items-center justify-between gap-4 border-b border-line-2 px-5 py-4">
              <h2 className="text-lg font-semibold">{title}</h2>
              {!hideClose && (
                <button onClick={onClose} className="rounded-full p-1.5 text-fg-2 hover:bg-hover" aria-label="Close">
                  <CloseIcon size={20} />
                </button>
              )}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">{children}</div>
        </div>
      </div>
    </Portal>
  );
}

// ---------------- Controls ----------------

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-toggle" : "bg-black/15 dark:bg-white/20",
        disabled && "opacity-50",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform dark:shadow-none",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
          checked && "dark:bg-[#0d0d0d]",
        )}
      />
    </button>
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
  type = "button",
  className,
  size = "md",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-4 text-sm",
        variant === "primary" && "bg-accent text-accent-fg hover:opacity-85",
        variant === "secondary" && "border border-line bg-transparent text-fg hover:bg-hover",
        variant === "danger" && "bg-danger text-white hover:opacity-90",
        variant === "ghost" && "text-fg hover:bg-hover",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Tooltip({ label, children, side = "bottom" }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom" | "right" }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <span
      ref={ref}
      className="inline-flex"
      onMouseEnter={() => {
        if (window.matchMedia("(pointer: coarse)").matches) return;
        timer.current = setTimeout(() => setRect(ref.current?.getBoundingClientRect() ?? null), 350);
      }}
      onMouseLeave={() => {
        if (timer.current) clearTimeout(timer.current);
        setRect(null);
      }}
      onMouseDown={() => {
        if (timer.current) clearTimeout(timer.current);
        setRect(null);
      }}
    >
      {children}
      {rect && (
        <Portal>
          <span
            className="pointer-events-none fixed z-[70] whitespace-nowrap rounded-lg bg-black px-2 py-1 text-xs font-medium text-white shadow-lg fade-in dark:bg-white dark:text-black"
            style={
              side === "right"
                ? { top: rect.top + rect.height / 2, left: rect.right + 8, transform: "translateY(-50%)" }
                : side === "top"
                  ? { top: rect.top - 8, left: rect.left + rect.width / 2, transform: "translate(-50%, -100%)" }
                  : { top: rect.bottom + 8, left: rect.left + rect.width / 2, transform: "translateX(-50%)" }
            }
          >
            {label}
          </span>
        </Portal>
      )}
    </span>
  );
}

export function IconButton({
  label,
  onClick,
  children,
  className,
  active,
  disabled,
  tooltipSide,
}: {
  label: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  className?: string;
  active?: boolean;
  disabled?: boolean;
  tooltipSide?: "top" | "bottom" | "right";
}) {
  return (
    <Tooltip label={label} side={tooltipSide}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg text-fg-2 transition-colors hover:bg-hover hover:text-fg disabled:opacity-40",
          active && "text-fg",
          className,
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

// ---------------- Confirm / prompt dialogs ----------------

interface DialogState {
  kind: "confirm" | "prompt" | null;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  value: string;
  placeholder?: string;
  resolve?: (v: string | boolean | null) => void;
}

const useDialog = create<DialogState>(() => ({ kind: null, title: "", confirmLabel: "OK", value: "" }));

export function confirmDialog(opts: { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) =>
    useDialog.setState({
      kind: "confirm",
      title: opts.title,
      body: opts.body,
      confirmLabel: opts.confirmLabel ?? "Confirm",
      danger: opts.danger,
      value: "",
      resolve: (v) => resolve(v === true),
    }),
  );
}

export function promptDialog(opts: { title: string; value?: string; placeholder?: string; confirmLabel?: string }): Promise<string | null> {
  return new Promise((resolve) =>
    useDialog.setState({
      kind: "prompt",
      title: opts.title,
      body: undefined,
      confirmLabel: opts.confirmLabel ?? "Save",
      danger: false,
      value: opts.value ?? "",
      placeholder: opts.placeholder,
      resolve: (v) => resolve(typeof v === "string" ? v : null),
    }),
  );
}

export function DialogHost() {
  const d = useDialog();
  const close = (v: string | boolean | null) => {
    d.resolve?.(v);
    useDialog.setState({ kind: null, resolve: undefined });
  };
  if (!d.kind) return null;
  return (
    <Modal open onClose={() => close(null)} title={d.title} hideClose className="max-w-md">
      <form
        className="px-5 pb-5 pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          close(d.kind === "prompt" ? d.value.trim() || null : true);
        }}
      >
        {d.body && <div className="mb-5 text-sm text-fg-2">{d.body}</div>}
        {d.kind === "prompt" && (
          <input
            autoFocus
            value={d.value}
            placeholder={d.placeholder}
            onChange={(e) => useDialog.setState({ value: e.target.value })}
            className="mb-5 w-full rounded-xl border border-line bg-transparent px-3 py-2.5 text-sm outline-none focus:border-fg-3"
            maxLength={300}
          />
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={() => close(null)}>Cancel</Button>
          <Button type="submit" variant={d.danger ? "danger" : "primary"}>
            {d.confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------- Toasts ----------------

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <Portal>
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[80] flex flex-col items-center gap-2 px-3">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex max-w-md items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-lg fade-in",
              t.kind === "error" ? "bg-danger text-white" : "bg-[#0d0d0d] text-white dark:bg-white dark:text-[#0d0d0d]",
            )}
          >
            <span className="flex-1">{t.text}</span>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
              <CloseIcon size={16} />
            </button>
          </div>
        ))}
      </div>
    </Portal>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-fg-3">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-line bg-transparent px-3 py-2.5 text-sm text-fg outline-none transition-colors focus:border-fg-3";

export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={cn(
        "max-w-full cursor-pointer rounded-lg border border-transparent bg-transparent py-1.5 pl-2 pr-7 text-sm text-fg outline-none hover:bg-hover",
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-elevated text-fg">
          {o.label}
        </option>
      ))}
    </select>
  );
}
