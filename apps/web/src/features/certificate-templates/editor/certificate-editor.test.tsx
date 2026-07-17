// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { newWysiwygStarterDocument } from '@calibra-facil/certificate-html-template'

import { CertificateEditor } from './certificate-editor'

// Editor-level guard tests (spec 02 §7 item 4): the SAME extensions + guard the
// backend compiler uses, exercised through a real mounted TipTap editor in
// jsdom. Model-level coverage lives in packages/certificate-html-template;
// here we prove the WIRING (NodeViews, guard registration, editable state).

function countLockedBlocks(editor: Editor): number {
  let count = 0
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'lockedBlock') count += 1
    return true
  })
  return count
}

async function mountEditor(options?: { editable?: boolean }): Promise<Editor> {
  const holder: { editor: Editor | null } = { editor: null }
  render(
    <CertificateEditor
      initialDocument={newWysiwygStarterDocument()}
      editable={options?.editable ?? true}
      immediatelyRender
      onEditorReady={(editor) => {
        holder.editor = editor
      }}
    />,
  )
  await waitFor(() => {
    if (!holder.editor) throw new Error('editor not ready')
  })
  const editor = holder.editor
  if (!editor) throw new Error('editor not ready')
  return editor
}

afterEach(() => {
  cleanup()
})

describe('CertificateEditor (jsdom)', () => {
  it('mounts with the starter document: 12 sealed locked-block views + toolbar', async () => {
    const editor = await mountEditor()
    expect(countLockedBlocks(editor)).toBe(12)
    await waitFor(() => {
      expect(document.querySelectorAll('[data-locked-block-view]').length).toBe(
        12,
      )
    })
    expect(screen.getByText('Tabela de resultados')).toBeDefined()
    expect(screen.getByRole('toolbar')).toBeDefined()
  })

  it('select-all + delete leaves every locked block in place', async () => {
    const editor = await mountEditor()
    editor.commands.selectAll()
    editor.commands.deleteSelection()
    expect(countLockedBlocks(editor)).toBe(12)
  })

  it('editable text still edits (title retitled), locked blocks intact', async () => {
    const editor = await mountEditor()
    // The starter opens with the masthead locked block; find the H1.
    let titlePos = -1
    let titleSize = 0
    editor.state.doc.descendants((node, pos) => {
      if (titlePos === -1 && node.type.name === 'heading') {
        titlePos = pos
        titleSize = node.content.size
      }
      return titlePos === -1
    })
    expect(titlePos).toBeGreaterThan(-1)
    editor.commands.setTextSelection({
      from: titlePos + 1,
      to: titlePos + 1 + titleSize,
    })
    editor.commands.insertContent('Certificado de Ensaio')
    let editedTitle = ''
    editor.state.doc.descendants((node) => {
      if (editedTitle === '' && node.type.name === 'heading') {
        editedTitle = node.textContent
      }
      return editedTitle === ''
    })
    expect(editedTitle).toBe('Certificado de Ensaio')
    expect(countLockedBlocks(editor)).toBe(12)
  })

  it('undo cannot resurrect a forbidden deletion (guard filters history too)', async () => {
    const editor = await mountEditor()
    editor.commands.selectAll()
    editor.commands.deleteSelection() // rejected wholesale
    editor.commands.undo()
    expect(countLockedBlocks(editor)).toBe(12)
    // the document is still schema-valid round-trip
    expect(editor.getJSON().type).toBe('doc')
  })

  it('pasting a copied locked block is rejected (exactly-once invariant)', async () => {
    const editor = await mountEditor()
    // simulate paste of a serialized locked block at the end of the document
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.insertContent({
      type: 'lockedBlock',
      attrs: { blockKey: 'results_table' },
    })
    expect(countLockedBlocks(editor)).toBe(12)
  })

  it('cut (NodeSelection + delete) of a locked block is rejected', async () => {
    const editor = await mountEditor()
    let lockedPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'lockedBlock' && lockedPos === -1) lockedPos = pos
      return true
    })
    expect(lockedPos).toBeGreaterThan(-1)
    editor.commands.setNodeSelection(lockedPos)
    editor.commands.deleteSelection()
    expect(countLockedBlocks(editor)).toBe(12)
  })

  it('boundary range deletes that swallow a locked block are rejected', async () => {
    const editor = await mountEditor()
    let lockedPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'lockedBlock' && lockedPos === -1) lockedPos = pos
      return true
    })
    editor.commands.deleteRange({
      from: Math.max(0, lockedPos - 1),
      to: lockedPos + 2,
    })
    expect(countLockedBlocks(editor)).toBe(12)
  })

  it('redo after a blocked deletion cannot smuggle it back', async () => {
    const editor = await mountEditor()
    editor.commands.selectAll()
    editor.commands.deleteSelection()
    editor.commands.undo()
    editor.commands.redo()
    expect(countLockedBlocks(editor)).toBe(12)
  })

  it('read-only mode renders without the toolbar', async () => {
    await mountEditor({ editable: false })
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  // ---- T17: preview fidelity ------------------------------------------------

  it('locked blocks render their REAL compiled certificate content (sample data)', async () => {
    await mountEditor()
    await waitFor(() => {
      expect(document.querySelectorAll('[data-locked-block-view]').length).toBe(
        12,
      )
    })
    const resultsBlock = document.querySelector(
      '[data-locked-block-view="results_table"] .cf-locked-block-view__body',
    )
    expect(resultsBlock?.innerHTML).toContain('Resultados da calibração')
    expect(resultsBlock?.innerHTML).toContain('Erro de indicação (10 kg)')
    expect(resultsBlock?.innerHTML).toContain('0,0001 kg')

    const customerBlock = document.querySelector(
      '[data-locked-block-view="customer_identification"] .cf-locked-block-view__body',
    )
    expect(customerBlock?.innerHTML).toContain('Indústria Cliente Exemplo S.A.')

    const uncertaintyBlock = document.querySelector(
      '[data-locked-block-view="uncertainty_statement"] .cf-locked-block-view__body',
    )
    expect(uncertaintyBlock?.innerHTML).toContain('k = 2')

    // letterhead logo + the REAL accreditation seal art render in the preview
    const labBlock = document.querySelector(
      '[data-locked-block-view="lab_identification"] .cf-locked-block-view__body',
    )
    expect(labBlock?.innerHTML).toContain('class="cf-lab-logo"')
    const sealBlock = document.querySelector(
      '[data-locked-block-view="accreditation_seal"] .cf-locked-block-view__body',
    )
    expect(sealBlock?.innerHTML).toContain('alt="Selo de acreditação"')
  })

  it('placeholder chips toggle between tokens and resolved sample values', async () => {
    const editor = await mountEditor()
    editor.commands.setTextSelection(2)
    editor.commands.insertContent({
      type: 'placeholder',
      attrs: { path: 'customer.name', label: 'Razão social' },
    })

    // editable drafts default to token view
    await waitFor(() => {
      const chip = document.querySelector(
        '[data-placeholder-path="customer.name"]',
      )
      expect(chip?.textContent).toBe('{{customer.name}}')
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'Ver com dados de exemplo' }),
    )
    await waitFor(() => {
      const chip = document.querySelector(
        '[data-placeholder-path="customer.name"]',
      )
      expect(chip?.textContent).toBe('Indústria Cliente Exemplo S.A.')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Ver campos' }))
    await waitFor(() => {
      const chip = document.querySelector(
        '[data-placeholder-path="customer.name"]',
      )
      expect(chip?.textContent).toBe('{{customer.name}}')
    })
  })

  it('read-only (published) views open in sample-data mode inside the A4 page frame', async () => {
    await mountEditor({ editable: false })
    expect(screen.getByRole('button', { name: 'Ver campos' })).toBeDefined()
    expect(document.querySelector('.cf-page')).not.toBeNull()
  })
})
