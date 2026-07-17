// @vitest-environment jsdom

import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { newWysiwygStarterDocument } from '@calibra-facil/certificate-html-template'

import type { PlaceholderCatalogEntry } from '../types'
import { CertificateEditor } from './certificate-editor'
import { PlaceholderPanel } from './placeholder-panel'

const CATALOG: PlaceholderCatalogEntry[] = [
  {
    path: 'customer.name',
    label: 'Razão social do cliente',
    group: 'Cliente',
    type: 'text',
    source: 'customer.name',
    required: true,
    format: 'text',
  },
  {
    path: 'uncertainty.expanded.value',
    label: 'Incerteza expandida (U)',
    group: 'Incerteza',
    type: 'number',
    source: 'results row role=expanded_uncertainty',
    required: false,
    format: 'number-br',
  },
]

function collectPlaceholderPaths(editor: Editor): string[] {
  const paths: string[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'placeholder') paths.push(String(node.attrs.path))
    return true
  })
  return paths
}

async function mountWithPanel() {
  const holder: { editor: Editor | null } = { editor: null }
  // Mirrors the page wiring: panel re-renders on selection changes.
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
          }}
        />
        <PlaceholderPanel editor={editorInstance} catalog={CATALOG} />
      </div>
    )
  }
  render(<Harness />)
  await waitFor(() => {
    if (!holder.editor) throw new Error('editor not ready')
  })
  const editor = holder.editor
  if (!editor) throw new Error('editor not ready')
  await waitFor(() => {
    expect(screen.getByLabelText('Buscar campo')).toBeDefined()
  })
  return { editor }
}

afterEach(() => {
  cleanup()
})

describe('PlaceholderPanel (jsdom)', () => {
  it('inserting from the catalog produces a TYPED placeholder node at the cursor', async () => {
    const { editor } = await mountWithPanel()
    // put the cursor inside the editable title
    editor.commands.setTextSelection(2)

    fireEvent.click(screen.getByText('Razão social do cliente'))

    expect(collectPlaceholderPaths(editor)).toEqual(['customer.name'])
    // document still schema-valid: the chip is a node with typed attrs, not text
    const json = editor.getJSON()
    expect(JSON.stringify(json)).toContain('"path":"customer.name"')
  })

  it('search filters the catalog (diacritic-insensitive)', async () => {
    await mountWithPanel()
    fireEvent.change(screen.getByLabelText('Buscar campo'), {
      target: { value: 'incerteza' },
    })
    expect(screen.queryByText('Razão social do cliente')).toBeNull()
    expect(screen.getByText('Incerteza expandida (U)')).toBeDefined()
  })

  it('shows the inspector for a selected placeholder atom', async () => {
    const { editor } = await mountWithPanel()
    editor.commands.setTextSelection(2)
    fireEvent.click(screen.getByText('Razão social do cliente'))

    // select the inserted atom via NodeSelection
    let placeholderPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'placeholder') placeholderPos = pos
      return true
    })
    expect(placeholderPos).toBeGreaterThan(-1)
    editor.commands.setNodeSelection(placeholderPos)

    await waitFor(() => {
      expect(screen.getByTestId('placeholder-inspector')).toBeDefined()
    })
    const inspector = within(screen.getByTestId('placeholder-inspector'))
    expect(inspector.getByText('{{customer.name}}')).toBeDefined()
    expect(inspector.getByText('obrigatório')).toBeDefined()
  })
})
