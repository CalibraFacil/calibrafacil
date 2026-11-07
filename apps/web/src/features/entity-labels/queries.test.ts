import {
  QueryClient,
  type FetchQueryOptions,
  type QueryKey,
} from '@tanstack/react-query'
import { describe, expect, it, vi, type Mock } from 'vitest'

const apiMock = vi.hoisted(() => ({
  customers: { get: vi.fn() },
  assets: { get: vi.fn() },
  methods: { get: vi.fn() },
  jobs: { get: vi.fn() },
  services: { get: vi.fn() },
  serviceOrders: { get: vi.fn() },
  standards: { get: vi.fn() },
}))
vi.mock('@/utils/api', () => ({ calibraApi: apiMock }))

import {
  assetLabelQueryOptions,
  capaLabelQueryOptions,
  competenceLabelQueryOptions,
  customerLabelQueryOptions,
  jobLabelQueryOptions,
  methodLabelQueryOptions,
  nonConformanceLabelQueryOptions,
  serviceLabelQueryOptions,
  serviceOrderLabelQueryOptions,
  standardLabelQueryOptions,
} from './queries'

describe('entity label queries', () => {
  it('uses stable dashboard breadcrumb label keys', () => {
    expect(customerLabelQueryOptions('1').queryKey).toEqual([
      'customers',
      '1',
      'label',
    ])
    expect(assetLabelQueryOptions('2').queryKey).toEqual([
      'assets',
      '2',
      'label',
    ])
    expect(methodLabelQueryOptions('3').queryKey).toEqual([
      'methods',
      '3',
      'label',
    ])
    expect(jobLabelQueryOptions('4').queryKey).toEqual(['jobs', '4', 'label'])
    expect(serviceLabelQueryOptions('5').queryKey).toEqual([
      'services',
      '5',
      'label',
    ])
    expect(serviceOrderLabelQueryOptions('6').queryKey).toEqual([
      'service-orders',
      '6',
      'label',
    ])
    expect(standardLabelQueryOptions('7').queryKey).toEqual([
      'standards',
      '7',
      'label',
    ])
    expect(nonConformanceLabelQueryOptions('8').queryKey).toEqual([
      'non-conformance',
      '8',
      'label',
    ])
    expect(capaLabelQueryOptions('9').queryKey).toEqual(['capa', '9', 'label'])
    expect(competenceLabelQueryOptions('10').queryKey).toEqual([
      'competence',
      '10',
      'label',
    ])
  })

  it('does not cache a failed lookup as "no label"', async () => {
    await expectFailureNotCached(
      apiMock.customers.get,
      customerLabelQueryOptions('1'),
    )
    await expectFailureNotCached(
      apiMock.assets.get,
      assetLabelQueryOptions('2'),
    )
    await expectFailureNotCached(
      apiMock.methods.get,
      methodLabelQueryOptions('3'),
    )
    await expectFailureNotCached(apiMock.jobs.get, jobLabelQueryOptions('4'))
    await expectFailureNotCached(
      apiMock.services.get,
      serviceLabelQueryOptions('5'),
    )
    await expectFailureNotCached(
      apiMock.serviceOrders.get,
      serviceOrderLabelQueryOptions('6'),
    )
    await expectFailureNotCached(
      apiMock.standards.get,
      standardLabelQueryOptions('7'),
    )
  })
})

async function expectFailureNotCached<TKey extends QueryKey>(
  get: Mock,
  options: FetchQueryOptions<string, Error, string, TKey>,
) {
  get.mockRejectedValueOnce(new Error('network down'))
  const queryClient = new QueryClient()

  await expect(queryClient.fetchQuery(options)).rejects.toThrow('network down')
  expect(queryClient.getQueryData(options.queryKey)).toBeUndefined()
}
