/**
 * Instrument-panel primitives — the shared visual language for the metrology
 * console: certificate review/quality-record screens and the asset registry.
 *
 * The aesthetic is a flat "metrology console": layered shadows instead of hard
 * borders, a subtle blueprint grid, mono tabular numerics for measured values,
 * and tonal signal tiles that read like instrument indicators. Enter animations
 * are split into semantic chunks and staggered.
 */
import { motion, type Variants } from 'motion/react'
import type { ComponentProps, ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { InformationCircleIcon } from '@hugeicons/core-free-icons'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type IconType = Parameters<typeof HugeiconsIcon>[0]['icon']

/** Flat console surface — concentric-radius safe (rounded-2xl outer). */
export const PANEL_CLASS =
  'min-w-0 rounded-2xl bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10'

/** Tactile press + property-specific transition (never `transition: all`). */
export const ACTION_BUTTON_CLASS =
  'min-h-10 active:scale-[0.96] transition-[background-color,color,box-shadow,border-color,transform]'

/** Technical blueprint grid, fading toward the lower-right. */
const BLUEPRINT_GRID_CLASS =
  '[background-image:linear-gradient(to_right,rgba(15,23,42,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.05)_1px,transparent_1px)] [background-size:24px_24px] [mask-image:radial-gradient(130%_130%_at_0%_0%,black,transparent_72%)] dark:[background-image:linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.06)_1px,transparent_1px)]'

export function BlueprintOverlay({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0',
        BLUEPRINT_GRID_CLASS,
        className,
      )}
    />
  )
}

export function Panel({
  className,
  children,
  ...props
}: ComponentProps<'section'>) {
  return (
    <section className={cn(PANEL_CLASS, className)} {...props}>
      {children}
    </section>
  )
}

export function PanelHeader({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="text-balance text-base font-semibold sm:text-lg">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-pretty text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {action}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Small info affordance — an "ⓘ" that reveals a regulatory/explanatory note on
 * hover or focus. Use it to attach the exact ISO/IEC 17025 clause or GUM concept
 * to a label instead of crowding the UI with prose.
 */
export function InfoHint({
  children,
  label = 'Mais informações',
  side = 'top',
  className,
}: {
  children: ReactNode
  label?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className={cn(
              "relative inline-flex size-5 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 before:absolute before:-inset-2.5 before:content-['']",
              className,
            )}
          />
        }
      >
        <HugeiconsIcon icon={InformationCircleIcon} className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-xs leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

export type SignalTone = 'ok' | 'critical' | 'warning' | 'info' | 'neutral'

const TONE_SURFACE: Record<SignalTone, string> = {
  ok: 'bg-emerald-500/10',
  critical: 'bg-destructive/10',
  warning: 'bg-amber-500/10',
  info: 'bg-primary/10',
  neutral: 'bg-muted/45',
}

const TONE_VALUE: Record<SignalTone, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  critical: 'text-destructive',
  warning: 'text-amber-700 dark:text-amber-400',
  info: 'text-primary',
  neutral: 'text-foreground',
}

const TONE_ICON: Record<SignalTone, string> = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  critical: 'text-destructive',
  warning: 'text-amber-600 dark:text-amber-400',
  info: 'text-primary',
  neutral: 'text-muted-foreground',
}

export function SignalTile({
  icon,
  label,
  value,
  hint,
  tone = 'neutral',
  className,
}: {
  icon?: IconType
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  tone?: SignalTone
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-xl p-3.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]',
        TONE_SURFACE[tone],
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
        {icon ? (
          <HugeiconsIcon
            icon={icon}
            className={cn('size-4', TONE_ICON[tone])}
          />
        ) : null}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span
          className={cn(
            'font-mono text-2xl font-semibold leading-none tabular-nums',
            TONE_VALUE[tone],
          )}
        >
          {value}
        </span>
        {hint ? (
          <span className="text-xs text-muted-foreground">{hint}</span>
        ) : null}
      </div>
    </div>
  )
}

/** A single cell inside a hairline-separated blueprint info grid. */
export function BlueprintField({
  label,
  children,
  mono = false,
  className,
}: {
  label: ReactNode
  children: ReactNode
  mono?: boolean
  className?: string
}) {
  return (
    <div className={cn('bg-background p-3', className)}>
      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <div className={cn('mt-1 text-sm', mono && 'font-mono tabular-nums')}>
        {children}
      </div>
    </div>
  )
}

export function BlueprintGrid({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'grid gap-px overflow-hidden rounded-xl bg-foreground/10',
        className,
      )}
    >
      {children}
    </div>
  )
}

// — Enter animation: split + stagger, subtle, spring with bounce 0 —

const GROUP_VARIANTS: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.03 } },
}

const ITEM_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', duration: 0.3, bounce: 0 },
  },
}

export function StaggerGroup({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <motion.div
      variants={GROUP_VARIANTS}
      initial="hidden"
      animate="show"
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <motion.div variants={ITEM_VARIANTS} className={cn('min-w-0', className)}>
      {children}
    </motion.div>
  )
}
