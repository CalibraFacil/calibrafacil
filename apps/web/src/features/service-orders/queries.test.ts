import { describe, expect, it, vi } from 'vitest'

import { calibraApi } from '@/utils/api'
import {
  fetchServiceOrderMaterials,
  newServiceOrderAssetsQueryOptions,
  newServiceOrderCustomersQueryOptions,
  serviceOrderDetailQueryOptions,
  serviceOrderFinancialStatusQueryOptions,
  serviceOrderMaterialsQueryOptions,
  serviceOrdersListQueryInputFromUrl,
  serviceOrdersListQueryOptions,
} from './queries'

vi.mock('@/utils/api', () => ({
  calibraApi: {
    materials: {
      list: vi.fn(),
    },
  },
}))

describe('service orders feature queries', () => {
  it('keys service order lists by organization and filters', () => {
    const options = serviceOrdersListQueryOptions({
      organizationId: 'org-1',
      page: 2,
      limit: 20,
      search: 'OS-42',
      statusFilter: 'awaiting_quote_approval',
    })

    expect(options.queryKey).toEqual([
      'service-orders',
      'org-1',
      2,
      'OS-42',
      'awaiting_quote_approval',
    ])
  })

  it('keys service order details by id', () => {
    expect(serviceOrderDetailQueryOptions('42').queryKey).toEqual([
      'service-order',
      '42',
    ])
    expect(serviceOrderFinancialStatusQueryOptions('42').queryKey).toEqual([
      'service-order',
      '42',
      'financial-status',
    ])
  })

  it('REQ-SOPICK-001: keys the material picker query by search text', () => {
    expect(serviceOrderMaterialsQueryOptions('correia').queryKey).toEqual([
      'materials',
      'service-order-picker',
      'correia',
    ])
  })

  it('REQ-SOPICK-001: fetches only active materials with the trimmed query', async () => {
    const list = vi.mocked(calibraApi.materials.list)
    list.mockResolvedValue({ data: [] })

    await fetchServiceOrderMaterials('  correia  ')

    expect(list).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      query: 'correia',
      isActive: true,
    })

    await fetchServiceOrderMaterials('')
    expect(list).toHaveBeenLastCalledWith({
      page: 1,
      limit: 20,
      query: undefined,
      isActive: true,
    })
  })

  it('keys new service order option queries by search and customer', () => {
    expect(newServiceOrderCustomersQueryOptions('ana').queryKey).toEqual([
      'customers',
      'service-order-open',
      'ana',
    ])
    expect(
      newServiceOrderAssetsQueryOptions({
        customerId: 123,
        search: 'balanca',
      }).queryKey,
    ).toEqual(['assets', 'service-order-open', 123, 'balanca'])
  })

  it('derives list input from URL filters', () => {
    expect(
      serviceOrdersListQueryInputFromUrl(
        'org-1',
        new URL(
          'https://app.example.test/dashboard/service-orders?page=3&query=OS-42&status=quote_approved',
        ),
      ),
    ).toEqual({
      organizationId: 'org-1',
      page: 3,
      limit: 20,
      search: 'OS-42',
      statusFilter: 'quote_approved',
    })
  })

  it('ignores invalid URL filters', () => {
    expect(
      serviceOrdersListQueryInputFromUrl(
        'org-1',
        new URL(
          'https://app.example.test/dashboard/service-orders?page=-2&status=UNKNOWN',
        ),
      ),
    ).toEqual({
      organizationId: 'org-1',
      page: 1,
      limit: 20,
      search: '',
      statusFilter: '',
    })
  })
})
