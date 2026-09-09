import { describe, expect, it } from 'vitest'
import type { ActivationChecklistResponse } from '@calibra-facil/client-runtime'

import { ACTIVATION_STEPS, buildActivationChecklistView } from './steps'
import { validateOnboardingSearch } from './search'

function checklist(
  done: Partial<Record<string, boolean>> = {},
): ActivationChecklistResponse {
  const steps = ACTIVATION_STEPS.map((step) => ({
    id: step.id,
    done: done[step.id] === true,
  }))

  return { steps, complete: steps.every((step) => step.done) }
}

describe('buildActivationChecklistView', () => {
  it('counts what is done out of every step', () => {
    const view = buildActivationChecklistView(
      checklist({ organizationProfile: true, customer: true }),
    )

    expect(view.completedCount).toBe(2)
    expect(view.totalCount).toBe(6)
    expect(view.complete).toBe(false)
  })

  it('locks the first calibration until its prerequisites are done', () => {
    const view = buildActivationChecklistView(checklist())
    const issue = view.steps.find((step) => step.id === 'firstCertificate')

    expect(issue?.locked).toBe(true)
    expect(issue?.blockedBy).toHaveLength(3)
  })

  it('names the steps still standing in the way', () => {
    const view = buildActivationChecklistView(
      checklist({ methodPublished: true, referenceStandard: true }),
    )
    const issue = view.steps.find((step) => step.id === 'firstCertificate')

    expect(issue?.blockedBy).toEqual(['Enviar o certificado ICP-Brasil A1'])
  })

  it('unlocks the first calibration once the three are in place', () => {
    const view = buildActivationChecklistView(
      checklist({
        methodPublished: true,
        referenceStandard: true,
        signingCertificate: true,
      }),
    )

    expect(
      view.steps.find((step) => step.id === 'firstCertificate')?.locked,
    ).toBe(false)
  })

  it('leaves every other step unlocked, since they do not depend on each other', () => {
    // The A1 certificate is often held by someone other than whoever is doing
    // setup. Nothing else may wait on it.
    const view = buildActivationChecklistView(checklist())

    expect(
      view.steps
        .filter((step) => step.id !== 'firstCertificate')
        .every((step) => !step.locked),
    ).toBe(true)
  })

  it('carries the step into the destination as a search param', () => {
    const view = buildActivationChecklistView(checklist())
    const standards = view.steps.find((step) => step.id === 'referenceStandard')

    expect(standards?.href).toBe(
      '/dashboard/standards?onboarding=referenceStandard',
    )
  })

  it('reports completion once the laboratory has issued a certificate', () => {
    const view = buildActivationChecklistView(
      checklist({
        organizationProfile: true,
        methodPublished: true,
        referenceStandard: true,
        signingCertificate: true,
        customer: true,
        firstCertificate: true,
      }),
    )

    expect(view.complete).toBe(true)
    expect(view.completedCount).toBe(6)
  })
})

describe('onboarding search', () => {
  it('keeps a recognised step', () => {
    expect(
      validateOnboardingSearch({ onboarding: 'referenceStandard' }),
    ).toEqual({ onboarding: 'referenceStandard' })
  })

  it('drops an unrecognised step rather than rejecting the page', () => {
    // A stale link in someone's history should still open the screen.
    expect(validateOnboardingSearch({ onboarding: 'nope' })).toEqual({})
  })

  it('passes every other search param through untouched', () => {
    // The jobs list is already linked to with a status filter. A validator
    // that dropped what it did not recognise would break links that work.
    expect(
      validateOnboardingSearch({ status: 'IN_PROGRESS', page: 2 }),
    ).toEqual({ status: 'IN_PROGRESS', page: 2 })
  })
})
