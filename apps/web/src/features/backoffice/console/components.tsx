/**
 * Backoffice console — shared UI primitives.
 *
 * These build on the instrument-panel language (flat console surfaces, blueprint
 * grid, tonal signals, staggered enters) and are reused across every backoffice
 * surface so there are no one-offs. Status color is always driven by `status.ts`
 * via the `tone` scale — components never hand-pick a status color.
 */
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight02Icon, Search01Icon } from '@hugeicons/core-free-icons'
import type { ComponentProps, ReactNode } from 'react'

import {
  ACTION_BUTTON_CLASS,
  BlueprintOverlay,
  Panel,
  PanelHeader,
  SignalTile,
  type SignalTone,
} from '@/components/instrument-panel'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import type { StatusDescriptor } from './status'

type IconType = Parameters<typeof HugeiconsIcon>[0]['icon']

const TONE_CHIP: Record<SignalTone, string> = {
  ok: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  critical: 'bg-destructive/10 text-destructive',
  warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  info: 'bg-primary/10 text-primary',
  neutral: 'bg-muted text-muted-foreground',
}

const TONE_DOT: Record<SignalTone, string> = {
  ok: 'bg-emerald-500',
  critical: 'bg-destructive',
  warning: 'bg-amber-500',
  info: 'bg-primary',
  neutral: 'bg-muted-foreground/40',
}

const TONE_ICON_SURFACE: Record<SignalTone, string> = {
  ok: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  critical: 'bg-destructive/10 text-destructive',
  warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  info: 'bg-primary/10 text-primary',
  neutral: 'bg-muted/60 text-muted-foreground',
}

/** Strong page hero — a console surface with eyebrow, title, actions, live dot. */
export function ConsolePageHeader({
  eyebrow,
  title,
  description,
  actions,
  live = false,
  liveLabel = 'Operação · atualização automática',
  className,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  live?: boolean
  liveLabel?: string
  className?: string
}) {
  return (
    <Panel className={cn('relative overflow-hidden p-5 sm:p-6', className)}>
      <BlueprintOverlay />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          {live ? (
            <div className="mb-1 flex items-center gap-2">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                {liveLabel}
              </p>
            </div>
          ) : eyebrow ? (
            <p className="mb-1 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-3xl text-pretty text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap gap-2 lg:justify-end">{actions}</div>
        ) : null}
      </div>
    </Panel>
  )
}

/** Titled console surface — Panel + PanelHeader convenience. */
export function SectionPanel({
  eyebrow,
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <Panel className={cn('p-5', className)}>
      <PanelHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        action={action}
      />
      <div className={cn('mt-4', contentClassName)}>{children}</div>
    </Panel>
  )
}

/** Tonal status pill — the only way to render a domain status. */
export function StatusChip({
  status,
  tone,
  icon,
  dot = false,
  children,
  className,
}: {
  status?: StatusDescriptor
  tone?: SignalTone
  icon?: IconType
  dot?: boolean
  children?: ReactNode
  className?: string
}) {
  const resolvedTone: SignalTone = status?.tone ?? tone ?? 'neutral'
  const label = children ?? status?.label

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_CHIP[resolvedTone],
        className,
      )}
    >
      {dot ? <HealthDot tone={resolvedTone} /> : null}
      {icon ? <HugeiconsIcon icon={icon} className="size-3.5" /> : null}
      {label}
    </span>
  )
}

/** Small tonal status dot for dense rows. */
export function HealthDot({
  tone,
  pulse = false,
  className,
}: {
  tone: SignalTone
  pulse?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        TONE_DOT[tone],
        pulse && 'animate-pulse',
        className,
      )}
    />
  )
}

/** SignalTile, optionally wrapped in a navigation link with a press affordance. */
export function MetricStat({
  to,
  search,
  className,
  ...tile
}: ComponentProps<typeof SignalTile> & {
  to?: string
  search?: Record<string, string>
}) {
  if (!to) {
    return <SignalTile className={className} {...tile} />
  }

  return (
    <Link
      to={to}
      search={search}
      className="group block rounded-xl transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]"
    >
      <SignalTile
        className={cn(
          'h-full transition-shadow group-hover:shadow-[inset_0_0_0_1px_rgba(15,23,42,0.16)] dark:group-hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]',
          className,
        )}
        {...tile}
      />
    </Link>
  )
}

/**
 * The canonical list row: tonal leading icon, title, subtitle, trailing meta.
 * Polymorphic via `render` (pass a `<Link>` to make it navigable, including
 * `$id` param routes) following the Button/Badge `useRender` pattern.
 */
export function AttentionRow({
  icon,
  tone = 'neutral',
  title,
  subtitle,
  meta,
  trailing,
  className,
  render,
  ...props
}: Omit<useRender.ComponentProps<'div'>, 'title'> & {
  icon?: IconType
  tone?: SignalTone
  title: ReactNode
  subtitle?: ReactNode
  meta?: ReactNode
  trailing?: ReactNode
}) {
  const interactive = Boolean(render)

  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(
      {
        className: cn(
          'group flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]',
          interactive &&
            'transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          className,
        ),
        children: (
          <>
            {icon ? (
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-lg',
                  TONE_ICON_SURFACE[tone],
                )}
              >
                <HugeiconsIcon icon={icon} className="size-4" />
              </span>
            ) : null}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                {title}
              </span>
              {subtitle ? (
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {subtitle}
                </span>
              ) : null}
            </span>
            {meta ? (
              <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {meta}
              </span>
            ) : null}
            {trailing}
            {interactive ? (
              <HugeiconsIcon
                icon={ArrowRight02Icon}
                className="size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground"
              />
            ) : null}
          </>
        ),
      },
      props,
    ),
  })
}

/** Filter / saved-view chip row with counts and active state. */
export type SegmentedOption<T extends string> = {
  value: T
  label: string
  count?: number
  tone?: SignalTone
}

export function SegmentedFilter<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: ReadonlyArray<SegmentedOption<T>>
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-[background-color,color,box-shadow] active:scale-[0.97]',
              active
                ? 'bg-foreground text-background shadow-sm'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {option.tone && !active ? <HealthDot tone={option.tone} /> : null}
            {option.label}
            {typeof option.count === 'number' ? (
              <span
                className={cn(
                  'font-mono tabular-nums',
                  active ? 'text-background/70' : 'text-muted-foreground/70',
                )}
              >
                {option.count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/** Search input with a leading icon and an optional keyboard hint. */
export function ConsoleSearch({
  value,
  onChange,
  placeholder = 'Buscar…',
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <HugeiconsIcon
        icon={Search01Icon}
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="pl-9"
      />
    </div>
  )
}

/** Right-side preview drawer with a console header. */
export function PreviewSheet({
  open,
  onOpenChange,
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn('w-full gap-0 p-0 sm:max-w-lg', className)}
      >
        <div className="relative overflow-hidden border-b px-5 py-4">
          <BlueprintOverlay />
          <div className="relative pr-8">
            {eyebrow ? (
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                {eyebrow}
              </p>
            ) : null}
            <SheetTitle className="text-balance text-lg font-semibold">
              {title}
            </SheetTitle>
            {description ? (
              <SheetDescription className="mt-0.5 text-sm text-muted-foreground">
                {description}
              </SheetDescription>
            ) : (
              <SheetDescription className="sr-only">
                Detalhes do item selecionado
              </SheetDescription>
            )}
            {actions ? (
              <div className="mt-3 flex flex-wrap gap-2">{actions}</div>
            ) : null}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Consistent empty state — always paired with a constructive next step. */
export function ConsoleEmpty({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: IconType
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex min-h-40 flex-col items-center justify-center rounded-xl bg-muted/30 px-6 py-8 text-center',
        className,
      )}
    >
      <span className="mb-3 flex size-11 items-center justify-center rounded-xl bg-background text-muted-foreground shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
        <HugeiconsIcon icon={icon} className="size-5" />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-pretty text-xs text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

/** Skeleton rows that keep the real layout while loading. */
export function ConsoleLoadingRows({
  count = 4,
  className,
  rowClassName,
}: {
  count?: number
  className?: string
  rowClassName?: string
}) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton
          key={index}
          className={cn('h-14 w-full rounded-xl', rowClassName)}
        />
      ))}
    </div>
  )
}

export { ACTION_BUTTON_CLASS }
