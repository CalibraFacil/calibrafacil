import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isValidCnpj, normalizeCnpj } from '@calibra-facil/shared/cnpj'
import type { CnpjLookupResult } from '@calibra-facil/client-runtime'

import { calibraApi } from '@/utils/api'
import { useMountEffect } from '@/hooks/use-mount-effect'

export type { CnpjLookupResult }

export type CnpjLookupStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'not-found'
  | 'error'

/** Keep a user-entered value; only fall back to the looked-up one when the field is blank. */
export function keepOrFill(current: string, incoming: string | null): string {
  return current.trim() ? current : (incoming ?? '')
}

/**
 * Server-side CNPJ lookup hook. Mirrors `useViaCepLookup`: debounced, dedupes via the
 * query cache, and ignores stale results. It calls our own API (which fans out to the
 * Receita Federal mirrors) rather than fetching an external service from the browser.
 *
 * The lookup is a non-blocking convenience: failures never stop manual entry.
 */
export function useCnpjLookup({
  cnpj,
  disabled = false,
  debounceMs = 500,
  onResolved,
}: {
  cnpj: string
  disabled?: boolean
  debounceMs?: number
  onResolved: (result: CnpjLookupResult) => void
}) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<CnpjLookupStatus>('idle')
  const timeoutRef = useRef<number | null>(null)
  const latestRef = useRef<string>('')

  const clearPendingLookup = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const lookupCnpj = useCallback(
    (nextCnpj = cnpj) => {
      clearPendingLookup()

      const normalized = normalizeCnpj(nextCnpj)

      // CPFs (11 chars) and partials never trigger a lookup — CNPJ only.
      if (disabled || !isValidCnpj(normalized)) {
        latestRef.current = ''
        setStatus('idle')
        return
      }

      latestRef.current = normalized
      timeoutRef.current = window.setTimeout(async () => {
        timeoutRef.current = null
        setStatus('loading')

        try {
          // react-doctor-disable-next-line react-doctor/async-defer-await -- the post-await staleness guard cannot run before the await
          const result = await queryClient.fetchQuery({
            queryKey: ['cnpj-lookup', normalized],
            queryFn: () => calibraApi.customers.lookupCnpj(normalized),
            staleTime: 24 * 60 * 60 * 1000,
          })

          // A newer CNPJ was typed while this was in flight — drop the result.
          if (latestRef.current !== normalized) {
            return
          }

          if (!result) {
            setStatus('not-found')
            return
          }

          onResolved(result)
          setStatus('success')
        } catch {
          if (latestRef.current !== normalized) {
            return
          }

          setStatus('error')
        }
      }, debounceMs)
    },
    [cnpj, clearPendingLookup, debounceMs, disabled, onResolved, queryClient],
  )

  const reset = useCallback(() => {
    clearPendingLookup()
    latestRef.current = ''
    setStatus('idle')
  }, [clearPendingLookup])

  useMountEffect(() => clearPendingLookup)

  return {
    status,
    isLoading: status === 'loading',
    message: getCnpjStatusMessage(status),
    lookupCnpj,
    reset,
  }
}

function getCnpjStatusMessage(status: CnpjLookupStatus): string | null {
  switch (status) {
    case 'loading':
      return 'Consultando CNPJ na Receita Federal...'
    case 'success':
      return 'Dados preenchidos pela Receita Federal. Revise antes de salvar.'
    case 'not-found':
      return 'CNPJ não encontrado na Receita Federal. Preencha manualmente.'
    case 'error':
      return 'Não foi possível consultar o CNPJ. Preencha manualmente.'
    default:
      return null
  }
}
