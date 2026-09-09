import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/* Shared surfaces for the landing: a white card with a visual area on top
   and a short text block underneath, plus the small status chip and avatar
   the product visuals reuse. */

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-20px_rgba(15,23,42,0.18)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardVisual({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative h-[280px] overflow-hidden border-b border-border bg-[linear-gradient(180deg,var(--muted)_0%,var(--background)_100%)]",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_100%,color-mix(in_oklch,var(--primary)_7%,transparent),transparent_70%)]"
      />
      {children}
    </div>
  );
}

export function CardText({
  title,
  body,
  className,
}: {
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <div className={cn("px-6 pt-5 pb-6", className)}>
      <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-foreground">
        {title}
      </h3>
      <p className="mt-1.5 text-[15px] leading-relaxed text-pretty text-muted-foreground">
        {body}
      </p>
    </div>
  );
}

/** Floating product panel used inside a CardVisual. */
export const panel =
  "rounded-xl border border-border bg-card shadow-[0_2px_6px_rgba(15,23,42,0.04),0_24px_40px_-24px_rgba(15,23,42,0.25)]";

export type ChipTone = "ok" | "info" | "warn" | "bad" | "neutral";

const chipTones: Record<ChipTone, { pill: string; dot: string }> = {
  ok: {
    pill: "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 ring-emerald-600/15 dark:ring-emerald-400/20",
    dot: "bg-emerald-500",
  },
  info: {
    pill: "bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 ring-indigo-600/15 dark:ring-indigo-400/20",
    dot: "bg-indigo-500",
  },
  warn: {
    pill: "bg-amber-50 dark:bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-amber-600/15 dark:ring-amber-400/20",
    dot: "bg-amber-500",
  },
  bad: {
    pill: "bg-red-50 dark:bg-red-500/12 text-red-700 dark:text-red-300 ring-red-600/15 dark:ring-red-400/20",
    dot: "bg-red-500",
  },
  neutral: {
    pill: "bg-zinc-100 dark:bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 ring-zinc-600/10 dark:ring-zinc-400/20",
    dot: "bg-zinc-400",
  },
};

export function Chip({
  tone,
  children,
  className,
}: {
  tone: ChipTone;
  children: ReactNode;
  className?: string;
}) {
  const styles = chipTones[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap ring-1 ring-inset",
        styles.pill,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", styles.dot)} />
      {children}
    </span>
  );
}

export function Avatar({ initials }: { initials: string }) {
  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#4f46e5,#1447e6)] text-[10px] font-semibold text-white"
    >
      {initials}
    </span>
  );
}

export function SectionHeading({
  title,
  body,
  center = false,
}: {
  title: string;
  /** Optional: a heading whose section already explains itself does not need one. */
  body?: string;
  center?: boolean;
}) {
  return (
    <div className={cn("max-w-[640px]", center && "mx-auto text-center")}>
      <h2 className="text-[clamp(30px,3.6vw,44px)] leading-[1.08] font-semibold tracking-[-0.028em] text-balance text-foreground">
        {title}
      </h2>
      {body ? (
        <p
          className={cn(
            "mt-4 max-w-[56ch] text-[17px] leading-relaxed text-pretty text-muted-foreground",
            center && "mx-auto",
          )}
        >
          {body}
        </p>
      ) : null}
    </div>
  );
}
