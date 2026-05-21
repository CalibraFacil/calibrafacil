import { describe, expect, it } from 'vitest'

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
})
