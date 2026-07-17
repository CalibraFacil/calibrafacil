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
