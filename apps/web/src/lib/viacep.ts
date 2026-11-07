import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  getCepDigits,
  mapViaCepResponse,
  viaCepUrl,
  ViaCepResponseSchema,
  type ViaCepAddress,
} from '@calibra-facil/shared/viacep'
import { useMountEffect } from '@calibra-facil/ui/use-mount-effect'

export type ViaCepLookupStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'not-found'
  | 'error'

async function fetchViaCepAddress(
  cep: string,
  signal?: AbortSignal,
): Promise<ViaCepAddress | null> {
  const cepDigits = getCepDigits(cep)
  if (cepDigits.length !== 8) {
    return null
  }

  const response = await fetch(viaCepUrl(cepDigits), { signal })

  if (!response.ok) {
    throw new Error('Falha ao consultar CEP')
  }

  return mapViaCepResponse(ViaCepResponseSchema.parse(await response.json()))
}

export function useViaCepLookup({
  cep,
  disabled = false,
  debounceMs = 450,
  onResolved,
}: {
  cep: string
  disabled?: boolean
  debounceMs?: number
  onResolved: (address: ViaCepAddress) => void
}) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<ViaCepLookupStatus>('idle')
  const timeoutRef = useRef<number | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const clearPendingLookup = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  const lookupCep = useCallback(
    (nextCep = cep) => {
      clearPendingLookup()

      const cepDigits = getCepDigits(nextCep)

      if (disabled || cepDigits.length !== 8) {
        setStatus('idle')
        return
      }

      const controller = new AbortController()
      controllerRef.current = controller
      timeoutRef.current = window.setTimeout(async () => {
        timeoutRef.current = null
        setStatus('loading')

        try {
          // react-doctor-disable-next-line react-doctor/async-defer-await -- the post-await guard discards results aborted mid-fetch; it cannot run before the await
          const address = await queryClient.fetchQuery({
            queryKey: ['viacep', cepDigits],
            queryFn: () => fetchViaCepAddress(cepDigits, controller.signal),
            staleTime: 24 * 60 * 60 * 1000,
          })

          if (controller.signal.aborted) {
            return
          }

          if (!address) {
            setStatus('not-found')
            return
          }

          onResolved(address)
          setStatus('success')
        } catch {
          if (controller.signal.aborted) {
            return
          }

          setStatus('error')
        }
      }, debounceMs)
    },
    [cep, clearPendingLookup, debounceMs, disabled, onResolved, queryClient],
  )

  const reset = useCallback(() => {
    clearPendingLookup()
    setStatus('idle')
  }, [clearPendingLookup])

  useMountEffect(() => clearPendingLookup)

  return {
    status,
    isLoading: status === 'loading',
    message: getViaCepStatusMessage(status),
    lookupCep,
    reset,
  }
}

function getViaCepStatusMessage(status: ViaCepLookupStatus) {
  switch (status) {
    case 'loading':
      return 'Consultando CEP...'
    case 'success':
      return null
    case 'not-found':
      return 'CEP não encontrado.'
    case 'error':
      return 'Não foi possível consultar o CEP.'
    default:
      return null
  }
}
