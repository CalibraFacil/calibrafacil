import type { ActivationStepId } from '@calibra-facil/client-runtime'

import { ACTIVATION_STEPS } from './steps'

/**
 * The `?onboarding=` param the activation checklist carries into each screen.
 *
 * It exists so a destination can point at the control the laboratory came for
 * instead of leaving them to find it on a full page. It is a hint and never a
 * mode: every one of these screens works identically without it, and an
 * unrecognised value is dropped rather than rejected, because a stale link in
 * someone's history should still open the page.
 */
export type OnboardingSearch = Record<string, unknown> & {
  onboarding?: ActivationStepId
}

const STEP_IDS: ReadonlySet<string> = new Set(
  ACTIVATION_STEPS.map((step) => step.id),
)

export function validateOnboardingSearch(
  search: Record<string, unknown>,
): OnboardingSearch {
  // Everything else on the URL is passed through untouched. Several of these
  // screens carry their own filters, and a validator that dropped what it did
  // not recognise would quietly break links that already work.
  const { onboarding, ...rest } = search
  const step =
    typeof onboarding === 'string' && STEP_IDS.has(onboarding)
      ? ACTIVATION_STEPS.find((candidate) => candidate.id === onboarding)
      : undefined

  return step ? { ...rest, onboarding: step.id } : rest
}
