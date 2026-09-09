import { describe, expect, it } from 'vitest'

import {
  looksLikeApexDomain,
  normalizeEmailDnsRecords,
  suggestSendingSubdomain,
} from './email-domain-records'

describe('normalizeEmailDnsRecords', () => {
  it('keeps the provider values exactly as given', () => {
    // Re-deriving a DKIM value is how a lab publishes something that never
    // verifies, so this only reshapes for rendering.
    const records = normalizeEmailDnsRecords([
      {
        type: 'CNAME',
        name: 'resend._domainkey.certificados.lab.com.br',
        value: 'abc123.dkim.amazonses.com',
        status: 'not_started',
      },
    ])

    expect(records).toEqual([
      {
        type: 'CNAME',
        name: 'resend._domainkey.certificados.lab.com.br',
        value: 'abc123.dkim.amazonses.com',
        status: 'not_started',
      },
    ])
  })

  it('carries MX priority through as a string', () => {
    const [record] = normalizeEmailDnsRecords([
      {
        type: 'mx',
        name: 'send.certificados.lab.com.br',
        value: 'feedback-smtp.sa-east-1.amazonses.com',
        priority: 10,
      },
    ])

    expect(record.type).toBe('MX')
    expect(record.priority).toBe('10')
  })

  it('drops anything without a type or a name rather than rendering a blank row', () => {
    expect(
      normalizeEmailDnsRecords([{ value: 'orphan' }, null, 'nope']),
    ).toEqual([])
  })

  it('survives a provider response that is not an array', () => {
    expect(normalizeEmailDnsRecords(undefined)).toEqual([])
    expect(normalizeEmailDnsRecords({})).toEqual([])
  })
})

describe('looksLikeApexDomain', () => {
  it('recognises a Brazilian apex as three labels', () => {
    // laboratorio.com.br is an apex even though it has three labels; counting
    // alone would call every .com.br domain a subdomain.
    expect(looksLikeApexDomain('laboratorio.com.br')).toBe(true)
    expect(looksLikeApexDomain('certificados.laboratorio.com.br')).toBe(false)
  })

  it('recognises a two-label apex elsewhere', () => {
    expect(looksLikeApexDomain('laboratorio.com')).toBe(true)
    expect(looksLikeApexDomain('certificados.laboratorio.com')).toBe(false)
  })
})

describe('suggestSendingSubdomain', () => {
  it('offers a subdomain when the lab typed its apex', () => {
    expect(suggestSendingSubdomain('laboratorio.example')).toBe(
      'certificados.laboratorio.example',
    )
  })

  it('stays quiet when the lab already typed a subdomain', () => {
    expect(
      suggestSendingSubdomain('certificados.laboratorio.example'),
    ).toBeNull()
  })
})
