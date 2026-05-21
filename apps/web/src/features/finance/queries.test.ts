import { describe, expect, it } from 'vitest'

import {
  financeContractsQueryOptions,
  financeContractDetailQueryOptions,
  financeContractCustomerOptionsQueryOptions,
  financeContractServiceOptionsQueryOptions,
  financeDocumentDetailQueryOptions,
  financeDocumentsQueryOptions,
  financeErpQueryOptions,
  financeEligibleJobsQueryOptions,
  financeOverviewQueryOptions,
  financeReceiptsQueryOptions,
  financeSearchInputFromUrl,
} from './queries'

describe('finance feature queries', () => {
  it('uses stable overview, receipts, and ERP query keys', () => {
    expect(financeOverviewQueryOptions().queryKey).toEqual([
      'finance',
      'overview',
    ])
    expect(financeReceiptsQueryOptions().queryKey).toEqual([
      'finance',
      'receipts',
    ])
    expect(financeErpQueryOptions().queryKey).toEqual(['finance', 'erp'])
  })

  it('keys document and contract lists by search text', () => {
    expect(financeDocumentsQueryOptions({ search: 'ACME' }).queryKey).toEqual([
      'finance',
      'documents',
      'ACME',
    ])
    expect(financeContractsQueryOptions({ search: 'ACME' }).queryKey).toEqual([
      'finance',
      'contracts',
      'ACME',
    ])
  })

  it('keys document and contract details by id', () => {
    expect(financeDocumentDetailQueryOptions('10').queryKey).toEqual([
      'finance',
      'documents',
      '10',
    ])
    expect(financeContractDetailQueryOptions(20).queryKey).toEqual([
      'finance',
      'contracts',
      '20',
    ])
  })

  it('keys finance form option reads', () => {
    expect(
      financeEligibleJobsQueryOptions({
        mode: 'consolidated',
        search: 'JOB-001',
      }).queryKey,
    ).toEqual([
      'finance',
      'documents',
      'eligible-jobs',
      'consolidated',
      'JOB-001',
    ])
    expect(financeContractCustomerOptionsQueryOptions().queryKey).toEqual([
      'finance',
      'contract-form',
      'customers',
    ])
    expect(financeContractServiceOptionsQueryOptions().queryKey).toEqual([
      'finance',
      'contract-form',
      'services',
    ])
  })

  it('derives search input from URL filters', () => {
    expect(
      financeSearchInputFromUrl(
        new URL(
          'https://app.example.test/dashboard/finance/documents?query=ACME',
        ),
      ),
    ).toEqual({ search: 'ACME' })
  })

  it('defaults missing search text', () => {
    expect(financeSearchInputFromUrl()).toEqual({ search: '' })
  })
})
