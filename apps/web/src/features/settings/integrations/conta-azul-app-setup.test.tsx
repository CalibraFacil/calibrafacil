// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({
  getContaAzulApp: vi.fn(),
  saveContaAzulApp: vi.fn(),
  removeContaAzulApp: vi.fn(),
  startContaAzulOAuth: vi.fn(),
}))

vi.mock('@/utils/api', () => ({
  calibraApi: { integrations: mocks },
}))

import type { ContaAzulAppSummary } from '@/features/settings/types'
import { ContaAzulCard } from './conta-azul-card'

const CALLBACK_URL =
  'https://lab.example.com/api/integrations/conta-azul/oauth/callback'

function app(input: Partial<ContaAzulAppSummary> = {}): ContaAzulAppSummary {
  return {
    source: null,
    clientId: null,
    clientSecretLast4: null,
    redirectUri: CALLBACK_URL,
    updatedAt: null,
    ...input,
  }
}

function renderCard(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

afterEach(() => {
  cleanup()
  for (const mock of Object.values(mocks)) mock.mockReset()
})

describe('Conta Azul application setup', () => {
  it('walks a laboratory without an application through creating one', async () => {
    mocks.getContaAzulApp.mockResolvedValue(app())
    mocks.saveContaAzulApp.mockResolvedValue({
      app: app({ source: 'organization', clientId: 'lab-client-id' }),
      check: 'accepted',
    })
    const onRefresh = vi.fn().mockResolvedValue(undefined)

    renderCard(<ContaAzulCard integration={null} onRefresh={onRefresh} />)

    expect(
      await screen.findByText(
        'Antes de conectar, cadastre o aplicativo do laboratório',
      ),
    ).toBeTruthy()
    expect(screen.queryByText('Conectar Conta Azul')).toBeNull()
    expect(
      screen.getByRole('link', { name: /Abrir o portal/ }).getAttribute('href'),
    ).toBe('https://developers-portal.contaazul.com/')
    expect(screen.getByLabelText('URL de redirecionamento').textContent).toBe(
      CALLBACK_URL,
    )

    fill('Client ID', ' lab-client-id ')
    fill('Client Secret', 'lab-client-secret-9f3a')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar e verificar' }))

    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1))
    expect(mocks.saveContaAzulApp).toHaveBeenCalledWith({
      clientId: 'lab-client-id',
      clientSecret: 'lab-client-secret-9f3a',
    })
  })

  it('points at the missing values without calling the API', async () => {
    mocks.getContaAzulApp.mockResolvedValue(app())

    renderCard(<ContaAzulCard integration={null} onRefresh={vi.fn()} />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Salvar e verificar' }),
    )

    expect(screen.getByText('Informe o Client ID.')).toBeTruthy()
    expect(screen.getByText('Informe o Client Secret.')).toBeTruthy()
    expect(mocks.saveContaAzulApp).not.toHaveBeenCalled()
  })

  it("shows Conta Azul's refusal next to the form", async () => {
    mocks.getContaAzulApp.mockResolvedValue(app())
    mocks.saveContaAzulApp.mockRejectedValue(
      new Error('O Conta Azul recusou este Client ID e Client Secret.'),
    )

    renderCard(<ContaAzulCard integration={null} onRefresh={vi.fn()} />)
    await screen.findByLabelText('Client ID')
    fill('Client ID', 'id')
    fill('Client Secret', 'wrong')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar e verificar' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'O Conta Azul recusou este Client ID e Client Secret.',
    )
  })

  it('offers Connect once the laboratory has an application, and says which', async () => {
    mocks.getContaAzulApp.mockResolvedValue(
      app({
        source: 'organization',
        clientId: 'lab-client-id',
        clientSecretLast4: '9f3a',
      }),
    )

    renderCard(<ContaAzulCard integration={null} onRefresh={vi.fn()} />)

    expect(
      await screen.findByRole('button', { name: /Conectar Conta Azul/ }),
    ).toBeTruthy()
    expect(screen.getByText('lab-client-id')).toBeTruthy()
    expect(screen.getByText('9f3a')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Trocar' })).toBeTruthy()
  })

  it('offers Connect right away when the server supplies the application', async () => {
    mocks.getContaAzulApp.mockResolvedValue(app({ source: 'server' }))

    renderCard(<ContaAzulCard integration={null} onRefresh={vi.fn()} />)

    expect(
      await screen.findByRole('button', { name: /Conectar Conta Azul/ }),
    ).toBeTruthy()
    expect(
      screen.getByText('Aplicativo fornecido por este servidor'),
    ).toBeTruthy()
  })

  it('explains a failed connection the callback reported', async () => {
    mocks.getContaAzulApp.mockResolvedValue(app({ source: 'server' }))

    renderCard(
      <ContaAzulCard
        integration={null}
        onRefresh={vi.fn()}
        oauthError={{ reason: 'exchange_failed' }}
      />,
    )

    expect(
      await screen.findByText(/Confira se a URL de redirecionamento/),
    ).toBeTruthy()
  })
})
