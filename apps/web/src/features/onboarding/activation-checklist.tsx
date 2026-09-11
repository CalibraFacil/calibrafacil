import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight02Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  LockIcon,
} from '@hugeicons/core-free-icons'

import { Panel, StaggerGroup, StaggerItem } from '@/components/instrument-panel'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

import { useActivationChecklist } from './queries'
import { buildActivationChecklistView, type ActivationStepView } from './steps'

/**
 * What is left before this laboratory can issue its first certificate.
 *
 * Lives at the top of the dashboard rather than gating it. A lab must be able
 * to explore, and a technical manager who already knows what a padrão de
 * referência is should be able to ignore this entirely and go straight to the
 * module. Nothing here blocks a route.
 *
 * The open steps carry the weight — a card each, with the destination and a
 * one-line reason — and the finished ones fall back to a quiet ledger below a
 * rule. A laboratory five steps in should read the one thing it still owes,
 * not five sentences about work it already did.
 *
 * It disappears on its own once the first certificate is issued. Until then it
 * can be dismissed per user, because one person collapsing it should not hide
 * it from a colleague who is still working through the same list.
 */

function dismissalKey(organizationId: string) {
  return `calibra:onboarding-dismissed:${organizationId}`
}

function readDismissed(organizationId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(dismissalKey(organizationId)) === 'true'
  } catch {
    // Private mode or a blocked store: showing the checklist is the safe side.
    return false
  }
}

export function ActivationChecklist({
  organizationId,
}: {
  organizationId: string
}) {
  // Read once at mount through the initialiser rather than an effect.
  const [dismissed, setDismissed] = useState(() =>
    readDismissed(organizationId),
  )
  const { data, isPending } = useActivationChecklist({ enabled: !dismissed })

  if (dismissed || isPending || !data) return null

  const view = buildActivationChecklistView(data)
  if (view.complete) return null

  function dismiss() {
    setDismissed(true)
    try {
      window.localStorage.setItem(dismissalKey(organizationId), 'true')
    } catch {
      // Losing the preference only means it shows again. Not worth reporting.
    }
  }

  const remainingCount = view.totalCount - view.completedCount

  return (
    // Arrives after its own query resolves, so it enters with the same spring
    // the rest of the dashboard uses instead of appearing in one frame.
    <StaggerGroup>
      <StaggerItem>
        <Panel className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-balance text-base font-semibold sm:text-lg">
                O que falta para emitir a primeira calibração
              </h2>
              <p className="mt-1 text-pretty text-sm text-muted-foreground">
                Cada item abre a tela onde ele é resolvido, na ordem que
                preferir.
              </p>
            </div>
            {/* A phone has no room for a word here without pushing the title
                into a ragged wrap, so it collapses to the close affordance and
                keeps its label everywhere there is space. Negative margins pull
                the ghost padding out to the panel edge for optical alignment. */}
            <Button
              variant="ghost"
              size="sm"
              onClick={dismiss}
              aria-label="Ocultar"
              className="-mr-2 -mt-1.5 size-8 shrink-0 p-0 text-muted-foreground sm:size-auto sm:px-2.5"
            >
              <HugeiconsIcon icon={Cancel01Icon} className="size-4 sm:hidden" />
              <span className="sr-only sm:not-sr-only">Ocultar</span>
            </Button>
          </div>

          {/* Capped on wide screens: a hairline stretched across 1100px puts
              the count an inch away from the bar it belongs to. */}
          <div className="mt-4 flex max-w-sm items-center gap-3">
            <Progress
              value={(view.completedCount / view.totalCount) * 100}
              aria-label={`${view.completedCount} de ${view.totalCount} etapas concluídas`}
              className="h-1.5"
            />
            <p className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {view.completedCount} de {view.totalCount}
            </p>
          </div>

          <ul
            aria-label={`${remainingCount} ${remainingCount === 1 ? 'etapa pendente' : 'etapas pendentes'}`}
            className={cn(
              'mt-4 grid gap-2',
              // A laboratory on day one has all six open; stacking those full
              // width leaves a column of near-empty rows on a desktop. Two or
              // fewer read better as full-width rows.
              view.remaining.length > 2 && 'sm:grid-cols-2',
            )}
          >
            {view.remaining.map((step) => (
              <OpenStep key={step.id} step={step} />
            ))}
          </ul>

          {view.completed.length > 0 ? (
            <div className="mt-5 border-t border-foreground/10 pt-4">
              <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Concluídos
              </h3>
              <ul className="mt-2.5 grid gap-1.5 sm:flex sm:flex-wrap sm:gap-x-6">
                {view.completed.map((step) => (
                  <DoneStep key={step.id} step={step} />
                ))}
              </ul>
            </div>
          ) : null}
        </Panel>
      </StaggerItem>
    </StaggerGroup>
  )
}

/** Inset surface shared by the open steps, tactile only when it is a link. */
const OPEN_STEP_CLASS =
  'flex h-full min-h-11 items-start gap-3 rounded-xl px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]'

function OpenStep({ step }: { step: ActivationStepView }) {
  const marker = (
    <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
      {step.locked ? (
        <HugeiconsIcon
          icon={LockIcon}
          className="size-4 text-muted-foreground/70"
        />
      ) : (
        <span
          aria-hidden="true"
          className="size-3.5 rounded-full border-[1.5px] border-muted-foreground/50"
        />
      )}
    </span>
  )

  const body = (
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-medium leading-snug">
        {step.label}
      </span>
      <span
        className={cn(
          'mt-1 block text-xs leading-relaxed',
          step.locked ? 'text-muted-foreground/80' : 'text-muted-foreground',
        )}
      >
        {step.locked ? `Antes disso: ${step.blockedBy.join(', ')}.` : step.help}
      </span>
    </span>
  )

  // A blocked step is not a failure and is not a dead link: it states what
  // comes first and sits back until that is done.
  if (step.locked) {
    return (
      <li className={cn(OPEN_STEP_CLASS, 'bg-muted/25')}>
        {marker}
        {body}
      </li>
    )
  }

  return (
    <li>
      <Link
        to={step.to}
        search={{ onboarding: step.id }}
        className={cn(
          OPEN_STEP_CLASS,
          'group bg-muted/45 transition-[background-color,box-shadow] outline-none',
          // The hairline darkens with the fill: on a light theme the muted
          // surface alone barely changes, and the row has to answer a hover.
          'hover:bg-muted hover:shadow-[inset_0_0_0_1px_rgba(15,23,42,0.16)] dark:hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]',
          'focus-visible:ring-[3px] focus-visible:ring-ring/50',
        )}
      >
        {marker}
        {body}
        {/* Always drawn, never hover-only: on a phone there is no hover, and
            this is the one affordance that says the row opens a screen. */}
        <HugeiconsIcon
          icon={ArrowRight02Icon}
          className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        />
      </Link>
    </li>
  )
}

function DoneStep({ step }: { step: ActivationStepView }) {
  return (
    <li className="flex items-start gap-2.5">
      <HugeiconsIcon
        icon={CheckmarkCircle02Icon}
        aria-hidden="true"
        className="mt-px size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
      />
      <span className="min-w-0 text-sm leading-snug text-muted-foreground">
        {step.label}
      </span>
    </li>
  )
}
