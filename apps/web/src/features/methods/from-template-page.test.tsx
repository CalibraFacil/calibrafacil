// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useSearch,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { parseFromTemplateSearch } from './from-template-search'
import { FromTemplatePage } from './from-template-page'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const fromTemplateMock = vi.fn()
vi.mock('@/utils/api', () => ({
  calibraApi: {
    methods: {
      listMethodTemplates: () => listMock(),
      fromTemplate: (input: unknown) => fromTemplateMock(input),
    },
    assetTypes: {
      list: () => Promise.resolve({ data: [] }),
    },
  },
}))

const listMock = vi.fn()

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
        ref: '§5.1',
        item: 'Item informativo do método.',
        severity: 'info' as const,
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

// ---------------------------------------------------------------------------
// Test router harness
// ---------------------------------------------------------------------------

/**
 * Wrapper component for the from-template route in tests. Mirrors the pattern
 * in apps/web/src/routes/dashboard/methods/from-template.tsx: the route owns
 * validateSearch, the wrapper reads it via useSearch, and passes it as a prop
 * to the feature page (pure props, no Route.use* calls in the feature module).
 *
 * strict:false + parseFromTemplateSearch re-parse avoids the global
 * RegisteredRouter constraint in tests where the router is a minimal in-memory
 * instance rather than the full app route tree.
 */
function FromTemplateRouteComponent() {
  const rawSearch = useSearch({ strict: false })
  const search = parseFromTemplateSearch(rawSearch satisfies Record<string, unknown>)
  return <FromTemplatePage search={search} />
}

/**
 * Build a minimal in-memory TanStack Router that mounts FromTemplatePage at
 * /from-template with search params derived from the URL, without the full
 * application route tree or any loaders that hit the network.
 *
 * This lets tests control the URL and assert that navigation calls update the
 * location (REQ-FTPL-003/004/005/006).
 */
function buildTestRouter(initialSearch = '') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  const rootRoute = createRootRoute({
    component: function RootComponent() {
      return (
        <QueryClientProvider client={queryClient}>
          <Outlet />
        </QueryClientProvider>
      )
    },
  })

  const fromTemplateRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/from-template',
    validateSearch: parseFromTemplateSearch,
    component: FromTemplateRouteComponent,
  })

  const routeTree = rootRoute.addChildren([fromTemplateRoute])

  const history = createMemoryHistory({
    initialEntries: [
      `/from-template${initialSearch ? `?${initialSearch}` : ''}`,
    ],
  })

  const router = createRouter({ routeTree, history })

  return { router, queryClient }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FromTemplatePage — URL-driven wizard', () => {
  /**
   * REQ-FTPL-001: absent step param → catalog rendered.
   * REQ-FTPL-002: unknown step value → catalog rendered, no throw.
   */
  it('REQ-FTPL-001/002: renders catalog when step is absent or unknown', async () => {
    listMock.mockResolvedValue([ENTRY])

    // Absent step
    const { router: r1 } = buildTestRouter()
    render(<RouterProvider router={r1} />)
    await screen.findByText(ENTRY.defaultName)
    expect(
      screen.getByRole('button', { name: /revisar contexto/i }),
    ).toBeTruthy()
    cleanup()

    // Unknown step value — parseFromTemplateSearch maps it to undefined (→ catalog)
    const { router: r2 } = buildTestRouter('step=unknownvalue')
    render(<RouterProvider router={r2} />)
    await screen.findByText(ENTRY.defaultName)
    expect(
      screen.getByRole('button', { name: /revisar contexto/i }),
    ).toBeTruthy()
    cleanup()
  })

  /**
   * REQ-FTPL-003: clicking "Revisar contexto" updates the URL to
   * { step: 'context', template: <key> }.
   */
  it('REQ-FTPL-003: "Revisar contexto" pushes context step to URL', async () => {
    listMock.mockResolvedValue([ENTRY])

    const { router } = buildTestRouter()
    render(<RouterProvider router={router} />)
    await screen.findByText(ENTRY.defaultName)

    fireEvent.click(screen.getByRole('button', { name: /revisar contexto/i }))

    await waitFor(() => {
      const { search } = router.state.location
      expect(search).toMatchObject({
        step: 'context',
        template: 'weighing-instrument',
      })
    })
  })

  /**
   * REQ-FTPL-004: forward navigations push history entries so browser-back
   * returns to the previous step.
   */
  it('REQ-FTPL-004: browser history.back() from context returns to catalog', async () => {
    listMock.mockResolvedValue([ENTRY])

    const { router } = buildTestRouter()
    render(<RouterProvider router={router} />)
    await screen.findByText(ENTRY.defaultName)

    // Navigate to context step via "Revisar contexto"
    fireEvent.click(screen.getByRole('button', { name: /revisar contexto/i }))

    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ step: 'context' })
    })

    // Go back in history
    router.history.back()

    await waitFor(() => {
      // After back, step should be absent (catalog)
      const search = router.state.location.search
      expect(
        search.step === undefined || search.step === 'catalog',
      ).toBe(true)
    })

    // Catalog step should be visible again
    await screen.findByText(ENTRY.defaultName)
    expect(
      screen.getByRole('button', { name: /revisar contexto/i }),
    ).toBeTruthy()
  })

  /**
   * REQ-FTPL-005: deep-link with step=context but missing/unknown template
   * renders the catalog, not an error.
   */
  it('REQ-FTPL-005: step=context with missing template renders catalog', async () => {
    listMock.mockResolvedValue([ENTRY])

    // Missing template
    const { router: r1 } = buildTestRouter('step=context')
    render(<RouterProvider router={r1} />)
    await screen.findByText(ENTRY.defaultName)
    expect(
      screen.getByRole('button', { name: /revisar contexto/i }),
    ).toBeTruthy()
    cleanup()

    // Unknown template key
    const { router: r2 } = buildTestRouter('step=context&template=nonexistent')
    render(<RouterProvider router={r2} />)
    await screen.findByText(ENTRY.defaultName)
    expect(
      screen.getByRole('button', { name: /revisar contexto/i }),
    ).toBeTruthy()
    cleanup()

    // step=confirm with missing template also falls back
    const { router: r3 } = buildTestRouter('step=confirm')
    render(<RouterProvider router={r3} />)
    await screen.findByText(ENTRY.defaultName)
    expect(
      screen.getByRole('button', { name: /revisar contexto/i }),
    ).toBeTruthy()
    cleanup()
  })

  /**
   * REQ-FTPL-006: clicking an already-completed stepper step navigates to
   * that step's search params. Clicking "Modelo" navigates to { step: 'catalog' }.
   */
  it('REQ-FTPL-006: stepper back-click navigates to previous step URL', async () => {
    listMock.mockResolvedValue([ENTRY])

    // Start at context step (step 2 is active, step 1 "Modelo" is completed)
    const { router } = buildTestRouter(
      'step=context&template=weighing-instrument',
    )
    render(<RouterProvider router={router} />)

    // Wait for context step to render
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ step: 'context' })
    })

    // Click the "Modelo" back-navigation button in the stepper
    const stepperBack = await screen.findByRole('button', {
      name: /voltar para modelo/i,
    })
    fireEvent.click(stepperBack)

    await waitFor(() => {
      const { search } = router.state.location
      // step should be absent or 'catalog' after clicking "Modelo"
      expect(
        search.step === undefined || search.step === 'catalog',
      ).toBe(true)
    })
  })

  /**
   * REQ-FTPL-007: on the confirm step, all three acknowledgement checkboxes
   * start unchecked and "Criar rascunho" stays disabled until all are checked
   * and the name is ≥ 2 chars.
   */
  it('REQ-FTPL-007: acks start unchecked; submit disabled until all checked', async () => {
    listMock.mockResolvedValue([ENTRY])

    // Deep-link straight to confirm step with a valid template
    const { router } = buildTestRouter(
      'step=confirm&template=weighing-instrument',
    )
    render(<RouterProvider router={router} />)

    const submit = await screen.findByRole('button', { name: /criar rascunho/i })
    expect(submit.hasAttribute('disabled')).toBe(true)

    // All checkboxes start unchecked (data-checked absent means unchecked)
    const checkboxes = screen.getAllByRole('checkbox')
    for (const cb of checkboxes) {
      expect(cb.getAttribute('data-checked')).toBeNull()
    }

    // Check all three — name is pre-filled to defaultName (≥ 2 chars)
    for (const cb of checkboxes) {
      fireEvent.click(cb)
    }

    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: /criar rascunho/i })
          .hasAttribute('disabled'),
      ).toBe(false),
    )
  })

  /**
   * REQ-FTPL-007 (keyed remount): acks reset to unchecked when the confirm
   * step re-renders for the same template after navigation away and back.
   * Uses navigate() to build history from the catalog, then checks acks reset.
   */
  it('REQ-FTPL-007 (keyed remount): acks reset when returning to confirm step', async () => {
    listMock.mockResolvedValue([ENTRY])

    // Start at catalog (no search params) to have history room to go back/forward
    const { router } = buildTestRouter()
    render(<RouterProvider router={router} />)
    await screen.findByText(ENTRY.defaultName)

    // Navigate to confirm via history.push (avoids global RegisteredRouter type constraint)
    router.history.push('/from-template?step=confirm&template=weighing-instrument')
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ step: 'confirm' })
    })

    // Check all acks
    const checkboxes = await screen.findAllByRole('checkbox')
    for (const cb of checkboxes) {
      fireEvent.click(cb)
    }
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: /criar rascunho/i })
          .hasAttribute('disabled'),
      ).toBe(false),
    )

    // Navigate back to catalog
    router.history.back()
    await waitFor(() => {
      const step = router.state.location.search.step
      expect(
        step === undefined || step === 'catalog' || step === 'context',
      ).toBe(true)
    })

    // Navigate forward to confirm again
    router.history.forward()
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ step: 'confirm' })
    })

    // Acks must be reset (keyed remount via key={templateKey})
    const newCheckboxes = screen.getAllByRole('checkbox')
    for (const cb of newCheckboxes) {
      expect(cb.getAttribute('data-checked')).toBeNull()
    }
    expect(
      screen
        .getByRole('button', { name: /criar rascunho/i })
        .hasAttribute('disabled'),
    ).toBe(true)
  })

  /**
   * REQ-FTPL-008: submitting with all acks calls calibraApi.methods.fromTemplate
   * with the correct templateKey.
   */
  it('REQ-FTPL-008: submit calls fromTemplate with correct templateKey', async () => {
    listMock.mockResolvedValue([ENTRY])
    fromTemplateMock.mockResolvedValue({ id: 42 })

    const { router } = buildTestRouter(
      'step=confirm&template=weighing-instrument',
    )
    render(<RouterProvider router={router} />)

    await screen.findByRole('button', { name: /criar rascunho/i })

    // Check all acks
    for (const cb of screen.getAllByRole('checkbox')) {
      fireEvent.click(cb)
    }

    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: /criar rascunho/i })
          .hasAttribute('disabled'),
      ).toBe(false),
    )

    fireEvent.click(screen.getByRole('button', { name: /criar rascunho/i }))

    await waitFor(() => {
      expect(fromTemplateMock).toHaveBeenCalledWith(
        expect.objectContaining({ templateKey: 'weighing-instrument' }),
      )
    })
  })

  /**
   * Catalog cards must NOT expose an "Adotar"/"Criar rascunho" button.
   * The only forward action from the catalog is "Revisar contexto".
   */
  it('catalog cards expose only "Revisar contexto" — no adopt affordance', async () => {
    listMock.mockResolvedValue([ENTRY])

    const { router } = buildTestRouter()
    render(<RouterProvider router={router} />)
    await screen.findByText(ENTRY.defaultName)

    expect(
      screen.getByRole('button', { name: /revisar contexto/i }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: /adotar|criar rascunho/i }),
    ).toBeNull()
  })

  /**
   * Context step surfaces governance detail.
   */
  it('shows governance context on context step', async () => {
    listMock.mockResolvedValue([ENTRY])

    const { router } = buildTestRouter(
      'step=context&template=weighing-instrument',
    )
    render(<RouterProvider router={router} />)

    await screen.findByText(/Empuxo entra como entrada/i)
    expect(screen.getByText(/Componentes situacionais/i)).toBeTruthy()
    expect(screen.queryByText(/NÃO é declarado completo/i)).toBeNull()
  })
})
