import type { ActivationStepId } from '@calibra-facil/client-runtime'

import { Button } from '@/components/ui/button'
import { useMountEffect } from '@/hooks/use-mount-effect'

import { ACTIVATION_STEPS, type ActivationStep } from './steps'
import { pointAt } from './tour'

/**
 * The note a laboratory sees when it arrives on a screen from the activation
 * checklist.
 *
 * A full list screen looks the same whether you came here to browse or because
 * something told you to do one specific thing. This says which, in the
 * laboratory's own vocabulary, and then gets out of the way: it is a hint, not
 * a mode, and the screen behaves identically without it.
 *
 * When the step names the control that starts it, that control is pointed at
 * once on arrival, and "Mostrar onde" points at it again.
 *
 * Renders nothing when the param is absent or names a different screen's step,
 * so a stale link in someone's history opens the page rather than an error.
 */
export function OnboardingStepHint({
  step,
  expected,
}: {
  step?: ActivationStepId
  /** The step this screen resolves. */
  expected: ActivationStepId
}) {
  if (step !== expected) return null

  const definition = ACTIVATION_STEPS.find(
    (candidate) => candidate.id === expected,
  )
  if (!definition) return null

  return <StepHint definition={definition} />
}

function StepHint({ definition }: { definition: ActivationStep }) {
  const { pointer } = definition
  const show = pointer
    ? () =>
        pointAt({
          target: pointer.target,
          title: definition.label,
          description: pointer.description,
        })
    : undefined

  // Arriving from the checklist means "take me to it": point once. The cleanup
  // removes the pointer when the lab leaves the screen first.
  useMountEffect(() => show?.())

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-indigo-500/25 bg-indigo-500/5 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{definition.label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {definition.help}
        </p>
      </div>
      {show ? (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => {
            show()
          }}
        >
          Mostrar onde
        </Button>
      ) : null}
    </div>
  )
}
