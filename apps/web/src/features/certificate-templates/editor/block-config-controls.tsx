import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import {
  deriveResultGrids,
  type CertificateBlockLayout,
} from '@calibra-facil/certificate-html-template'

import { Checkbox } from '@/components/ui/checkbox'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { EDITOR_SAMPLE_DATA, LOCKED_BLOCK_LABELS } from './editor-sample-data'

/**
 * Shared per-block/per-band configuration controls. Rendered in TWO hosts:
 * the in-context popover anchored to the selected block (primary surface) and
 * the sidebar BlockInspector (orientation/fallback). One implementation, two
 * mounts — never fork these.
 *
 * IMPORTANT: mutation handlers must NOT call editor.chain().focus() —
 * refocusing the ProseMirror contentEditable would dismiss the non-modal
 * popover on every toggle. Attribute updates apply without editor focus.
 */

export const METADATA_BLOCKS = new Set([
  'certificate_identification',
  'lab_identification',
  'customer_identification',
  'item_identification',
  'method_traceability',
  'environmental_conditions',
])

/** Placement-preset selects (M-C): value '' = the block's default position. */
export const PLACEMENT_BLOCKS: Record<
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

export const BAND_LABELS: Record<string, string> = {
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

/**
 * FRESH-STATE readers: config bodies never trust snapshot props — the popover
 * can outlive several transactions, and a stale snapshot made sequential
 * toggles resurrect the previous edit (prod bug). blockKeys and band type
 * names are unique in a document, so lookup by key is unambiguous.
 */
export function findLockedBlockLayout(
  editor: Editor,
  blockKey: string,
): CertificateBlockLayout {
  let layout: CertificateBlockLayout = {}
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'lockedBlock' && node.attrs.blockKey === blockKey) {
      const rawLayout = node.attrs.layout
      layout =
        rawLayout && typeof rawLayout === 'object' ? { ...rawLayout } : {}
      return false
    }
    return true
  })
  return layout
}

export function findBandAttrs(
  editor: Editor,
  typeName: string,
): Record<string, unknown> {
  let attrs: Record<string, unknown> = {}
  editor.state.doc.descendants((node) => {
    if (node.type.name === typeName) {
      attrs = { ...node.attrs }
      return false
    }
    return true
  })
  return attrs
}

/** Does this locked block have anything to configure? Drives the pill. */
export function lockedBlockHasConfig(blockKey: string): boolean {
  return (
    blockKey === 'results_table' ||
    METADATA_BLOCKS.has(blockKey) ||
    blockKey in PLACEMENT_BLOCKS
  )
}

export function readBlockLayout(
  attrs: Record<string, unknown>,
): CertificateBlockLayout {
  const rawLayout = attrs.layout
  return rawLayout && typeof rawLayout === 'object' ? { ...rawLayout } : {}
}

function writeLayout(editor: Editor, layout: CertificateBlockLayout) {
  const cleaned = Object.fromEntries(
    Object.entries(layout).filter(
      ([, value]) =>
        value !== undefined && !(Array.isArray(value) && value.length === 0),
    ),
  )
  editor.commands.updateAttributes('lockedBlock', {
    layout: Object.keys(cleaned).length > 0 ? cleaned : null,
  })
}

export function LockedBlockConfigBody({
  editor,
  blockKey,
}: {
  editor: Editor
  blockKey: string
}) {
  // Re-render after every mutation so controlled controls track the doc even
  // when the hosting NodeView/panel does not re-render (prod stale-toggle bug).
  const [, bump] = useState(0)
  const layout = findLockedBlockLayout(editor, blockKey)
  const write = (next: CertificateBlockLayout) => {
    writeLayout(editor, next)
    bump((tick) => tick + 1)
  }
  const isResults = blockKey === 'results_table'
  const isMetadata = METADATA_BLOCKS.has(blockKey)
  const placement = PLACEMENT_BLOCKS[blockKey]

  return (
    <div className="space-y-2.5">
      {placement && (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{placement.label}</span>
          <NativeSelect
            size="sm"
            aria-label={placement.label}
            className="text-xs"
            value={layout.preset ?? ''}
            onChange={(event) => {
              const preset = event.target.value
              write({
                ...layout,
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

      {blockKey === 'lab_identification' && (
        <Link
          to="/dashboard/settings/organization"
          className="block text-xs text-primary underline-offset-2 hover:underline"
        >
          Editar logo e dados do laboratório →
        </Link>
      )}

      {isResults && <ResultsGridControls layout={layout} write={write} />}

      {isMetadata && (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Colunas</span>
            <NativeSelect
              size="sm"
              aria-label="Colunas do bloco"
              className="text-xs"
              value={String(layout.columns ?? 1)}
              onChange={(event) => {
                const columns = Number(event.target.value)
                write({
                  ...layout,
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
              size="sm"
              aria-label="Densidade do bloco"
              className="text-xs"
              value={layout.density ?? 'normal'}
              onChange={(event) => {
                const density = event.target.value
                write({
                  ...layout,
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

export function BandConfigBody({
  editor,
  typeName,
}: {
  editor: Editor
  typeName: string
}) {
  const [, bump] = useState(0)
  const attrs = findBandAttrs(editor, typeName)
  const patch = (patchAttrs: Record<string, unknown>) => {
    editor.commands.updateAttributes(typeName, patchAttrs)
    bump((tick) => tick + 1)
  }
  const toggles = BAND_TOGGLES[typeName] ?? []
  const slots = BAND_SLOTS[typeName] ?? []
  const enabled = attrs.enabled === true
  return (
    <div className="space-y-2.5">
      <p className="text-xs text-pretty text-muted-foreground">
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
                patch({ [attr]: checked === true })
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
                size="sm"
                aria-label={label}
                className="text-xs"
                value={
                  typeof attrs[attr] === 'string' ? String(attrs[attr]) : ''
                }
                onChange={(event) => {
                  const slot = event.target.value
                  patch({ [attr]: slot === '' ? null : slot })
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
  layout,
  write,
}: {
  layout: CertificateBlockLayout
  write: (next: CertificateBlockLayout) => void
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
            <label key={dedupeKey} className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={!hidden.has(column.key)}
                aria-label={column.label}
                onCheckedChange={(checked) => {
                  const next = new Set(hidden)
                  if (checked === true) next.delete(column.key)
                  else next.add(column.key)
                  write({
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
          size="sm"
          aria-label="Bordas das tabelas"
          className="text-xs"
          value={layout.borders ?? 'theme'}
          onChange={(event) => {
            const borders = event.target.value
            write({
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

export { LOCKED_BLOCK_LABELS }
