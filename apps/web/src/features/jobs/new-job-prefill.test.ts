import { describe, expect, it } from 'vitest'

import { parseNewJobSearch } from './new-job-search'
import { buildInitialJobFormData, parseJobForm } from './forms'

// DOM-02 (#655) — REQ-DOM-REP-002: opening the new calibration from a repair OS
// pre-fills customer + asset inherited from the OS. The wiring under test is the
// pure chain the route adapter runs: raw search params -> parseNewJobSearch ->
// buildInitialJobFormData -> the form's initial state. REQ-DOM-REP-003's client
// half: parseJobForm carries sourceServiceOrderId into the create payload.

describe('new calibration prefill from a repair service order', () => {
  it('REQ-DOM-REP-002: coerces string search params into numeric ids', () => {
    // TanStack passes raw search as strings on a hard navigation.
    const search = parseNewJobSearch({
      customerId: '42',
      assetId: '77',
      serviceOrderId: '9001',
    })

    expect(search).toEqual({
      customerId: 42,
      assetId: 77,
      serviceOrderId: 9001,
    })
  })

  it('REQ-DOM-REP-002: drops non-numeric / non-positive params instead of throwing', () => {
    expect(
      parseNewJobSearch({
        customerId: 'not-a-number',
        assetId: '0',
        serviceOrderId: '-3',
      }),
    ).toEqual({})

    expect(parseNewJobSearch({})).toEqual({})
  })

  it('REQ-DOM-REP-002: seeds customer + asset into the initial form from the OS', () => {
    const search = parseNewJobSearch({
      customerId: '42',
      assetId: '77',
      serviceOrderId: '9001',
    })

    expect(buildInitialJobFormData(search)).toEqual({
      customerId: 42,
      assetId: 77,
      serviceId: null,
      technicianId: null,
      dueDate: null,
      sourceServiceOrderId: 9001,
    })
  })

  it('REQ-DOM-REP-002: falls back to an empty form when there is no source OS', () => {
    expect(buildInitialJobFormData({})).toEqual({
      customerId: null,
      assetId: null,
      serviceId: null,
      technicianId: null,
      dueDate: null,
      sourceServiceOrderId: null,
    })
  })

  it('REQ-DOM-REP-003: parseJobForm carries the source service order into the create payload', () => {
    const result = parseJobForm({
      customerId: 42,
      assetId: 77,
      serviceId: 30,
      technicianId: null,
      dueDate: null,
      sourceServiceOrderId: 9001,
    })

    expect(result).toEqual({
      success: true,
      data: {
        assetId: 77,
        serviceId: 30,
        sourceServiceOrderId: 9001,
      },
    })
  })
})
