import { describe, expect, it } from 'vitest'

import {
  isApprovedJobRecordData,
  toFinancialStatus,
  toJobStatus,
} from './job-detail-guards'
import { isNullableRecord, toRecord, toRecordArray } from './record-guards'

function approvedRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    jobId: 'JOB-7',
    status: 'APPROVED',
    data: null,
    results: {},
    methodSnapshot: {
      methodId: 3,
      methodName: 'Balança',
      methodVersion: 2,
      dataFields: [],
      formulas: [],
      validations: [],
    },
    createdAt: '2026-05-20T10:00:00.000Z',
    ...overrides,
  }
}

describe('REQ-SPLIT-2 record guards', () => {
  it('REQ-SPLIT-2 toRecordArray keeps plain objects and drops everything else', () => {
    expect(toRecordArray('nope')).toEqual([])
    expect(toRecordArray(null)).toEqual([])
    expect(toRecordArray([{ a: 1 }, null, 'x', [1], { b: 2 }, 3])).toEqual([
      { a: 1 },
      { b: 2 },
    ])
  })

  it('REQ-SPLIT-2 toRecordArray copies each row instead of aliasing it', () => {
    const row = { a: 1 }
    const [copy] = toRecordArray([row])
    expect(copy).toEqual(row)
    expect(copy).not.toBe(row)
  })

  it('REQ-SPLIT-2 toRecord returns an empty record for non-objects and arrays', () => {
    expect(toRecord({ a: 1 })).toEqual({ a: 1 })
    expect(toRecord(null)).toEqual({})
    expect(toRecord([1])).toEqual({})
    expect(toRecord('x')).toEqual({})
  })

  it('REQ-SPLIT-2 isNullableRecord accepts null, undefined and objects but not arrays or scalars', () => {
    expect(isNullableRecord(null)).toBe(true)
    expect(isNullableRecord(undefined)).toBe(true)
    expect(isNullableRecord({})).toBe(true)
    expect(isNullableRecord([])).toBe(false)
    expect(isNullableRecord('x')).toBe(false)
    expect(isNullableRecord(1)).toBe(false)
  })
})

describe('REQ-SPLIT-2 job detail guards', () => {
  it('REQ-SPLIT-2 toJobStatus passes every known status and defaults to DRAFT', () => {
    for (const status of [
      'DRAFT',
      'IN_PROGRESS',
      'REVIEW',
      'APPROVED',
      'REJECTED',
      'CANCELED',
      'GENERATING_PDF',
      'SUPERSEDED',
    ]) {
      expect(toJobStatus(status)).toBe(status)
    }
    expect(toJobStatus('ARCHIVED')).toBe('DRAFT')
    expect(toJobStatus(undefined)).toBe('DRAFT')
  })

  it('REQ-SPLIT-2 toFinancialStatus passes every known status and defaults to UNBILLED', () => {
    for (const status of [
      'DRAFT',
      'ISSUED',
      'PAID',
      'OVERDUE',
      'VOID',
      'UNBILLED',
    ]) {
      expect(toFinancialStatus(status)).toBe(status)
    }
    expect(toFinancialStatus('REFUNDED')).toBe('UNBILLED')
    expect(toFinancialStatus(null)).toBe('UNBILLED')
  })

  it('REQ-SPLIT-2 isApprovedJobRecordData accepts a complete approved record', () => {
    expect(isApprovedJobRecordData(approvedRecord())).toBe(true)
    expect(
      isApprovedJobRecordData(
        approvedRecord({ data: { a: 1 }, results: null }),
      ),
    ).toBe(true)
  })

  it('REQ-SPLIT-2 isApprovedJobRecordData rejects a record missing any required piece', () => {
    expect(isApprovedJobRecordData(null)).toBe(false)
    expect(isApprovedJobRecordData(approvedRecord({ id: '7' }))).toBe(false)
    expect(isApprovedJobRecordData(approvedRecord({ jobId: 7 }))).toBe(false)
    expect(isApprovedJobRecordData(approvedRecord({ status: undefined }))).toBe(
      false,
    )
    expect(isApprovedJobRecordData(approvedRecord({ data: [] }))).toBe(false)
    expect(isApprovedJobRecordData(approvedRecord({ createdAt: 5 }))).toBe(
      false,
    )
    expect(
      isApprovedJobRecordData(
        approvedRecord({
          methodSnapshot: { ...approvedRecord().methodSnapshot, formulas: {} },
        }),
      ),
    ).toBe(false)
    expect(
      isApprovedJobRecordData(approvedRecord({ methodSnapshot: undefined })),
    ).toBe(false)
  })
})
