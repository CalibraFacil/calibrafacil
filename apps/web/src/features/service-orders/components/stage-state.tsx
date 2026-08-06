import type { ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { LockIcon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { cn } from '@/lib/utils'

/**
 * A stage that cannot be worked on yet. The tab stays reachable — the four
 * stages are the page's map, so hiding one would hide the workflow — but the
 * body says what unlocks it instead of showing a form the API would refuse.
 */
export function StageLocked({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <Empty className="border-none py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={LockIcon} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent />
    </Empty>
  )
}

/**
 * Header strip for a stage that is now a record. Reads as "this happened",
 * with the revision action (when the stage allows one) on the trailing edge.
 * Deliberately not a disabled form: greyed-out inputs read as broken.
 */
export function StageRecordStrip({
  summary,
  action,
  className,
}: {
  summary: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-3.5',
        className,
      )}
    >
      {/* flex-1 + min-w-0 so a long summary wraps inside its own column and the
          action stays on the trailing edge instead of dropping to a new line. */}
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className="mt-px flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary ring-1 ring-inset ring-primary/25">
          <HugeiconsIcon icon={LockIcon} className="size-3.5" />
        </span>
        <p className="text-pretty text-sm text-muted-foreground">{summary}</p>
      </div>
      {action}
    </div>
  )
}

/** Definition-list row used inside a stage record. */
export function StageRecordField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-pretty text-sm font-medium">{children}</div>
    </div>
  )
}

export function StageRecordGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-4 rounded-lg bg-muted/40 p-4 md:grid-cols-2">
      {children}
    </div>
  )
}

/** Trailing action on a record strip — "Revisar avaliação" and friends. */
export function StageRecordAction({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="shrink-0 transition-transform active:scale-[0.96]"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  )
}
