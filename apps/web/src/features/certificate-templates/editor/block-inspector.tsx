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

function selectedNode(editor: Editor | null): {
  typeName: string
  attrs: Record<string, unknown>
} | null {
  if (!editor) return null
  const { selection } = editor.state
  const node = 'node' in selection ? selection.node : null
  if (!node || typeof node !== 'object') return null
  const typeName = Reflect.get(node, 'type')?.name
  if (typeof typeName !== 'string') return null
  const attrs = Reflect.get(node, 'attrs')
  return {
    typeName,
    attrs: attrs && typeof attrs === 'object' ? { ...attrs } : {},
  }
}

function selectedLockedBlock(
  editor: Editor | null,
): SelectedLockedBlock | null {
  const node = selectedNode(editor)
  if (!node || node.typeName !== 'lockedBlock') return null
  const rawLayout = node.attrs.layout
  return {
    blockKey: String(node.attrs.blockKey),
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

/** Placement-preset selects (M-C): value '' = the block's default position. */
const PLACEMENT_BLOCKS: Record<
  string,
  { label: string; options: { value: string; label: string }[] }
> = {
  accreditation_seal: {
    label: 'Posição do selo',
    options: [
      { value: '', label: 'Direita (padrão)' },
      { value: 'seal-left', label: 'Esquerda' },
      { value: 'seal-center', label: 'Centro' },
    ],
  },
  lab_identification: {
    label: 'Posição do logo',
    options: [
      { value: '', label: 'Esquerda (padrão)' },
      { value: 'logo-right', label: 'Direita' },
      { value: 'logo-top', label: 'Topo, centralizado' },
    ],
  },
}

export function BlockInspector({ editor }: { editor: Editor | null }) {
  const node = selectedNode(editor)
  if (!editor || !editor.isEditable || !node) return null

  if (node.typeName === 'bandTopIdentity' || node.typeName === 'bandPageFooter') {
    return <BandInspector editor={editor} typeName={node.typeName} attrs={node.attrs} />
  }

  const selected = selectedLockedBlock(editor)
  if (!selected) return null

  const label = LOCKED_BLOCK_LABELS[selected.blockKey] ?? selected.blockKey
  const isResults = selected.blockKey === 'results_table'
  const isMetadata = METADATA_BLOCKS.has(selected.blockKey)
  const placement = PLACEMENT_BLOCKS[selected.blockKey]
  if (!isResults && !isMetadata && !placement) return null

  return (
    <div
      className="space-y-2.5 rounded-xl border p-3"
      data-testid="block-inspector"
    >
      <h2 className="text-sm font-semibold">{label}</h2>

      {placement && (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{placement.label}</span>
          <NativeSelect
            aria-label={placement.label}
            className="h-8 text-xs"
            value={selected.layout.preset ?? ''}
            onChange={(event) => {
              const preset = event.target.value
              writeLayout(editor, {
                ...selected.layout,
                preset: preset === '' ? undefined : preset,
              })
            }}
          >
            {placement.options.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      )}

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

const BAND_LABELS: Record<string, string> = {
  bandTopIdentity: 'Identificação no topo',
  bandPageFooter: 'Rodapé do certificado',
}

const BAND_TOGGLES: Record<string, { attr: string; label: string }[]> = {
  bandTopIdentity: [
    { attr: 'enabled', label: 'Exibir faixa no topo' },
    { attr: 'showLabName', label: 'Nome do laboratório' },
    { attr: 'showCertificateNumber', label: 'Número do certificado' },
    { attr: 'showTitle', label: 'Título "Certificado de Calibração"' },
    { attr: 'showSealText', label: 'Acreditação em texto' },
  ],
  bandPageFooter: [
    { attr: 'enabled', label: 'Exibir identificação no rodapé' },
    { attr: 'showCertificateNumber', label: 'Número do certificado' },
    { attr: 'showLabName', label: 'Nome do laboratório' },
    { attr: 'showIssueDate', label: 'Data de emissão' },
  ],
}

/** Slot selects per band element (M-C). '' = the element's default slot. */
const BAND_SLOTS: Record<
  string,
  { attr: string; label: string; options: { value: string; label: string }[] }[]
> = {
  bandTopIdentity: [
    {
      attr: 'labNameSlot',
      label: 'Posição do nome',
      options: [
        { value: '', label: 'Esquerda (padrão)' },
        { value: 'right', label: 'Direita' },
      ],
    },
    {
      attr: 'certificateNumberSlot',
      label: 'Posição do número',
      options: [
        { value: '', label: 'Direita (padrão)' },
        { value: 'left', label: 'Esquerda' },
      ],
    },
    {
      attr: 'sealTextSlot',
      label: 'Posição da acreditação',
      options: [
        { value: '', label: 'Linha inferior (padrão)' },
        { value: 'left', label: 'Esquerda' },
        { value: 'right', label: 'Direita' },
      ],
    },
  ],
  bandPageFooter: [
    {
      attr: 'identitySide',
      label: 'Lado da identificação',
      options: [
        { value: '', label: 'Esquerda (padrão)' },
        { value: 'right', label: 'Direita' },
      ],
    },
  ],
}

function BandInspector({
  editor,
  typeName,
  attrs,
}: {
  editor: Editor
  typeName: string
  attrs: Record<string, unknown>
}) {
  const toggles = BAND_TOGGLES[typeName] ?? []
  const slots = BAND_SLOTS[typeName] ?? []
  const enabled = attrs.enabled === true
  return (
    <div
      className="space-y-2.5 rounded-xl border p-3"
      data-testid="band-inspector"
    >
      <h2 className="text-sm font-semibold">{BAND_LABELS[typeName]}</h2>
      <p className="text-xs text-muted-foreground">
        {typeName === 'bandPageFooter'
          ? 'Repete em todas as páginas. A numeração "Página X de Y" é obrigatória e sempre presente.'
          : 'Repete em todas as páginas, inclusive na primeira.'}
      </p>
      <div className="flex flex-col gap-1">
        {toggles.map(({ attr, label }) => (
          <label key={attr} className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={attrs[attr] === true}
              disabled={attr !== 'enabled' && !enabled}
              onCheckedChange={(checked) => {
                editor
                  .chain()
                  .focus()
                  .updateAttributes(typeName, { [attr]: checked === true })
                  .run()
              }}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      {enabled && slots.length > 0 && (
        <div className="grid gap-2">
          {slots.map(({ attr, label, options }) => (
            <label key={attr} className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">{label}</span>
              <NativeSelect
                aria-label={label}
                className="h-8 text-xs"
                value={typeof attrs[attr] === 'string' ? String(attrs[attr]) : ''}
                onChange={(event) => {
                  const slot = event.target.value
                  editor
                    .chain()
                    .focus()
                    .updateAttributes(typeName, {
                      [attr]: slot === '' ? null : slot,
                    })
                    .run()
                }}
              >
                {options.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          ))}
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
  // Phase-split grids repeat their shared columns (e.g. the nominal value) —
  // hiding is by column KEY across every grid, so dedupe the checkbox list.
  const grids = deriveResultGrids(EDITOR_SAMPLE_DATA)
  const seenColumns = new Set<string>()
  const columnRows = grids.flatMap((grid) =>
    grid.columns.flatMap((column) => {
      const dedupeKey = `${grid.tableKey}:${column.key}`
      if (seenColumns.has(dedupeKey)) return []
      seenColumns.add(dedupeKey)
      return [{ grid, column, dedupeKey }]
    }),
  )
  const hidden = new Set(layout.hiddenColumns ?? [])

  return (
    <div className="space-y-2.5">
      <div>
        <div className="mb-1 text-xs text-muted-foreground">
          Colunas da tabela de pontos
        </div>
        <div className="flex flex-col gap-1">
          {columnRows.map(({ column, dedupeKey }) => (
              <label
                key={dedupeKey}
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
          ))}
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
