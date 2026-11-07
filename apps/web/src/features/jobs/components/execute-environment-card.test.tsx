// @vitest-environment jsdom

import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import type { ExecutionFormValues } from '@/features/jobs/execution-draft'
import { ExecuteEnvironmentCard } from './execute-environment-card'

type Environment = ExecutionFormValues['environment']

function Harness() {
  const [environment, setEnvironment] = useState<Environment>({
    temperature: null,
    humidity: null,
    pressure: null,
  })
  return (
    <>
      <ExecuteEnvironmentCard
        open
        onOpenChange={() => {}}
        envWarnings={[]}
        envLimits={null}
        environment={environment}
        setEnvironment={setEnvironment}
        isEditable
      />
      <output data-testid="environment">{JSON.stringify(environment)}</output>
    </>
  )
}

describe('ExecuteEnvironmentCard', () => {
  afterEach(cleanup)

  it('records a typed 0 as 0 on change, not as null', () => {
    render(<Harness />)

    fireEvent.change(screen.getByPlaceholderText('Ex: 23,0'), {
      target: { value: '0' },
    })

    expect(screen.getByTestId('environment').textContent).toBe(
      '{"temperature":0,"humidity":null,"pressure":null}',
    )
  })

  it('reads a pt-BR decimal comma and keeps it on screen while typing', () => {
    render(<Harness />)
    const humidity = screen.getByPlaceholderText('Ex: 50,0')

    fireEvent.change(humidity, { target: { value: '5' } })
    fireEvent.change(humidity, { target: { value: '5,' } })

    expect(humidity).toHaveProperty('value', '5,')
    fireEvent.change(humidity, { target: { value: '5,5' } })
    expect(screen.getByTestId('environment').textContent).toBe(
      '{"temperature":null,"humidity":5.5,"pressure":null}',
    )
  })
})
