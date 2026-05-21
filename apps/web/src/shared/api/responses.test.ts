import { describe, expect, it } from 'vitest'

import { readJsonResponse } from './responses'

describe('readJsonResponse', () => {
  it('returns JSON payloads for successful responses', async () => {
    await expect(
      readJsonResponse<{ ok: boolean }>(Response.json({ ok: true })),
    ).resolves.toEqual({ ok: true })
  })

  it('throws API error messages from failed responses', async () => {
    await expect(
      readJsonResponse(
        Response.json({ error: 'Fórmula inválida' }, { status: 400 }),
      ),
    ).rejects.toThrow('Fórmula inválida')
  })

  it('can return diagnostics payloads for validation-style failures', async () => {
    await expect(
      readJsonResponse(
        Response.json({ diagnostics: [{ message: 'Falha' }] }, { status: 422 }),
        { allowDiagnosticsResponse: true },
      ),
    ).resolves.toEqual({ diagnostics: [{ message: 'Falha' }] })
  })
})
