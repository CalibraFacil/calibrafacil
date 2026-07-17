import { useState } from 'react'
import type { Editor } from '@tiptap/react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PlaceholderCatalogEntry } from '../types'
import { filterCatalog } from './forms'

/**
 * Catalog-driven placeholder insertion + inspector (spec 02 §6.2).
 * Insertion produces the TYPED placeholder node (atom) — never plain text —
 * so the compiler's catalog validation and the §7.8.4.3 bans always apply.
 */
export function PlaceholderPanel({
  editor,
  catalog,
}: {
  editor: Editor | null
  catalog: PlaceholderCatalogEntry[]
}) {
  const [query, setQuery] = useState('')
  const grouped = filterCatalog(catalog, query)
  const selected = selectedPlaceholderEntry(editor, catalog)

  return (
    <aside
      className="space-y-3 rounded-xl border p-3"
      aria-label="Campos do certificado"
    >
      <div>
        <h2 className="text-sm font-semibold">Campos do certificado</h2>
        <p className="text-xs text-muted-foreground">
          Clique para inserir no ponto do cursor. Valores são preenchidos na
          emissão.
        </p>
      </div>

      {selected && (
        <div
          className="space-y-1 rounded-lg border bg-muted/40 p-2 text-xs"
          data-testid="placeholder-inspector"
        >
          <div className="flex items-center gap-1.5">
            <span className="font-semibold">{selected.label}</span>
            {selected.required && <Badge variant="outline">obrigatório</Badge>}
          </div>
          <div className="font-mono">{`{{${selected.path}}}`}</div>
          <div className="text-muted-foreground">Origem: {selected.source}</div>
          <div className="text-muted-foreground">
            Tipo: {selected.type} · Formato: {selected.format}
          </div>
        </div>
      )}

      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Buscar campo…"
        aria-label="Buscar campo"
        className="h-8"
      />

      <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
        {grouped.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nenhum campo encontrado.
          </p>
        )}
        {grouped.map(({ group, entries }) => (
          <div key={group}>
            <div className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
              {group}
            </div>
            <div className="flex flex-col gap-px">
              {entries.map((entry) => (
                <Button
                  key={entry.path}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto w-full justify-start rounded-lg px-2 py-1.5 text-left transition-[transform,background-color] active:scale-[0.98]"
                  disabled={!editor || !editor.isEditable}
                  onClick={() => insertPlaceholder(editor, entry)}
                  title={entry.source}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="truncate text-xs font-medium leading-tight">
                      {entry.label}
                    </span>
                    <span className="truncate font-mono text-[10px] leading-tight text-muted-foreground">
                      {`{{${entry.path}}}`}
                    </span>
                  </span>
                  {entry.instrumentSpecific && (
                    <Badge
                      variant="outline"
                      className="ml-2 shrink-0 text-[9px] font-normal"
                    >
                      específico
                    </Badge>
                  )}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}

function insertPlaceholder(
  editor: Editor | null,
  entry: PlaceholderCatalogEntry,
) {
  if (!editor) return
  editor
    .chain()
    .focus()
    .insertContent({
      type: 'placeholder',
      attrs: { path: entry.path, label: entry.label },
    })
    .run()
}

/** The catalog entry of the currently-selected placeholder atom, if any. */
export function selectedPlaceholderEntry(
  editor: Editor | null,
  catalog: PlaceholderCatalogEntry[],
): PlaceholderCatalogEntry | null {
  if (!editor) return null
  const { selection } = editor.state
  const node = 'node' in selection ? selection.node : null
  if (
    !node ||
    typeof node !== 'object' ||
    Reflect.get(node, 'type')?.name !== 'placeholder'
  ) {
    return null
  }
  const path = String(Reflect.get(node, 'attrs')?.path ?? '')
  return catalog.find((entry) => entry.path === path) ?? null
}
