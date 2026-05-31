import { type ReactNode } from 'react'

import {
  Panel,
  PanelHeader,
  StaggerGroup,
  StaggerItem,
} from '@/components/instrument-panel'
import { cn } from '@/lib/utils'

/**
 * Shared building blocks for the client detail tabs, in the metrology-console
 * aesthetic (flat panels, inset signal tiles, mono numerics) — see
 * `@/components/instrument-panel`. The exported API is intentionally stable so
 * the individual tab pages don't need to change when the skin evolves.
 */

/** A titled console card. `icon` is accepted for back-compat but not rendered. */
function ClientPanel({
  eyebrow,
  title,
  description,
  action,
  children,
  className,
}: {
  eyebrow?: string
  title: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Panel className={cn('p-4 sm:p-5', className)}>
      <PanelHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        action={action}
      />
      <div className="mt-5 space-y-6">{children}</div>
    </Panel>
  )
}

function ClientPanelBody({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={className}>{children}</div>
}

function ClientMetricStrip({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <StaggerGroup
      className={cn(
        'grid gap-3 grid-cols-[repeat(auto-fit,minmax(170px,1fr))]',
        className,
      )}
    >
      {children}
    </StaggerGroup>
  )
}

const METRIC_TONE: Record<
  'default' | 'danger',
  { surface: string; value: string; icon: string }
> = {
  default: {
    surface: 'bg-muted/45',
    value: 'text-foreground',
    icon: 'text-muted-foreground',
  },
  danger: {
    surface: 'bg-destructive/10',
    value: 'text-destructive',
    icon: 'text-destructive',
  },
}

/** Inset signal tile mirroring `SignalTile`, but accepting a rendered icon node. */
function ClientMetric({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon?: ReactNode
  label: string
  value: string
  tone?: 'default' | 'danger'
}) {
  const palette = METRIC_TONE[tone]
  return (
    <StaggerItem>
      <div
        className={cn(
          'rounded-xl p-3.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]',
          palette.surface,
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </span>
          {icon && (
            <span className={cn('shrink-0', palette.icon)} aria-hidden="true">
              {icon}
            </span>
          )}
        </div>
        <div
          className={cn(
            'mt-2 truncate font-mono text-2xl font-semibold leading-none tabular-nums',
            palette.value,
          )}
        >
          {value}
        </div>
      </div>
    </StaggerItem>
  )
}

/** A labelled sub-section: description rail on the left, content on the right. */
function ClientSection({
  icon,
  title,
  description,
  children,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn('grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]', className)}
    >
      <div className="flex gap-3">
        {icon && (
          <span
            aria-hidden="true"
            className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]"
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-balance">{title}</h3>
          {description && (
            <p className="mt-1 text-pretty text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

/** Inset frame for tables/lists nested inside a console panel. */
function TableFrame({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl bg-background shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]',
        className,
      )}
    >
      {children}
    </div>
  )
}

function Toolbar({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-4 flex flex-col gap-3 sm:flex-row', className)}>
      {children}
    </div>
  )
}

export {
  ClientMetric,
  ClientMetricStrip,
  ClientPanel,
  ClientPanelBody,
  ClientSection,
  TableFrame,
  Toolbar,
}
