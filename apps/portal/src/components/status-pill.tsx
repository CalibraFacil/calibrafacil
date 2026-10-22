import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { STATUS_TONE, type SignalTone } from "@calibra-facil/ui/status-tone";

/**
 * The portal's status vocabulary, in the canonical `SignalTone` language. One
 * pill, five tones, used identically on the dashboard, lists, detail heroes and
 * the nav. `TONE` is exported so sibling components (timelines, tiles) speak the
 * exact same color language — the literal Tailwind utilities below match
 * instrument-panel's tonal maps so the metrology look is identical to the app.
 */

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
      className={cn(
        pillVariants({ size }),
        STATUS_TONE[tone].surface,
        className,
      )}
      {...props}
    >
      {dot ? (
        <span className="relative flex size-1.5 shrink-0">
          {pulse ? (
            <span
              className={cn(
                "absolute inline-flex size-full animate-ping rounded-full opacity-60",
                STATUS_TONE[tone].dot,
              )}
            />
          ) : null}
          <span
            className={cn(
              "relative inline-flex size-1.5 rounded-full",
              STATUS_TONE[tone].dot,
            )}
          />
        </span>
      ) : null}
      {children}
    </span>
  );
}
