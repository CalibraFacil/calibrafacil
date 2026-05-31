import type { ReactNode } from 'react'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'

import { cn } from '@/lib/utils'

/**
 * Compact read-only metric. Numbers use tabular-nums so live counters and
 * dates never cause horizontal jitter when they update.
 */
export function MetricTile({
  hint,
  label,
  tone = 'default',
  value,
}: {
  hint?: string
  label: string
  tone?: 'default' | 'positive' | 'warning'
  value: ReactNode
}) {
  return (
    <div className="rounded-lg bg-muted/40 p-3 ring-1 ring-inset ring-border/60 transition-colors hover:bg-muted/60">
      <p className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          'mt-1.5 text-sm font-semibold tabular-nums text-foreground',
          tone === 'positive' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'warning' && 'text-amber-600 dark:text-amber-400',
        )}
      >
        {value}
      </p>
      {hint ? (
        <p
          className="mt-0.5 truncate text-xs text-muted-foreground"
          title={hint}
        >
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function SectionTitle({
  description,
  icon,
  title,
}: {
  description?: string
  icon?: IconSvgElement
  title: string
}) {
  return (
    <div className="flex items-start gap-2.5">
      {icon ? (
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground ring-1 ring-inset ring-border/60">
          <HugeiconsIcon icon={icon} className="size-4" />
        </span>
      ) : null}
      <div className="space-y-0.5">
        <p className="text-sm font-semibold leading-none text-foreground">
          {title}
        </p>
        {description ? (
          <p className="text-xs text-pretty text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function ChecklistRow({
  done,
  help,
  label,
}: {
  done: boolean
  help: string
  label: string
}) {
  return (
    <div className="flex items-start gap-2.5 py-2">
      <span
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full',
          done
            ? 'text-emerald-500'
            : 'border border-dashed border-muted-foreground/40 text-transparent',
        )}
      >
        {done ? (
          <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4" />
        ) : null}
      </span>
      <div className="min-w-0 space-y-0.5">
        <p
          className={cn(
            'text-sm leading-none',
            done ? 'text-foreground' : 'font-medium text-foreground',
          )}
        >
          {label}
        </p>
        <p className="text-xs text-pretty text-muted-foreground">{help}</p>
      </div>
    </div>
  )
}

/** Pulsing presence indicator for connection state. */
export function LiveDot({ active }: { active: boolean }) {
  return (
    <span className="relative flex size-2">
      {active ? (
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
      ) : null}
      <span
        className={cn(
          'relative inline-flex size-2 rounded-full',
          active ? 'bg-emerald-500' : 'bg-muted-foreground/50',
        )}
      />
    </span>
  )
}

export function ContaAzulLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-white px-4 shadow-xs ring-1 ring-black/5',
        className,
      )}
    >
      <img
        src="/integrations/conta-azul.svg"
        alt="Conta Azul"
        className="h-5 w-auto select-none"
        draggable={false}
      />
    </span>
  )
}
