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

    // drive the change handler through the real editor: type into the title.
    // jsdom's beforeinput pipeline does not reach ProseMirror reliably, so
    // dispatch two quick REAL transactions via the editor instance TipTap
    // exposes on its root element — the debounce contract is what's under
    // test, not the browser input pipeline.
    const proseMirror = document.querySelector('.ProseMirror')
    expect(proseMirror).not.toBeNull()
    const editor = proseMirror ? Reflect.get(proseMirror, 'editor') : null
    expect(editor).toBeTruthy()
    editor.commands.insertContent('X')
    editor.commands.insertContent('Y')

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
    // floating chip appears with the count…
    const chip = await screen.findByTestId('validation-issues')
    expect(chip.textContent).toContain('1 problema')
    // …and opening it lists the mapped issues
    fireEvent.click(chip)
    // the unmappable issue shows in the chip AND the non-block banner
    expect((await screen.findAllByText(/made\.up/)).length).toBeGreaterThan(0)
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

  it('save failure blocks publish, resets validation and offers retry', async () => {
    mocks.validateWysiwygDocument.mockResolvedValue({ ok: true, issues: [] })
    mocks.saveWysiwygDocument.mockRejectedValueOnce(new Error('rede caiu'))
    renderWorkbench()

    await screen.findByRole('toolbar')
    fireEvent.click(screen.getByRole('button', { name: 'Validar' }))
    await waitFor(() => {
      expect(
        screen
          .getByRole('button', { name: 'Publicar' })
          .hasAttribute('disabled'),
      ).toBe(false)
    })

    // an edit whose autosave FAILS must re-block publish
    const proseMirror = document.querySelector('.ProseMirror')
    expect(proseMirror).not.toBeNull()
    const editor = proseMirror ? Reflect.get(proseMirror, 'editor') : null
    editor.commands.insertContent('X')
    // force the failing save through the retry-visible path
    await waitFor(
      () => {
        expect(screen.getByTestId('save-state').textContent).toBe(
          'Falha ao salvar',
        )
      },
      { timeout: 4000 },
    )
    expect(
      screen.getByRole('button', { name: 'Publicar' }).hasAttribute('disabled'),
    ).toBe(true)

    // retry succeeds -> saved, but validation must be required again
    mocks.saveWysiwygDocument.mockResolvedValue({
      item: {
        id: 77,
        version: 1,
        status: 'DRAFT',
        documentSha256: 'b'.repeat(64),
        updatedAt: null,
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await waitFor(() => {
      expect(screen.getByTestId('save-state').textContent).toBe('Salvo')
    })
    expect(
      screen.getByRole('button', { name: 'Publicar' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('a 409 conflict from another session hard-locks the editor with a banner', async () => {
    const { CalibraApiError } = await import('@calibra-facil/client-runtime')
    mocks.saveWysiwygDocument.mockRejectedValue(
      new CalibraApiError('conflito', 409, {
        error: 'alterado em outra sessão',
        code: 'document_conflict',
      }),
    )
    renderWorkbench()
    await screen.findByRole('toolbar')
    const proseMirror = document.querySelector('.ProseMirror')
    const editor = proseMirror ? Reflect.get(proseMirror, 'editor') : null
    editor.commands.insertContent('X')
    await waitFor(
      () => {
        expect(screen.getByTestId('remote-lock-banner')).toBeDefined()
      },
      { timeout: 4000 },
    )
    // editor flips read-only: the toolbar is gone
    await waitFor(() => {
      expect(screen.queryByRole('toolbar')).toBeNull()
    })
  })

  it('stale issue badges clear when blocks are reordered (index-keyed paths)', async () => {
    mocks.validateWysiwygDocument.mockResolvedValue({
      ok: false,
      issues: [{ path: 'content.8.attrs', message: 'problema no bloco' }],
    })
    renderWorkbench()
    await screen.findByRole('toolbar')
    fireEvent.click(screen.getByRole('button', { name: 'Validar' }))
    await waitFor(() => {
      expect(screen.getByTestId('validation-issues')).toBeDefined()
    })

    // reorder: move a block — indexes shift, stale badges would lie
    const proseMirror = document.querySelector('.ProseMirror')
    fireEvent.keyDown(proseMirror!, { key: 'ArrowUp', altKey: true })
    const editor = proseMirror ? Reflect.get(proseMirror, 'editor') : null
    editor.commands.setNodeSelection(3)
    fireEvent.keyDown(proseMirror!, { key: 'ArrowDown', altKey: true })
    await waitFor(() => {
      expect(screen.queryByTestId('validation-issues')).toBeNull()
    })
  })

  it('compile-path validation failures render the dedicated banner', async () => {
    mocks.validateWysiwygDocument.mockResolvedValue({
      ok: false,
      issues: [{ path: 'compile', message: 'placeholder desconhecido: x.y' }],
    })
    renderWorkbench()
    fireEvent.click(screen.getByRole('button', { name: 'Validar' }))
    await waitFor(() => {
      expect(screen.getByTestId('compile-error-banner').textContent).toContain(
        'placeholder desconhecido: x.y',
      )
    })
  })

  it('canEdit=false renders read-only with a permission banner (no silent 403s)', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <EditorWorkbench
          templateId="5"
          version={makeVersion()}
          catalog={[]}
          canEdit={false}
        />
      </QueryClientProvider>,
    )
    expect(await screen.findByTestId('permission-banner')).toBeDefined()
    expect(screen.queryByRole('toolbar')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull()
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
