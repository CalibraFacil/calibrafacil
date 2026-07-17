import type { Editor } from '@tiptap/react'
import {
  deriveResultGrids,
  type CertificateBlockLayout,
} from '@calibra-facil/certificate-html-template'

import { Checkbox } from '@/components/ui/checkbox'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { EDITOR_SAMPLE_DATA, LOCKED_BLOCK_LABELS } from './certificate-editor'

/**
 * Per-block configuration for the SELECTED locked block (reframe T24):
 * results_table — grid column visibility (template override, T22) + border
 * mode; metadata blocks — column count + density presets (T23). Writes the
 * closed layout envelope via updateAttributes; the guard allows attribute
 * changes (locked multiset unchanged), and the schema keeps it typed.
 */

const METADATA_BLOCKS = new Set([
  'certificate_identification',
  'lab_identification',
  'customer_identification',
  'item_identification',
  'method_traceability',
  'environmental_conditions',
])

type SelectedLockedBlock = {
  blockKey: string
  layout: CertificateBlockLayout
}

function selectedLockedBlock(
  editor: Editor | null,
): SelectedLockedBlock | null {
  if (!editor) return null
  const { selection } = editor.state
  const node = 'node' in selection ? selection.node : null
  if (
    !node ||
    typeof node !== 'object' ||
    Reflect.get(node, 'type')?.name !== 'lockedBlock'
  ) {
    return null
  }
  const attrs = Reflect.get(node, 'attrs') ?? {}
  const rawLayout = Reflect.get(attrs, 'layout')
  return {
    blockKey: String(Reflect.get(attrs, 'blockKey')),
    layout: rawLayout && typeof rawLayout === 'object' ? { ...rawLayout } : {},
  }
}

function writeLayout(editor: Editor, layout: CertificateBlockLayout) {
  const cleaned = Object.fromEntries(
    Object.entries(layout).filter(
      ([, value]) =>
        value !== undefined && !(Array.isArray(value) && value.length === 0),
    ),
  )
  editor
    .chain()
    .focus()
    .updateAttributes('lockedBlock', {
      layout: Object.keys(cleaned).length > 0 ? cleaned : null,
    })
    .run()
}

export function BlockInspector({ editor }: { editor: Editor | null }) {
  const selected = selectedLockedBlock(editor)
  if (!editor || !editor.isEditable || !selected) return null

  const label = LOCKED_BLOCK_LABELS[selected.blockKey] ?? selected.blockKey
  const isResults = selected.blockKey === 'results_table'
  const isMetadata = METADATA_BLOCKS.has(selected.blockKey)
  if (!isResults && !isMetadata) return null

  return (
    <div
      className="space-y-2.5 rounded-xl border p-3"
      data-testid="block-inspector"
    >
      <h2 className="text-sm font-semibold">{label}</h2>

      {isResults && (
        <ResultsGridControls editor={editor} layout={selected.layout} />
      )}

      {isMetadata && (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Colunas</span>
            <NativeSelect
              aria-label="Colunas do bloco"
              className="h-8 text-xs"
              value={String(selected.layout.columns ?? 1)}
              onChange={(event) => {
                const columns = Number(event.target.value)
                writeLayout(editor, {
                  ...selected.layout,
                  columns: columns > 1 ? columns : undefined,
                })
              }}
            >
              <NativeSelectOption value="1">1</NativeSelectOption>
              <NativeSelectOption value="2">2</NativeSelectOption>
              <NativeSelectOption value="3">3</NativeSelectOption>
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Densidade</span>
            <NativeSelect
              aria-label="Densidade do bloco"
              className="h-8 text-xs"
              value={selected.layout.density ?? 'normal'}
              onChange={(event) => {
                const density = event.target.value
                writeLayout(editor, {
                  ...selected.layout,
                  density: density === 'compact' ? 'compact' : undefined,
                })
              }}
            >
              <NativeSelectOption value="normal">Normal</NativeSelectOption>
              <NativeSelectOption value="compact">Compacta</NativeSelectOption>
            </NativeSelect>
          </label>
        </div>
      )}
    </div>
  )
}

function ResultsGridControls({
  editor,
  layout,
}: {
  editor: Editor
  layout: CertificateBlockLayout
}) {
  // Full column universe (ignoring current hides) so re-enabling is possible.
  const grids = deriveResultGrids(EDITOR_SAMPLE_DATA)
  const hidden = new Set(layout.hiddenColumns ?? [])

  return (
    <div className="space-y-2.5">
      <div>
        <div className="mb-1 text-xs text-muted-foreground">
          Colunas da tabela de pontos
        </div>
        <div className="flex flex-col gap-1">
          {grids.flatMap((grid) =>
            grid.columns.map((column) => (
              <label
                key={`${grid.tableKey}:${column.key}`}
                className="flex items-center gap-2 text-xs"
              >
                <Checkbox
                  checked={!hidden.has(column.key)}
                  aria-label={column.label}
                  onCheckedChange={(checked) => {
                    const next = new Set(hidden)
                    if (checked === true) next.delete(column.key)
                    else next.add(column.key)
                    writeLayout(editor, {
                      ...layout,
                      hiddenColumns: [...next].sort(),
                    })
                  }}
                />
                <span className="truncate">{column.label}</span>
                {column.unit && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    [{column.unit}]
                  </span>
                )}
              </label>
            )),
          )}
        </div>
      </div>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Bordas das tabelas</span>
        <NativeSelect
          aria-label="Bordas das tabelas"
          className="h-8 text-xs"
          value={layout.borders ?? 'theme'}
          onChange={(event) => {
            const borders = event.target.value
            writeLayout(editor, {
              ...layout,
              borders:
                borders === 'grid' || borders === 'rules' ? borders : undefined,
            })
          }}
        >
          <NativeSelectOption value="theme">
            Padrão do registro
          </NativeSelectOption>
          <NativeSelectOption value="grid">Grade completa</NativeSelectOption>
          <NativeSelectOption value="rules">Somente réguas</NativeSelectOption>
        </NativeSelect>
      </label>
    </div>
  )
}
