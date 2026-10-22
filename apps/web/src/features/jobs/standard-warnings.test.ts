import { buildJobExecutionWarning } from '@calibra-facil/contracts/jobs-fixtures'
import { describe, expect, it } from 'vitest'

import { standardWarningItems } from './standard-warnings'

describe('standardWarningItems (REQ-P111-4)', () => {
  it('REQ-P111-4: names each stale standard and says the submit will be blocked until it is replaced', () => {
    const items = standardWarningItems(
      [
        buildJobExecutionWarning({
          reason: 'standard_expired',
          standardIds: [11],
          standardNames: ['Massa A'],
        }),
        buildJobExecutionWarning({
          reason: 'standard_inactive',
          standardIds: [12, 13],
          standardNames: ['Massa B', 'Massa C'],
        }),
        buildJobExecutionWarning({
          reason: 'standard_deleted',
          standardIds: [14],
          standardNames: ['Massa D'],
        }),
      ],
      [11, 12, 13, 14],
    )

    expect(items.map((item) => item.standardId)).toEqual([11, 12, 13, 14])
    expect(items.map((item) => item.message)).toEqual([
      'Padrão Massa A não está mais válido (certificado vencido); a submissão será bloqueada até substituí-lo.',
      'Padrão Massa B não está mais válido (padrão inativo); a submissão será bloqueada até substituí-lo.',
      'Padrão Massa C não está mais válido (padrão inativo); a submissão será bloqueada até substituí-lo.',
      'Padrão Massa D não está mais válido (padrão excluído); a submissão será bloqueada até substituí-lo.',
    ])
  })

  it('REQ-P111-4: a standard the technician has since removed from the selection is no longer warned about', () => {
    const items = standardWarningItems(
      [
        buildJobExecutionWarning({
          standardIds: [11, 12],
          standardNames: ['Massa A', 'Massa B'],
        }),
      ],
      [12],
    )

    expect(items).toHaveLength(1)
    expect(items[0]?.message).toContain('Massa B')
  })

  it('REQ-P111-4: no warnings give no items; a missing name falls back to the id', () => {
    expect(standardWarningItems(undefined, [11])).toEqual([])
    expect(standardWarningItems([], [11])).toEqual([])
    expect(
      standardWarningItems(
        [buildJobExecutionWarning({ standardIds: [11], standardNames: [] })],
        [11],
      )[0]?.message,
    ).toContain('Padrão #11 não está mais válido')
  })
})
