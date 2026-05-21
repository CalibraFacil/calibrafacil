import { type ReactNode } from 'react'

import { cn } from '@/lib/utils'

function ClientPanel({
  eyebrow,
  title,
  description,
  icon,
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
    <section className={cn('space-y-6', className)}>
      <div className="px-1">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            {icon && (
              <span
                aria-hidden="true"
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15"
              >
                {icon}
              </span>
            )}
            <div className="min-w-0">
              {eyebrow && (
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {eyebrow}
                </p>
              )}
              <h2 className="text-xl font-semibold tracking-tight text-balance">
                {title}
              </h2>
              {description && (
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground text-pretty">
                  {description}
                </p>
              )}
            </div>
          </div>
          {action}
        </div>
      </div>
      {children}
    </section>
  )
}

function ClientPanelBody({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cn('px-1', className)}>{children}</div>
}

function ClientMetricStrip({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'grid divide-y divide-border/70 border-y border-border/70 bg-background/50 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4',
        className,
      )}
    >
      {children}
    </div>
  )
}

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
  return (
    <div className="min-w-0 px-4 py-4 sm:px-5">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon && (
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground ring-1 ring-foreground/10"
          >
            {icon}
          </span>
        )}
        <span className="truncate">{label}</span>
      </div>
      <div
        className={cn(
          'mt-3 truncate text-lg font-semibold tabular-nums',
          tone === 'danger' && 'text-destructive',
        )}
      >
        {value}
      </div>
    </div>
  )
}

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
      className={cn('grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]', className)}
    >
      <div className="flex gap-3">
        {icon && (
          <span
            aria-hidden="true"
            className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground ring-1 ring-foreground/10"
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-balance">{title}</h3>
          {description && (
            <p className="mt-1 text-sm leading-6 text-muted-foreground text-pretty">
              {description}
            </p>
          )}
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

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
        'overflow-hidden rounded-xl bg-background ring-1 ring-foreground/10',
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
    <div className={cn('mb-6 flex flex-col gap-3 sm:flex-row', className)}>
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
