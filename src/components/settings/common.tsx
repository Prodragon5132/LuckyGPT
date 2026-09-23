"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/client/utils";

export function Row({
  label,
  description,
  children,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-4 border-b border-line-2 py-3.5 last:border-b-0", className)}>
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {description && <div className="mt-0.5 text-xs leading-5 text-fg-3">{description}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

export function Section({ title, children, description }: { title: ReactNode; children: ReactNode; description?: ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="mb-1 text-base font-semibold">{title}</h3>
      {description && <p className="mb-2 text-xs leading-5 text-fg-3">{description}</p>}
      {children}
    </div>
  );
}
