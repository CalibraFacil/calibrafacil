import { Fragment } from 'react'

import { cn } from '@/lib/utils'

/**
 * A small numbered-circle stepper for the from-template wizard. Net-new — NOT the
 * status-bound LifecycleStepper (which tracks DRAFT→PUBLISHED), this tracks the
 * 1-Modelo / 2-Contexto / 3-Confirmação wizard step index.
 */
export const FROM_TEMPLATE_STEPS = [
  { key: 'catalog', label: 'Modelo' },
  { key: 'context', label: 'Contexto' },
  { key: 'confirm', label: 'Confirmação' },
] as const

export type FromTemplateStepKey = (typeof FROM_TEMPLATE_STEPS)[number]['key']

export function WizardStepper({ current }: { current: FromTemplateStepKey }) {
  const currentIndex = FROM_TEMPLATE_STEPS.findIndex(
    (step) => step.key === current,
  )

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
      {FROM_TEMPLATE_STEPS.map((step, index) => {
        const done = index < currentIndex
        const active = index === currentIndex
        const isLast = index === FROM_TEMPLATE_STEPS.length - 1
        return (
          <Fragment key={step.key}>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={cn(
                  'flex size-5 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums',
                  done || active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground ring-1 ring-inset ring-foreground/15',
                  active && 'ring-4 ring-primary/15',
                )}
              >
                {index + 1}
              </span>
              <span
                className={cn(
                  'text-xs whitespace-nowrap',
                  active
                    ? 'font-medium text-foreground'
                    : done
                      ? 'text-foreground/70'
                      : 'text-muted-foreground',
                )}
              >
                {step.label}
              </span>
            </div>
            {!isLast && (
              <span
                aria-hidden
                className={cn(
                  'h-px w-5 shrink-0 sm:w-8',
                  index < currentIndex ? 'bg-primary' : 'bg-foreground/15',
                )}
              />
            )}
          </Fragment>
        )
      })}
    </div>
  )
}
