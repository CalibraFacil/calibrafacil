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
import { filterFieldSuggestions } from './field-suggestion'

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

async function mountEditor() {
  const holder: { editor: Editor | null } = { editor: null }
  function Harness() {
    const [, setTick] = useState(0)
    return (
      <CertificateEditor
        initialDocument={newWysiwygStarterDocument()}
        catalog={CATALOG}
        immediatelyRender
        onEditorReady={(editor) => {
          holder.editor = editor
          editor.on('selectionUpdate', () => setTick((tick) => tick + 1))
        }}
      />
    )
  }
  render(<Harness />)
  await waitFor(() => {
    if (!holder.editor) throw new Error('editor not ready')
  })
  const editor = holder.editor
  if (!editor) throw new Error('editor not ready')
  return { editor }
}

afterEach(() => {
  cleanup()
})

describe('FieldPalette (shell reframe step 2)', () => {
  it('inserting from the palette produces a TYPED placeholder node at the cursor', async () => {
    const { editor } = await mountEditor()
    editor.commands.setTextSelection(2)
    fireEvent.click(
      screen.getByRole('button', { name: 'Campos do certificado' }),
    )
    const palette = await screen.findByTestId('field-palette')
    fireEvent.click(within(palette).getByText('Razão social do cliente'))
    expect(collectPlaceholderPaths(editor)).toEqual(['customer.name'])
    expect(JSON.stringify(editor.getJSON())).toContain(
      '"path":"customer.name"',
    )
  })

  it('search filters the catalog', async () => {
    await mountEditor()
    fireEvent.click(
      screen.getByRole('button', { name: 'Campos do certificado' }),
    )
    const palette = await screen.findByTestId('field-palette')
    fireEvent.change(within(palette).getByLabelText('Buscar campo'), {
      target: { value: 'incerteza' },
    })
    expect(within(palette).queryByText('Razão social do cliente')).toBeNull()
    expect(within(palette).getByText('Incerteza expandida (U)')).toBeDefined()
  })
})

describe('filterFieldSuggestions ({{ autocomplete)', () => {
  it('matches label, path and group case-insensitively, capped at 8', () => {
    expect(
      filterFieldSuggestions(CATALOG, 'razão').map((entry) => entry.path),
    ).toEqual(['customer.name'])
    expect(
      filterFieldSuggestions(CATALOG, 'uncertainty.expanded').map(
        (entry) => entry.path,
      ),
    ).toEqual(['uncertainty.expanded.value'])
    expect(filterFieldSuggestions(CATALOG, '')).toHaveLength(2)
    const many = Array.from({ length: 20 }, (_, index) => ({
      ...CATALOG[0]!,
      path: `p.${index}`,
    }))
    expect(filterFieldSuggestions(many, 'razão')).toHaveLength(8)
  })

  it('typing {{ in the editor opens the plain-DOM popup with matches', async () => {
    const { editor } = await mountEditor()
    editor.commands.setTextSelection(2)
    editor.commands.insertContent('{{')
    await waitFor(() => {
      expect(document.querySelector('[data-testid="field-suggest-popup"]')).not.toBeNull()
    })
    const popup = document.querySelector('[data-testid="field-suggest-popup"]')
    expect(popup?.textContent).toContain('Razão social do cliente')
  })
})


describe('slash menu (roadmap item 4)', () => {
  it("typing '/' opens the unified menu; picking Divisor inserts a horizontalRule", async () => {
    const { editor } = await mountEditor()
    editor.commands.setTextSelection(3)
    editor.commands.insertContent('/')
    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="slash-menu-popup"]'),
      ).not.toBeNull()
    })
    const popup = document.querySelector('[data-testid="slash-menu-popup"]')
    expect(popup?.textContent).toContain('Tabela')
    expect(popup?.textContent).toContain('Balanço de incertezas (anexo)')
    // pick Divisor via mousedown (popup uses mousedown to keep editor focus)
    const buttons = [...(popup?.querySelectorAll('button') ?? [])]
    const divisor = buttons.find((button) =>
      button.textContent?.includes('Divisor'),
    )
    expect(divisor).toBeDefined()
    divisor?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await waitFor(() => {
      expect(JSON.stringify(editor.getJSON())).toContain('horizontalRule')
    })
  })

  it('field entries in the slash menu insert typed placeholders', async () => {
    const { editor } = await mountEditor()
    editor.commands.setTextSelection(3)
    editor.commands.insertContent('/razão')
    await waitFor(() => {
      const popup = document.querySelector('[data-testid="slash-menu-popup"]')
      expect(popup?.textContent).toContain('Razão social do cliente')
    })
    const popup = document.querySelector('[data-testid="slash-menu-popup"]')
    const entry = [...(popup?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent?.includes('Razão social'),
    )
    entry?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await waitFor(() => {
      expect(JSON.stringify(editor.getJSON())).toContain(
        '"path":"customer.name"',
      )
    })
  })
})
