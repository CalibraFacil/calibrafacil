// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const navigateMock = vi.fn()
vi.mock('@tanstack/react-router', async (importActual) => ({
  ...(await importActual<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigateMock,
}))

const listMock = vi.fn()
const fromTemplateMock = vi.fn()
vi.mock('@/utils/api', () => ({
  calibraApi: {
    methods: {
      listMethodTemplates: () => listMock(),
      fromTemplate: (input: unknown) => fromTemplateMock(input),
    },
  },
}))

import { FromTemplatePage } from './from-template-page'

const ENTRY = {
  templateKey: 'weighing-instrument',
  templateVersion: 1,
  discipline: 'mass',
  defaultName: 'Calibração de balança (cg-18)',
  defaultAccreditedScope: false,
  assetTypeSlug: 'balanca-digital',
  description: 'desc',
  model: 'formulas' as const,
  counts: {
    dataFields: 6,
    formulas: 4,
    validations: 1,
    uncertaintyParams: 0,
    verificar: 2,
    omitted: 1,
  },
  governance: {
    summary: 'Resumo do método de massa.',
    measurand: 'E = indicação − m_ref',
    model: 'formulas' as const,
    sources: [{ title: 'EURAMET cg-18', edition: 'v4.0', section: '§7.1' }],
    conformanceNotes: [],
    verificarItems: [
      {
        ref: '§7.1.2.2',
        item: 'Empuxo entra como entrada — calcule, não use 0.',
        severity: 'action' as const,
      },
      {
        ref: 'issue #506',
        item: 'Risco de plataforma sob revisão.',
        severity: 'platform' as const,
      },
    ],
    omittedComponents: [{ ref: '§7.1.2.4', component: 'Convecção' }],
    reviewStatus: 'draft_pending_revalidation' as const,
  },
  spec: {
    dataFields: [],
    formulas: [],
    measurementModels: [],
    validations: [],
    uncertaintyParams: [],
    certificateContent: null,
  },
  previewScenarios: [],
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <FromTemplatePage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FromTemplatePage', () => {
  it('catalog cards expose no adopt action — only "Revisar contexto"', async () => {
    listMock.mockResolvedValue([ENTRY])
    renderPage()
    await screen.findByText(ENTRY.defaultName)

    expect(
      screen.getByRole('button', { name: /revisar contexto/i }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: /adotar|criar rascunho/i }),
    ).toBeNull()
  })

  it('shows governance context and gates "Criar rascunho" until acks + name', async () => {
    listMock.mockResolvedValue([ENTRY])
    renderPage()
    await screen.findByText(ENTRY.defaultName)

    // Step 1 → 2: the only path forward is reviewing the context.
    fireEvent.click(screen.getByRole('button', { name: /revisar contexto/i }))

    // Step 2 surfaces the governance: a [VERIFICAR] item + the completeness denial.
    expect(
      screen.getByText(/Empuxo entra como entrada/i),
    ).toBeTruthy()
    expect(
      screen.getByText(/NÃO é declarado completo/i),
    ).toBeTruthy()

    // Step 2 → 3.
    fireEvent.click(screen.getByRole('button', { name: /confirmar adoção/i }))

    const submit = screen.getByRole('button', { name: /criar rascunho/i })
    expect(submit.hasAttribute('disabled')).toBe(true)

    // Acknowledge all three → submit unlocks (name is pre-filled to defaultName).
    for (const checkbox of screen.getAllByRole('checkbox')) {
      fireEvent.click(checkbox)
    }
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: /criar rascunho/i })
          .hasAttribute('disabled'),
      ).toBe(false),
    )
  })
})
