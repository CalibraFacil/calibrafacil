import { HugeiconsIcon } from "@hugeicons/react";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

import { cn } from "@/lib/utils";
import { TONE } from "@/components/status-pill";
import type { SignalTone } from "@/components/instrument-panel";

export type TimelineItemState = "done" | "current" | "upcoming";

export type TimelineItem = {
  title: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  state?: TimelineItemState;
  tone?: SignalTone;
  icon?: IconSvgElement;
};

/**
 * A vertical lifecycle rail for requests, service orders and equipment history.
 * `done` steps get a filled tone dot (a check by default), `current` pulses,
 * `upcoming` is a hollow placeholder.
 */
export function Timeline({
  items,
  className,
}: {
  items: Array<TimelineItem>;
  className?: string;
}) {
  return (
    <ol className={cn("relative", className)}>
      {items.map((item, index) => {
        const state = item.state ?? "done";
        const tone = item.tone ?? (state === "upcoming" ? "neutral" : "info");
        const isLast = index === items.length - 1;

        return (
          <li key={index} className="relative flex gap-3 pb-5 last:pb-0">
            {!isLast ? (
              <span
                aria-hidden
                className="bg-border absolute top-7 bottom-1 left-[11px] w-px"
              />
            ) : null}
            <span
              className={cn(
                "relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
                state === "upcoming"
                  ? "border-border text-muted-foreground/50 border border-dashed bg-card"
                  : TONE[tone].soft,
              )}
            >
              {state === "current" ? (
                <span className="relative flex size-2">
                  <span
                    className={cn(
                      "absolute inline-flex size-full animate-ping rounded-full opacity-60",
                      TONE[tone].dot,
                    )}
                  />
                  <span
                    className={cn(
                      "relative inline-flex size-2 rounded-full",
                      TONE[tone].dot,
                    )}
                  />
                </span>
              ) : state === "done" ? (
                <HugeiconsIcon
                  icon={item.icon ?? Tick02Icon}
                  className="size-3.5"
                  strokeWidth={2.5}
                />
              ) : (
                <span className="bg-muted-foreground/40 size-1.5 rounded-full" />
              )}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <p
                  className={cn(
                    "text-sm font-medium",
                    state === "upcoming" && "text-muted-foreground",
                  )}
                >
                  {item.title}
                </p>
                {item.meta ? (
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {item.meta}
                  </span>
                ) : null}
              </div>
              {item.description ? (
                <p className="text-muted-foreground mt-0.5 text-sm text-pretty">
                  {item.description}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
