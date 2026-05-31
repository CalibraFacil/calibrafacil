import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import type { SignalTone } from "@/components/instrument-panel";

/**
 * The portal's status vocabulary, in the canonical `SignalTone` language. One
 * pill, five tones, used identically on the dashboard, lists, detail heroes and
 * the nav. `TONE` is exported so sibling components (timelines, tiles) speak the
 * exact same color language — the literal Tailwind utilities below match
 * instrument-panel's tonal maps so the metrology look is identical to the app.
 */

export const TONE: Record<
  SignalTone,
  { surface: string; text: string; dot: string; soft: string }
> = {
  ok: {
    surface: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    text: "text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-600 dark:bg-emerald-500",
    soft: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  critical: {
    surface: "bg-destructive/10 text-destructive",
    text: "text-destructive",
    dot: "bg-destructive",
    soft: "bg-destructive/10 text-destructive",
  },
  warning: {
    surface: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    text: "text-amber-700 dark:text-amber-400",
    dot: "bg-amber-600 dark:bg-amber-500",
    soft: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  info: {
    surface: "bg-primary/10 text-primary",
    text: "text-primary",
    dot: "bg-primary",
    soft: "bg-primary/10 text-primary",
  },
  neutral: {
    surface: "bg-muted text-muted-foreground",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground",
    soft: "bg-muted text-muted-foreground",
  },
};

const pillVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full font-medium whitespace-nowrap",
  {
    variants: {
      size: {
        sm: "h-5 px-2 text-[11px]",
        md: "h-6 px-2.5 text-xs",
      },
    },
    defaultVariants: { size: "md" },
  },
);

type StatusPillProps = React.ComponentProps<"span"> &
  VariantProps<typeof pillVariants> & {
    tone: SignalTone;
    /** Render the leading status dot. Defaults to true. */
    dot?: boolean;
    /** Pulse the dot to draw the eye (use for overdue / needs-action only). */
    pulse?: boolean;
  };

export function StatusPill({
  tone,
  size,
  dot = true,
  pulse = false,
  className,
  children,
  ...props
}: StatusPillProps) {
  return (
    <span
      data-slot="status-pill"
      className={cn(pillVariants({ size }), TONE[tone].surface, className)}
      {...props}
    >
      {dot ? (
        <span className="relative flex size-1.5 shrink-0">
          {pulse ? (
            <span
              className={cn(
                "absolute inline-flex size-full animate-ping rounded-full opacity-60",
                TONE[tone].dot,
              )}
            />
          ) : null}
          <span
            className={cn(
              "relative inline-flex size-1.5 rounded-full",
              TONE[tone].dot,
            )}
          />
        </span>
      ) : null}
      {children}
    </span>
  );
}
