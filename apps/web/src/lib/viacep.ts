import { useEffect, useState } from 'react'

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
  complement: string
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
    complement: response.complemento ?? '',
    neighbourhood: response.bairro ?? '',
    city: response.localidade ?? '',
    state: response.uf ?? '',
  }
}

export function mergeViaCepAddress<TAddress extends EditableAddress>(
  currentAddress: TAddress,
  viaCepAddress: ViaCepAddress,
): TAddress {
  return {
    ...currentAddress,
    cep: viaCepAddress.cep || currentAddress.cep,
    street: viaCepAddress.street,
    complement: viaCepAddress.complement,
    neighbourhood: viaCepAddress.neighbourhood,
    city: viaCepAddress.city,
    state: viaCepAddress.state,
  } as TAddress
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

  return mapViaCepResponse((await response.json()) as ViaCepResponse)
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
  const [status, setStatus] = useState<ViaCepLookupStatus>('idle')

  useEffect(() => {
    const cepDigits = getCepDigits(cep)

    if (disabled || cepDigits.length !== 8) {
      setStatus('idle')
      return
    }

    const controller = new AbortController()
    const timeoutId = window.setTimeout(async () => {
      setStatus('loading')

      try {
        const address = await fetchViaCepAddress(cepDigits, controller.signal)

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

    return () => {
      controller.abort()
      window.clearTimeout(timeoutId)
    }
  }, [cep, debounceMs, disabled, onResolved])

  return {
    status,
    isLoading: status === 'loading',
    message: getViaCepStatusMessage(status),
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
