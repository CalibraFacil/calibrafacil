// @vitest-environment jsdom

import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import {
  newWysiwygStarterDocument,
  validateCertificateDocument,
} from '@calibra-facil/certificate-html-template'

import { BlockInspector } from './block-inspector'
import { CertificateEditor } from './certificate-editor'

// T24: config edits must produce VALID documentJson (schema-checked) and the
// layout envelope must land on the right block.

function findLockedPos(editor: Editor, blockKey: string): number {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (
      found === -1 &&
      node.type.name === 'lockedBlock' &&
      node.attrs.blockKey === blockKey
    ) {
      found = pos
    }
    return found === -1
  })
  return found
}

function blockLayout(editor: Editor, blockKey: string): unknown {
  const json = editor.getJSON()
  const content = Array.isArray(json.content) ? json.content : []
  const block = content.find(
    (candidate) =>
      candidate.type === 'lockedBlock' &&
      candidate.attrs?.blockKey === blockKey,
  )
  return block?.attrs?.layout ?? null
}

async function mountWithInspector() {
  const holder: { editor: Editor | null } = { editor: null }
  function Harness() {
    const [editorInstance, setEditorInstance] = useState<Editor | null>(null)
    const [, setTick] = useState(0)
    return (
      <div>
        <CertificateEditor
          initialDocument={newWysiwygStarterDocument()}
          immediatelyRender
          onEditorReady={(editor) => {
            holder.editor = editor
            setEditorInstance(editor)
            editor.on('selectionUpdate', () => setTick((tick) => tick + 1))
            editor.on('update', () => setTick((tick) => tick + 1))
          }}
        />
        <BlockInspector editor={editorInstance} />
      </div>
    )
  }
  render(<Harness />)
  await waitFor(() => {
    if (!holder.editor) throw new Error('editor not ready')
  })
  const editor = holder.editor
  if (!editor) throw new Error('unreachable')
  return editor
}

afterEach(() => {
  cleanup()
})

describe('editor config UI (T24)', () => {
  it('theme switcher writes doc attrs.theme and the document stays valid', async () => {
    const editor = await mountWithInspector()
    const select = screen.getByLabelText('Registro visual')
    fireEvent.change(select, { target: { value: 'institute-classic' } })
    await waitFor(() => {
      expect(editor.getJSON().attrs?.theme).toBe('institute-classic')
    })
    expect(validateCertificateDocument(editor.getJSON()).ok).toBe(true)
    // page frame follows the theme class
    await waitFor(() => {
      expect(
        document.querySelector('.cf-theme-institute-classic'),
      ).not.toBeNull()
    })
  })

  it('results inspector: hiding a column writes layout.hiddenColumns; doc stays valid', async () => {
    const editor = await mountWithInspector()
    editor.commands.setNodeSelection(findLockedPos(editor, 'results_table'))
    await waitFor(() => {
      expect(screen.getByTestId('block-inspector')).toBeDefined()
    })
    fireEvent.click(screen.getByLabelText('Indicação como recebido'))
    await waitFor(() => {
      const layout = blockLayout(editor, 'results_table')
      expect(
        layout && typeof layout === 'object'
          ? Reflect.get(layout, 'hiddenColumns')
          : null,
      ).toEqual(['leitura_antes'])
    })
    expect(validateCertificateDocument(editor.getJSON()).ok).toBe(true)
    // the sealed preview drops the hidden column
    await waitFor(() => {
      const body = document.querySelector(
        '[data-locked-block-view="results_table"] .cf-locked-block-view__body',
      )
      expect(body?.innerHTML).not.toContain('Indicação como recebido')
    })
  })

  it('metadata inspector: columns + density write the layout envelope; classes render', async () => {
    const editor = await mountWithInspector()
    editor.commands.setNodeSelection(
      findLockedPos(editor, 'customer_identification'),
    )
    await waitFor(() => {
      expect(screen.getByTestId('block-inspector')).toBeDefined()
    })
    fireEvent.change(screen.getByLabelText('Colunas do bloco'), {
      target: { value: '2' },
    })
    await waitFor(() => {
      const layout = blockLayout(editor, 'customer_identification')
      expect(
        layout && typeof layout === 'object'
          ? Reflect.get(layout, 'columns')
          : null,
      ).toBe(2)
    })
    fireEvent.change(screen.getByLabelText('Densidade do bloco'), {
      target: { value: 'compact' },
    })
    await waitFor(() => {
      const layout = blockLayout(editor, 'customer_identification')
      expect(
        layout && typeof layout === 'object'
          ? Reflect.get(layout, 'density')
          : null,
      ).toBe('compact')
    })
    expect(validateCertificateDocument(editor.getJSON()).ok).toBe(true)
    await waitFor(() => {
      const body = document.querySelector(
        '[data-locked-block-view="customer_identification"] .cf-locked-block-view__body',
      )
      expect(body?.className).toContain('cf-layout-cols-2')
      expect(body?.className).toContain('cf-layout-compact')
    })
  })
})

function findBandPos(editor: Editor, typeName: string): number {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === typeName) found = pos
    return found === -1
  })
  return found
}

describe('band lanes + page-aware shell (M-B T29)', () => {
  it('renders both band lanes with the sample identity content', async () => {
    await mountWithInspector()
    const top = document.querySelector('[data-band-view="bandTopIdentity"]')
    expect(top).not.toBeNull()
    expect(top?.innerHTML).toContain('Laboratório Exemplo')
    expect(top?.innerHTML).toContain('CAL-2026-0042')
    const footer = document.querySelector('[data-band-view="bandPageFooter"]')
    expect(footer).not.toBeNull()
    // footer preview shows sample pagination
    expect(footer?.textContent).toContain('Página')
  })

  it('band inspector toggles write band attrs and the document stays valid', async () => {
    const editor = await mountWithInspector()
    editor.commands.setNodeSelection(findBandPos(editor, 'bandTopIdentity'))
    await waitFor(() => {
      expect(screen.getByTestId('band-inspector')).toBeDefined()
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Acreditação em texto' }))
    await waitFor(() => {
      const json = editor.getJSON()
      const band = Array.isArray(json.content) ? json.content[0] : null
      expect(band?.attrs?.showSealText).toBe(false)
    })
    expect(validateCertificateDocument(editor.getJSON()).ok).toBe(true)
    // the lane re-renders without the accreditation text line
    await waitFor(() => {
      const top = document.querySelector('[data-band-view="bandTopIdentity"]')
      expect(top?.innerHTML).not.toContain('cf-band-seal-text')
    })
  })

  it('disabling the top band shows the empty lane and stays schema-valid', async () => {
    const editor = await mountWithInspector()
    editor.commands.setNodeSelection(findBandPos(editor, 'bandTopIdentity'))
    await waitFor(() => {
      expect(screen.getByTestId('band-inspector')).toBeDefined()
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Exibir faixa no topo' }))
    await waitFor(() => {
      const top = document.querySelector('[data-band-view="bandTopIdentity"]')
      expect(top?.textContent).toContain('Faixa desativada')
    })
    expect(validateCertificateDocument(editor.getJSON()).ok).toBe(true)
  })

  it('zoom control scales the page frame', async () => {
    await mountWithInspector()
    const paper = document.querySelector('.cf-editor__paper')
    expect(paper?.getAttribute('data-zoom')).toBe('100')
    fireEvent.change(screen.getByLabelText('Zoom da página'), {
      target: { value: '75' },
    })
    await waitFor(() => {
      expect(
        document.querySelector('.cf-editor__paper')?.getAttribute('data-zoom'),
      ).toBe('75')
    })
  })

  it('bands cannot be deleted: select-all + delete keeps both lanes', async () => {
    const editor = await mountWithInspector()
    editor.commands.selectAll()
    editor.commands.deleteSelection()
    const json = editor.getJSON()
    const content = Array.isArray(json.content) ? json.content : []
    expect(content[0]?.type).toBe('bandTopIdentity')
    expect(content[content.length - 1]?.type).toBe('bandPageFooter')
    expect(validateCertificateDocument(json).ok).toBe(true)
  })
})
