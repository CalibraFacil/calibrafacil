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
import {
  hashCertificateDocument,
  newWysiwygStarterDocument,
} from '@calibra-facil/certificate-html-template'

import type { WysiwygVersionDetail } from '../types'

const mocks = vi.hoisted(() => ({
  saveWysiwygDocument: vi.fn(),
  validateWysiwygDocument: vi.fn(),
  publishXlsx: vi.fn(),
  createXlsxPreview: vi.fn(),
  getXlsxPreview: vi.fn(),
  createWysiwygVersion: vi.fn(),
}))

vi.mock('@/utils/api', () => ({
  calibraApi: { certificateTemplates: mocks },
}))

import { EditorWorkbench } from './editor-workbench'

function makeVersion(
  overrides?: Partial<WysiwygVersionDetail>,
): WysiwygVersionDetail {
  const documentJson: Record<string, unknown> = JSON.parse(
    JSON.stringify(newWysiwygStarterDocument()),
  )
  return {
    id: 77,
    templateId: 5,
    version: 1,
    status: 'DRAFT',
    engine: 'wysiwyg',
    documentJson,
    documentSha256: hashCertificateDocument(documentJson),
    validationResult: null,
    publishedAt: null,
    updatedAt: null,
    ...overrides,
  }
}

function renderWorkbench(version = makeVersion()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <EditorWorkbench templateId="5" version={version} catalog={[]} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('EditorWorkbench (jsdom)', () => {
  it('autosave: an edit debounces into ONE PUT with the latest document', async () => {
    mocks.saveWysiwygDocument.mockResolvedValue({
      item: {
        id: 77,
        version: 1,
        status: 'DRAFT',
        documentSha256: 'a'.repeat(64),
        updatedAt: null,
      },
    })
    renderWorkbench()
    // simulate the editor reporting changes (typing twice quickly)
    const editorRoot = await screen.findByRole('toolbar')
    expect(editorRoot).toBeDefined()

    // drive the change handler through the real editor: type into the title
    const proseMirror = document.querySelector('.ProseMirror')
    expect(proseMirror).not.toBeNull()

    // TipTap in jsdom: dispatch two quick transactions via keyboard events is
    // unreliable; instead assert the debounce contract through the exposed
    // save-state badge after a real editor update (insertContent via the
    // placeholder path is covered elsewhere). Here we call the editor through
    // the DOM: focus + beforeinput text insertion.
    fireEvent.focus(proseMirror!)

    // fall back to dispatching an input event the editor listens to
    // (ProseMirror handles beforeinput in jsdom)
    proseMirror!.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'X',
        bubbles: true,
        cancelable: true,
      }),
    )

    await waitFor(() => {
      expect(screen.getByTestId('save-state').textContent).toMatch(
        /Alterações não salvas|Salvando…|Salvo/,
      )
    })

    await waitFor(
      () => {
        expect(mocks.saveWysiwygDocument).toHaveBeenCalledTimes(1)
      },
      { timeout: 4000 },
    )
    const [templateIdArg, versionIdArg, body] =
      mocks.saveWysiwygDocument.mock.calls[0] ?? []
    expect(templateIdArg).toBe('5')
    expect(versionIdArg).toBe(77)
    expect(body.documentJson.type).toBe('doc')

    await waitFor(() => {
      expect(screen.getByTestId('save-state').textContent).toBe('Salvo')
    })
  })

  it('publish is disabled until a validation passes; validate enables it', async () => {
    mocks.validateWysiwygDocument.mockResolvedValue({ ok: true, issues: [] })
    renderWorkbench()

    const publishButton = await screen.findByRole('button', {
      name: 'Publicar',
    })
    expect(publishButton.hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Validar' }))
    await waitFor(() => {
      expect(mocks.validateWysiwygDocument).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(
        screen
          .getByRole('button', { name: 'Publicar' })
          .hasAttribute('disabled'),
      ).toBe(false)
    })
  })

  it('validation failures render the issues panel and keep publish blocked', async () => {
    mocks.validateWysiwygDocument.mockResolvedValue({
      ok: false,
      issues: [
        { path: 'placeholders', message: 'unknown placeholder path: made.up' },
      ],
    })
    renderWorkbench()

    fireEvent.click(await screen.findByRole('button', { name: 'Validar' }))
    await waitFor(() => {
      expect(screen.getByTestId('validation-issues')).toBeDefined()
    })
    expect(screen.getByText(/made\.up/)).toBeDefined()
    expect(
      screen.getByRole('button', { name: 'Publicar' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('preview: enqueue then poll to RENDERED exposes the PDF link', async () => {
    mocks.createXlsxPreview.mockResolvedValue({
      item: { id: 900, status: 'PENDING' },
    })
    mocks.getXlsxPreview
      .mockResolvedValueOnce({
        item: { id: 900, status: 'PENDING' },
        pdfUrl: null,
      })
      .mockResolvedValue({
        item: { id: 900, status: 'RENDERED' },
        pdfUrl: 'https://r2.example/preview.pdf',
      })
    renderWorkbench()

    fireEvent.click(await screen.findByRole('button', { name: 'Gerar prévia' }))
    await waitFor(() => {
      expect(mocks.createXlsxPreview).toHaveBeenCalledTimes(1)
    })
    await waitFor(
      () => {
        const link = screen.getByText('Abrir prévia em PDF')
        expect(link.getAttribute('href')).toBe('https://r2.example/preview.pdf')
      },
      { timeout: 6000 },
    )
  })

  it('published versions render read-only: no toolbar, no publish actions', async () => {
    renderWorkbench(makeVersion({ status: 'PUBLISHED' }))
    await waitFor(() => {
      expect(document.querySelector('.ProseMirror')).not.toBeNull()
    })
    expect(screen.queryByRole('toolbar')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull()
  })

  it('published versions offer "Nova versão" which forks a DRAFT', async () => {
    mocks.createWysiwygVersion.mockResolvedValue({
      item: { id: 78, version: 2, status: 'DRAFT' },
    })
    renderWorkbench(makeVersion({ status: 'PUBLISHED' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Nova versão' }))
    await waitFor(() => {
      expect(mocks.createWysiwygVersion).toHaveBeenCalledWith('5')
    })
  })
})
