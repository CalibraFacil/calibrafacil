import { describe, expect, it } from 'vitest'

import {
  parseExecutionPerformedAt,
  parseJobForm,
  type JobFormData,
} from './forms'

describe('job feature forms', () => {
  it('builds and validates job create payloads', () => {
    const result = parseJobForm({
      customerId: 10,
      assetId: 20,
      serviceId: 30,
      technicianId: 'tech-1',
      dueDate: new Date('2026-05-20T00:00:00.000Z'),
    })

    expect(result).toEqual({
      success: true,
      data: {
        assetId: 20,
        serviceId: 30,
        technicianId: 'tech-1',
        dueDate: '2026-05-20T00:00:00.000Z',
      },
    })
  })

  it('omits optional technician and due date values', () => {
    const result = parseJobForm({
      ...validJobForm(),
      technicianId: null,
      dueDate: null,
    })

    expect(result).toEqual({
      success: true,
      data: {
        assetId: 20,
        serviceId: 30,
      },
    })
  })

  it('maps required route and schema fields to form errors', () => {
    const result = parseJobForm({
      customerId: null,
      assetId: null,
      serviceId: null,
      technicianId: null,
      dueDate: null,
    })

    expect(result).toEqual({
      success: false,
      message: 'Selecione um cliente',
      fieldErrors: [
        { field: 'customerId', message: 'Selecione um cliente' },
        { field: 'assetId', message: 'Selecione um ativo' },
        { field: 'serviceId', message: 'Selecione um serviço' },
      ],
    })
  })
})

function validJobForm(): JobFormData {
  return {
    customerId: 10,
    assetId: 20,
    serviceId: 30,
    technicianId: null,
    dueDate: null,
  }
}

// The execution form's performed date follows the cloud's submit rules (the
// shared `resolveExecutionPerformedAt` in @calibra-facil/schemas), so the form
// and the desktop/cloud APIs cannot disagree about what is acceptable.
describe('parseExecutionPerformedAt', () => {
  const now = new Date(2026, 2, 20, 9, 0, 0)

  function daysBefore(days: number) {
    const date = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - days,
    )
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${date.getFullYear()}-${month}-${day}`
  }

  it('asks for a date', () => {
    expect(
      parseExecutionPerformedAt({ date: '', backdateReason: '' }, now),
    ).toMatchObject({
      valid: false,
      payload: null,
      field: 'performedAt',
      message: 'Informe a data da calibração',
    })
  })

  it('sends noon of a past day as an instant', () => {
    const result = parseExecutionPerformedAt(
      { date: daysBefore(2), backdateReason: '' },
      now,
    )

    expect(result.valid).toBe(true)
    expect(result.payload).toEqual({
      performedAt: new Date(2026, 2, 18, 12, 0, 0).toISOString(),
    })
    expect(result.requiresBackdateReason).toBe(false)
  })

  it('accepts today before noon without producing a future instant', () => {
    const result = parseExecutionPerformedAt(
      { date: daysBefore(0), backdateReason: '' },
      now,
    )

    expect(result.valid).toBe(true)
    expect(result.payload?.performedAt).toBe(now.toISOString())
  })

  it('rejects a day after today', () => {
    expect(
      parseExecutionPerformedAt(
        { date: '2026-03-21', backdateReason: '' },
        now,
      ),
    ).toMatchObject({
      valid: false,
      field: 'performedAt',
      message: 'A data de execução não pode estar no futuro',
    })
  })

  it('does not ask for a reason up to 7 days back', () => {
    const result = parseExecutionPerformedAt(
      { date: daysBefore(7), backdateReason: '' },
      now,
    )

    expect(result.valid).toBe(true)
    expect(result.requiresBackdateReason).toBe(false)
  })

  it('requires a reason beyond 7 days and says how far back it is', () => {
    const result = parseExecutionPerformedAt(
      { date: daysBefore(10), backdateReason: '  ' },
      now,
    )

    expect(result).toMatchObject({
      valid: false,
      payload: null,
      // A draft save still remembers the day while the reason is missing.
      instant: new Date(2026, 2, 10, 12, 0, 0).toISOString(),
      requiresBackdateReason: true,
      // Noon of the day 10 back, seen from 09:00: nine whole days.
      backdateDays: 9,
      field: 'backdateReason',
      message: 'Motivo obrigatório para lançamentos com mais de 7 dias',
    })
  })

  it('carries the trimmed reason when one is given', () => {
    const result = parseExecutionPerformedAt(
      { date: daysBefore(10), backdateReason: ' Sem sinal no cliente ' },
      now,
    )

    expect(result.valid).toBe(true)
    expect(result.payload).toEqual({
      performedAt: new Date(2026, 2, 10, 12, 0, 0).toISOString(),
      backdateReason: 'Sem sinal no cliente',
    })
    expect(result.requiresBackdateReason).toBe(true)
  })
})
