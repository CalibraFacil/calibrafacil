import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight02Icon,
  CheckmarkCircle02Icon,
  LockIcon,
} from '@hugeicons/core-free-icons'

import { Panel, PanelHeader } from '@/components/instrument-panel'
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

  return (
    <Panel>
      <PanelHeader
        eyebrow="Configuração inicial"
        title="O que falta para emitir a primeira calibração"
        description="Cada item abre a tela onde ele é resolvido. Você pode fazer na ordem que preferir."
        action={
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Ocultar
          </Button>
        }
      />

      <div className="mt-4 flex items-center gap-3">
        <Progress
          value={(view.completedCount / view.totalCount) * 100}
          className="h-1.5"
        />
        <p className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {view.completedCount} de {view.totalCount}
        </p>
      </div>

      <ul className="mt-4 grid gap-1.5">
        {view.steps.map((step) => (
          <ChecklistRow key={step.id} step={step} />
        ))}
      </ul>
    </Panel>
  )
}

function ChecklistRow({ step }: { step: ActivationStepView }) {
  const content = (
    <>
      <span
        className={cn(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
          step.done
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-muted-foreground/50',
        )}
      >
        {step.done ? (
          <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-5" />
        ) : step.locked ? (
          <HugeiconsIcon icon={LockIcon} className="size-4" />
        ) : (
          <span className="size-2.5 rounded-full ring-1 ring-current" />
        )}
      </span>

      <span className="min-w-0">
        <span
          className={cn(
            'block text-sm font-medium',
            step.done && 'text-muted-foreground line-through',
          )}
        >
          {step.label}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
          {step.locked
            ? `Antes disso: ${step.blockedBy.join(', ')}.`
            : step.help}
        </span>
      </span>
    </>
  )

  if (step.done || step.locked) {
    return (
      <li className="grid grid-cols-[20px_1fr] gap-2.5 rounded-lg px-2 py-2">
        {content}
      </li>
    )
  }

  return (
    <li>
      <Link
        to={step.to}
        search={{ onboarding: step.id }}
        className="group grid grid-cols-[20px_1fr_auto] items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
      >
        {content}
        <HugeiconsIcon
          icon={ArrowRight02Icon}
          className="mt-0.5 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        />
      </Link>
    </li>
  )
}
