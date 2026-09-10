// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { OperationAvailability } from '@calibra-facil/client-runtime'

import {
  ActionAvailabilityGate,
  OperationUnavailableNotice,
} from './action-availability-gate'

const available: OperationAvailability = {
  available: true,
  source: 'cloud',
  policy: 'cloud-only',
}

function blocked(
  overrides: Partial<Extract<OperationAvailability, { available: false }>> = {},
): OperationAvailability {
  return {
    available: false,
    reason: 'cloud-unreachable',
    policy: 'cloud-only',
    message: 'Esta ação precisa da API da nuvem.',
    resolvableBySync: false,
    ...overrides,
  }
}

describe('ActionAvailabilityGate', () => {
  afterEach(cleanup)

  it('renders the action enabled when the operation is available', () => {
    render(
      <ActionAvailabilityGate availability={available}>
        {({ disabled }) => (
          <button type="button" disabled={disabled}>
            Aprovar
          </button>
        )}
      </ActionAvailabilityGate>,
    )

    expect(
      screen.getByRole('button', { name: 'Aprovar' }).hasAttribute('disabled'),
    ).toBe(false)
  })

  it('disables the action when the operation is unavailable', () => {
    // One boolean drives both the control and the explanation, so a blocked
    // button can never disagree with its own tooltip.
    render(
      <ActionAvailabilityGate availability={blocked()}>
        {({ disabled }) => (
          <button type="button" disabled={disabled}>
            Aprovar
          </button>
        )}
      </ActionAvailabilityGate>,
    )

    expect(
      screen.getByRole('button', { name: 'Aprovar' }).hasAttribute('disabled'),
    ).toBe(true)
  })
})

describe('OperationUnavailableNotice', () => {
  afterEach(cleanup)

  it('renders nothing when the operation is available', () => {
    const { container } = render(
      <OperationUnavailableNotice availability={available} />,
    )

    expect(container.textContent).toBe('')
  })

  it('states the reason when the operation is unavailable', () => {
    render(
      <OperationUnavailableNotice
        availability={blocked({
          reason: 'entity-not-synced',
          message: 'Este registro ainda não foi enviado para a nuvem.',
          resolvableBySync: true,
        })}
      />,
    )

    expect(
      screen.getByText('Este registro ainda não foi enviado para a nuvem.'),
    ).toBeTruthy()
  })

  it('omits the sync affordance outside the dashboard shell', () => {
    // No sync provider mounted: offering "sincronizar agora" would be a button
    // that does nothing.
    render(
      <OperationUnavailableNotice
        availability={blocked({ resolvableBySync: true })}
      />,
    )

    expect(screen.queryByRole('button', { name: /Sincronizar agora/ })).toBe(
      null,
    )
  })
})
