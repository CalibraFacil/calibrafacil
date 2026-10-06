import { describe, expect, it } from 'vitest'

import { INTERFACE_TOUR } from './interface-tour'
import { ACTIVATION_STEPS } from './steps'
import { stepsOnScreen, tourSelector } from './tour'

describe('stepsOnScreen', () => {
  it('keeps centred steps and the ones whose element is on screen', () => {
    const onScreen = new Set([tourSelector('shown')])

    const steps = stepsOnScreen(
      [
        { title: 'Intro', description: 'centred' },
        { target: 'shown', title: 'Shown', description: 'a' },
        { target: 'hidden', title: 'Hidden', description: 'b' },
      ],
      (selector) => onScreen.has(selector),
    )

    expect(steps).toEqual([
      { popover: { title: 'Intro', description: 'centred' } },
      {
        element: '[data-tour="shown"]',
        popover: { title: 'Shown', description: 'a' },
      },
    ])
  })
})

describe('tour content', () => {
  it('opens with a centred introduction and points at distinct elements', () => {
    expect(INTERFACE_TOUR[0]?.target).toBeUndefined()

    const targets = INTERFACE_TOUR.flatMap((step) =>
      step.target ? [step.target] : [],
    )
    expect(new Set(targets).size).toBe(targets.length)
  })

  it('gives every pointed checklist step a target and its own words', () => {
    for (const step of ACTIVATION_STEPS) {
      if (!step.pointer) continue
      expect(step.pointer.target).toMatch(/^[a-z-]+$/)
      expect(step.pointer.description).not.toBe(step.help)
    }
  })
})
