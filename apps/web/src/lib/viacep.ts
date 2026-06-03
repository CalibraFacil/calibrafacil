import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { useMountEffect } from '@/hooks/use-mount-effect'

export type EditableAddress = {
  cep?: string
  street?: string
  complement?: string
  neighbourhood?: string
  city?: string
  state?: string
}

export type ViaCepAddress = {
  cep: string
  street: string
  neighbourhood: string
  city: string
  state: string
}

type ViaCepResponse = {
  cep?: string
  logradouro?: string
  complemento?: string
  bairro?: string
  localidade?: string
  uf?: string
  erro?: boolean
}

const ViaCepResponseSchema = z.looseObject({
  cep: z.string().optional(),
  logradouro: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  localidade: z.string().optional(),
  uf: z.string().optional(),
  erro: z.boolean().optional(),
})

export type ViaCepLookupStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'not-found'
  | 'error'

export function getCepDigits(value: string) {
  return value.replace(/\D/g, '')
}

export function mapViaCepResponse(
  response: ViaCepResponse,
): ViaCepAddress | null {
  if (response.erro) {
    return null
  }

  return {
    cep: response.cep ?? '',
    street: response.logradouro ?? '',
    neighbourhood: response.bairro ?? '',
    city: response.localidade ?? '',
    state: response.uf ?? '',
  }
}

export function mergeViaCepAddress<TAddress extends EditableAddress>(
  currentAddress: TAddress,
  viaCepAddress: ViaCepAddress,
): TAddress {
  return Object.assign({}, currentAddress, {
    cep: viaCepAddress.cep || currentAddress.cep,
    street: viaCepAddress.street,
    neighbourhood: viaCepAddress.neighbourhood,
    city: viaCepAddress.city,
    state: viaCepAddress.state,
  })
}

export async function fetchViaCepAddress(
  cep: string,
  signal?: AbortSignal,
): Promise<ViaCepAddress | null> {
  const cepDigits = getCepDigits(cep)
  if (cepDigits.length !== 8) {
    return null
  }

  const response = await fetch(`https://viacep.com.br/ws/${cepDigits}/json/`, {
    signal,
  })

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
