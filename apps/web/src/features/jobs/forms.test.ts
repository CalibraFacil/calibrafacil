import { describe, expect, it } from 'vitest'

import { parseJobForm, type JobFormData } from './forms'

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
        { field: 'serviceId', message: 'Selecione um servico' },
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
