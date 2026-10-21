// @vitest-environment jsdom

// Records retention (decision Q16): the "delete organization" action is a
// soft delete. The dialog says so, asks for the typed name AND a reason, and
// after success signs the owner out.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  softDelete: vi.fn(),
  signOut: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  replace: vi.fn(),
}))

vi.mock('@/utils/api', () => ({
  calibraApi: { organizationLifecycle: { softDelete: mocks.softDelete } },
}))
vi.mock('@calibra-facil/auth/client', () => ({ signOut: mocks.signOut }))
vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}))

import { DeleteOrganizationCard } from './delete-organization-card'

const NAME = 'Laboratório Exemplo'
const REASON = 'Encerramento das atividades do laboratório'

function renderCard() {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <DeleteOrganizationCard organizationName={NAME} />
    </QueryClientProvider>,
  )
}

async function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: /excluir organização/i }))
  return screen.findByRole('alertdialog')
}

function type(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, replace: mocks.replace },
  })
  mocks.signOut.mockResolvedValue({})
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DeleteOrganizationCard', () => {
  it('REQ-RET-3: explains that records are kept for the retention period and the laboratory is locked', async () => {
    renderCard()
    const dialog = await openDialog()

    const text = dialog.textContent ?? ''
    expect(text).toContain('período de retenção')
    expect(text).toContain('10 anos')
    expect(text).toMatch(/será bloqueada/)
    // The old copy promised a permanent erasure; that is no longer true.
    expect(text).not.toMatch(/irrevers/i)
    expect(text).not.toMatch(/permanentemente/i)
  })

  it('REQ-RET-3: the confirm button stays disabled until the name AND a reason are given', async () => {
    renderCard()
    await openDialog()
    const confirm = () =>
      screen.getByRole('button', { name: /excluir e bloquear/i })

    expect(confirm().hasAttribute('disabled')).toBe(true)
    type(/digite/i, 'outro nome')
    type(/motivo/i, REASON)
    expect(confirm().hasAttribute('disabled')).toBe(true)

    type(/digite/i, NAME)
    expect(confirm().hasAttribute('disabled')).toBe(false)

    type(/motivo/i, '')
    expect(confirm().hasAttribute('disabled')).toBe(true)
  })

  it('REQ-RET-3: sends the typed name and the reason, then signs the owner out and leaves', async () => {
    mocks.softDelete.mockResolvedValue({
      success: true,
      deletedAt: '2026-10-21T00:00:00.000Z',
    })
    renderCard()
    await openDialog()
    type(/digite/i, NAME)
    type(/motivo/i, REASON)

    fireEvent.click(screen.getByRole('button', { name: /excluir e bloquear/i }))

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/sign-in'))
    expect(mocks.softDelete).toHaveBeenCalledWith({
      confirmName: NAME,
      reason: REASON,
    })
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(mocks.toastSuccess).toHaveBeenCalled()
    // Sign-out happens after the API accepted the deletion, never before.
    expect(mocks.softDelete.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signOut.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('REQ-RET-3: a refusal from the API is shown and nobody is signed out', async () => {
    mocks.softDelete.mockRejectedValue(
      new Error('Somente o proprietário pode excluir a organização'),
    )
    renderCard()
    await openDialog()
    type(/digite/i, NAME)
    type(/motivo/i, REASON)

    fireEvent.click(screen.getByRole('button', { name: /excluir e bloquear/i }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        'Somente o proprietário pode excluir a organização',
      ),
    )
    expect(mocks.signOut).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('REQ-RET-3: a wrong name never reaches the API', async () => {
    renderCard()
    await openDialog()
    type(/digite/i, 'Laboratório Errado')
    type(/motivo/i, REASON)

    fireEvent.click(screen.getByRole('button', { name: /excluir e bloquear/i }))

    expect(mocks.softDelete).not.toHaveBeenCalled()
  })
})
