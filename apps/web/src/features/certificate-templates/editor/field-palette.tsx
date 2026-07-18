import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import { HugeiconsIcon } from '@hugeicons/react'
import { PuzzleIcon } from '@hugeicons/core-free-icons'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { PlaceholderCatalogEntry } from '../types'
import { filterCatalog } from './forms'

/**
 * "Campos" command palette (shell reframe step 2): the catalog-driven
 * placeholder inserter, relocated from the retired sidebar panel into a
 * toolbar popover next to the caret's toolbar. Insertion produces the TYPED
 * placeholder node (atom) — never plain text — so the compiler's catalog
 * validation and the §7.8.4.3 bans always apply. The inline `{{` autocomplete
 * (field-suggestion.ts) covers the in-flow path; this palette is the
 * browsable/discoverable one.
 */
export function FieldPalette({
  editor,
  catalog,
}: {
  editor: Editor | null
  catalog: PlaceholderCatalogEntry[]
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const grouped = filterCatalog(catalog, query)

  const insert = (entry: PlaceholderCatalogEntry) => {
    if (!editor) return
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'placeholder',
        attrs: { path: entry.path, label: entry.label },
      })
      .run()
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Campos do certificado"
            title="Inserir campo do certificado (ou digite {{ no texto)"
            className="h-8 gap-1 px-2 text-xs transition-[transform,background-color] active:scale-[0.96]"
          >
            <HugeiconsIcon icon={PuzzleIcon} size={15} strokeWidth={1.8} />
            Campos
          </Button>
        }
      />
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-80 p-3"
        data-testid="field-palette"
      >
        <div>
          <h2 className="text-sm font-semibold">Campos do certificado</h2>
          <p className="text-xs text-pretty text-muted-foreground">
            Insere no ponto do cursor. Dica: digite{' '}
            <span className="font-mono">{'{{'}</span> no texto para buscar sem
            sair do teclado.
          </p>
        </div>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar campo…"
          aria-label="Buscar campo"
          className="h-8"
        />
        <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
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
                    onClick={() => insert(entry)}
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
      </PopoverContent>
    </Popover>
  )
}
