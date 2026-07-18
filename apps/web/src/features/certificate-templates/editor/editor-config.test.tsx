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

  it('band slots: moving the certificate number to the left re-renders the lane (M-C)', async () => {
    const editor = await mountWithInspector()
    editor.commands.setNodeSelection(findBandPos(editor, 'bandTopIdentity'))
    await waitFor(() => {
      expect(screen.getByTestId('band-inspector')).toBeDefined()
    })
    fireEvent.change(screen.getByLabelText('Posição do número'), {
      target: { value: 'left' },
    })
    await waitFor(() => {
      const json = editor.getJSON()
      const band = Array.isArray(json.content) ? json.content[0] : null
      expect(band?.attrs?.certificateNumberSlot).toBe('left')
    })
    expect(validateCertificateDocument(editor.getJSON()).ok).toBe(true)
    await waitFor(() => {
      const lane = document.querySelector(
        '[data-band-view="bandTopIdentity"] .cf-band-left',
      )
      expect(lane?.innerHTML).toContain('cf-band-cert')
    })
  })

  it('placement preset: seal position select writes layout.preset and the preview follows (M-C)', async () => {
    const editor = await mountWithInspector()
    editor.commands.setNodeSelection(
      findLockedPos(editor, 'accreditation_seal'),
    )
    await waitFor(() => {
      expect(screen.getByTestId('block-inspector')).toBeDefined()
    })
    fireEvent.change(screen.getByLabelText('Posição do selo'), {
      target: { value: 'seal-center' },
    })
    await waitFor(() => {
      const layout = blockLayout(editor, 'accreditation_seal')
      expect(
        layout && typeof layout === 'object'
          ? Reflect.get(layout, 'preset')
          : null,
      ).toBe('seal-center')
    })
    expect(validateCertificateDocument(editor.getJSON()).ok).toBe(true)
    await waitFor(() => {
      const body = document.querySelector(
        '[data-locked-block-view="accreditation_seal"] .cf-locked-block-view__body',
      )
      expect(body?.innerHTML).toContain('cf-preset-seal-center')
    })
  })

  it('merging table cells writes bounded colspans and the document stays valid (M-C)', async () => {
    const editor = await mountWithInspector()
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false })
    // collect the first row's two cell positions
    const cellPositions: number[] = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') cellPositions.push(pos)
      return true
    })
    expect(cellPositions.length).toBeGreaterThanOrEqual(2)
    editor.commands.setCellSelection({
      anchorCell: cellPositions[0]!,
      headCell: cellPositions[1]!,
    })
    expect(editor.commands.mergeCells()).toBe(true)
    const json = editor.getJSON()
    expect(JSON.stringify(json)).toContain('"colspan":2')
    expect(validateCertificateDocument(json).ok).toBe(true)
  })

  it('in-context config: the pill opens a popover on the block and edits apply without closing it', async () => {
    const editor = await mountWithInspector()
    const pill = screen.getByRole('button', {
      name: 'Configurar Tabela de resultados',
    })
    fireEvent.click(pill)
    await waitFor(() => {
      expect(screen.getByTestId('block-config-popover')).toBeDefined()
    })
    // opening the popover selected the block (sidebar + outline stay in sync)
    const selection = editor.state.selection
    const selectedNode = 'node' in selection ? selection.node : null
    expect(
      selectedNode && typeof selectedNode === 'object'
        ? Reflect.get(Reflect.get(selectedNode, 'attrs') ?? {}, 'blockKey')
        : null,
    ).toBe('results_table')
    // toggle a column INSIDE the popover — the edit applies and the popover
    // must survive (mutation handlers no longer refocus the editor)
    const popover = screen.getByTestId('block-config-popover')
    const checkbox = within(popover).getByLabelText('Indicação como recebido')
    fireEvent.click(checkbox)
    await waitFor(() => {
      const layout = blockLayout(editor, 'results_table')
      expect(
        layout && typeof layout === 'object'
          ? Reflect.get(layout, 'hiddenColumns')
          : null,
      ).toEqual(['leitura_antes'])
    })
    expect(screen.getByTestId('block-config-popover')).toBeDefined()
    expect(validateCertificateDocument(editor.getJSON()).ok).toBe(true)
  })

  it('band lanes expose the same in-context pill', async () => {
    await mountWithInspector()
    fireEvent.click(
      screen.getByRole('button', { name: 'Configurar Identificação no topo' }),
    )
    await waitFor(() => {
      const popover = screen.getByTestId('block-config-popover')
      expect(
        within(popover).getByRole('checkbox', { name: 'Acreditação em texto' }),
      ).toBeDefined()
    })
  })

  it('blocks with nothing to configure show no pill', async () => {
    await mountWithInspector()
    expect(
      screen.queryByRole('button', { name: 'Configurar QR de verificação' }),
    ).toBeNull()
  })

  it('optional blocks: toolbar insert adds the annex once; duplicate insert is a no-op', async () => {
    const editor = await mountWithInspector()
    fireEvent.click(screen.getByRole('button', { name: 'Inserir bloco' }))
    const item = await screen.findByText('Balanço de incertezas (anexo)')
    fireEvent.click(item)
    await waitFor(() => {
      const json = editor.getJSON()
      const count = (json.content ?? []).filter(
        (node) => node.attrs?.blockKey === 'uncertainty_budget_annex',
      ).length
      expect(count).toBe(1)
    })
    expect(validateCertificateDocument(editor.getJSON()).ok).toBe(true)
    // second insert: rejected by the guard (at-most-one)
    editor.commands.insertContent({
      type: 'lockedBlock',
      attrs: { blockKey: 'uncertainty_budget_annex' },
    })
    const json = editor.getJSON()
    expect(
      (json.content ?? []).filter(
        (node) => node.attrs?.blockKey === 'uncertainty_budget_annex',
      ).length,
    ).toBe(1)
    // and deleting it again is allowed (optional, not mandatory)
    let pos = -1
    editor.state.doc.descendants((node, nodePos) => {
      if (pos === -1 && node.attrs?.blockKey === 'uncertainty_budget_annex') {
        pos = nodePos
      }
      return pos === -1
    })
    editor.commands.setNodeSelection(pos)
    editor.commands.deleteSelection()
    expect(
      (editor.getJSON().content ?? []).filter(
        (node) => node.attrs?.blockKey === 'uncertainty_budget_annex',
      ).length,
    ).toBe(0)
    expect(validateCertificateDocument(editor.getJSON()).ok).toBe(true)
  })

  it('sequential popover toggles accumulate and re-checking un-hides (stale-state regression)', async () => {
    const editor = await mountWithInspector()
    fireEvent.click(
      screen.getByRole('button', { name: 'Configurar Tabela de resultados' }),
    )
    const popover = await screen.findByTestId('block-config-popover')
    fireEvent.click(within(popover).getByLabelText('Indicação como recebido'))
    await waitFor(() => {
      const layout = blockLayout(editor, 'results_table')
      expect(
        layout && typeof layout === 'object'
          ? Reflect.get(layout, 'hiddenColumns')
          : null,
      ).toEqual(['leitura_antes'])
    })
    // second toggle must ACCUMULATE, not resurrect the first
    fireEvent.click(within(popover).getByLabelText('Indicação como deixado'))
    await waitFor(() => {
      const layout = blockLayout(editor, 'results_table')
      expect(
        layout && typeof layout === 'object'
          ? Reflect.get(layout, 'hiddenColumns')
          : null,
      ).toEqual(['leitura_antes', 'leitura_apos'])
    })
    // re-checking un-hides (was permanently stuck with the stale snapshot)
    fireEvent.click(within(popover).getByLabelText('Indicação como recebido'))
    await waitFor(() => {
      const layout = blockLayout(editor, 'results_table')
      expect(
        layout && typeof layout === 'object'
          ? Reflect.get(layout, 'hiddenColumns')
          : null,
      ).toEqual(['leitura_apos'])
    })
    expect(validateCertificateDocument(editor.getJSON()).ok).toBe(true)
  })

  it('optional blocks show a remove affordance instead of the padlock', async () => {
    const editor = await mountWithInspector()
    editor.commands.insertContent({
      type: 'lockedBlock',
      attrs: { blockKey: 'uncertainty_budget_annex' },
    })
    const remove = await screen.findByRole('button', {
      name: 'Remover Balanço de incertezas (anexo)',
    })
    const view = document.querySelector(
      '[data-locked-block-view="uncertainty_budget_annex"]',
    )
    expect(view?.querySelector('.cf-locked-block-view__lock')).toBeNull()
    fireEvent.click(remove)
    await waitFor(() => {
      expect(
        (editor.getJSON().content ?? []).filter(
          (node) => node.attrs?.blockKey === 'uncertainty_budget_annex',
        ).length,
      ).toBe(0)
    })
    expect(validateCertificateDocument(editor.getJSON()).ok).toBe(true)
  })

  it('validation issues render as inline badges on the offending block (step 3)', async () => {
    const holder: { editor: Editor | null } = { editor: null }
    function Harness() {
      return (
        <CertificateEditor
          initialDocument={newWysiwygStarterDocument()}
          issues={[
            { path: 'content.8.attrs', message: 'problema no bloco de resultados' },
          ]}
          immediatelyRender
          onEditorReady={(editor) => {
            holder.editor = editor
          }}
        />
      )
    }
    render(<Harness />)
    await waitFor(() => {
      if (!holder.editor) throw new Error('editor not ready')
    })
    const badge = await screen.findByTestId('block-issue-badge')
    expect(badge.textContent).toBe('1')
    const owner = badge.closest('[data-locked-block-view]')
    expect(owner?.getAttribute('data-locked-block-view')).toBe('results_table')
  })

  it('selection dock names the selected block and opens its ConfigPill (step 4)', async () => {
    const editor = await mountWithInspector()
    editor.commands.setNodeSelection(findLockedPos(editor, 'results_table'))
    const dock = await screen.findByTestId('selection-dock')
    expect(dock.textContent).toContain('Tabela de resultados')
    fireEvent.click(within(dock).getByRole('button', { name: 'Configurar' }))
    await waitFor(() => {
      expect(screen.getByTestId('block-config-popover')).toBeDefined()
    })
    // non-configurable selections show no Configurar action
    editor.commands.setNodeSelection(findLockedPos(editor, 'verification_qr'))
    await waitFor(() => {
      const qrDock = screen.getByTestId('selection-dock')
      expect(qrDock.textContent).toContain('QR de verificação')
      expect(
        within(qrDock).queryByRole('button', { name: 'Configurar' }),
      ).toBeNull()
    })
  })

  it('zoom shortcuts: Ctrl+= / Ctrl+- / Ctrl+0 step and reset (step 5)', async () => {
    await mountWithInspector()
    const proseMirror = document.querySelector('.ProseMirror')
    expect(proseMirror).not.toBeNull()
    fireEvent.keyDown(proseMirror!, { key: '=', ctrlKey: true })
    await waitFor(() => {
      expect(
        document.querySelector('.cf-editor__paper')?.getAttribute('data-zoom'),
      ).toBe('125')
    })
    fireEvent.keyDown(proseMirror!, { key: '0', ctrlKey: true })
    await waitFor(() => {
      expect(
        document.querySelector('.cf-editor__paper')?.getAttribute('data-zoom'),
      ).toBe('100')
    })
    fireEvent.keyDown(proseMirror!, { key: '-', ctrlKey: true })
    await waitFor(() => {
      expect(
        document.querySelector('.cf-editor__paper')?.getAttribute('data-zoom'),
      ).toBe('75')
    })
  })

  it('page-break ghosts toggle on and off (roadmap item 2)', async () => {
    await mountWithInspector()
    expect(document.querySelector('.cf-page--pagemarks')).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'Quebras de página (aproximadas)' }),
    )
    await waitFor(() => {
      expect(document.querySelector('.cf-page--pagemarks')).not.toBeNull()
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Quebras de página (aproximadas)' }),
    )
    await waitFor(() => {
      expect(document.querySelector('.cf-page--pagemarks')).toBeNull()
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
