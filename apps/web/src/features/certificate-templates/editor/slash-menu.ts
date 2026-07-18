import { Extension, type Editor, type Range } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { OPTIONAL_BLOCK_KEYS } from '@calibra-facil/certificate-html-template'

import type { PlaceholderCatalogEntry } from '../types'
import { filterFieldSuggestions } from './field-suggestion'
import { createSuggestPopup } from './suggest-popup'

/**
 * Unified '/' slash menu (roadmap item 4, Notion idiom): one keyboard menu
 * for inserting content — optional blocks (only when absent), structural
 * nodes, and the top-matching certificate fields. Field entries insert the
 * TYPED placeholder atom, same as the {{ autocomplete.
 */

export type SlashMenuItem = {
  title: string
  hint?: string
  keywords: string
  run: (editor: Editor, range: Range) => void
}

const OPTIONAL_BLOCK_TITLES: Record<string, string> = {
  uncertainty_budget_annex: 'Balanço de incertezas (anexo)',
  decision_rule_statement: 'Regra de decisão',
}

function hasOptionalBlock(editor: Editor, blockKey: string): boolean {
  let found = false
  editor.state.doc.descendants((node) => {
    if (
      !found &&
      node.type.name === 'lockedBlock' &&
      node.attrs.blockKey === blockKey
    ) {
      found = true
    }
    return !found
  })
  return found
}

export function buildSlashMenuItems(
  editor: Editor,
  catalog: readonly PlaceholderCatalogEntry[],
  query: string,
): SlashMenuItem[] {
  const structural: SlashMenuItem[] = [
    ...(OPTIONAL_BLOCK_KEYS.filter(
      (blockKey) => !hasOptionalBlock(editor, blockKey),
    ).map((blockKey) => ({
      title: OPTIONAL_BLOCK_TITLES[blockKey] ?? blockKey,
      hint: 'bloco opcional',
      keywords: `${OPTIONAL_BLOCK_TITLES[blockKey] ?? ''} bloco opcional anexo incerteza decisão`,
      run: (runEditor: Editor, range: Range) => {
        runEditor
          .chain()
          .focus()
          .insertContentAt(range, {
            type: 'lockedBlock',
            attrs: { blockKey },
          })
          .run()
      },
    })) satisfies SlashMenuItem[]),
    {
      title: 'Tabela',
      hint: '2×2 com cabeçalho',
      keywords: 'tabela table grade',
      run: (runEditor, range) => {
        runEditor
          .chain()
          .focus()
          .deleteRange(range)
          .insertTable({ rows: 2, cols: 2, withHeaderRow: true })
          .run()
      },
    },
    {
      title: 'Título',
      hint: 'nível 2',
      keywords: 'título heading h2 seção',
      run: (runEditor, range) => {
        runEditor
          .chain()
          .focus()
          .deleteRange(range)
          .setNode('heading', { level: 2 })
          .run()
      },
    },
    {
      title: 'Subtítulo',
      hint: 'nível 3',
      keywords: 'subtítulo heading h3',
      run: (runEditor, range) => {
        runEditor
          .chain()
          .focus()
          .deleteRange(range)
          .setNode('heading', { level: 3 })
          .run()
      },
    },
    {
      title: 'Divisor',
      hint: 'linha horizontal',
      keywords: 'divisor divider linha hr separador',
      run: (runEditor, range) => {
        runEditor.chain().focus().deleteRange(range).setHorizontalRule().run()
      },
    },
  ]

  const normalized = query.trim().toLowerCase()
  const structuralMatches =
    normalized === ''
      ? structural
      : structural.filter(
          (item) =>
            item.title.toLowerCase().includes(normalized) ||
            item.keywords.toLowerCase().includes(normalized),
        )

  const fieldMatches: SlashMenuItem[] = filterFieldSuggestions(
    catalog,
    query,
  )
    .slice(0, 4)
    .map((entry) => ({
      title: entry.label,
      hint: `{{${entry.path}}}`,
      keywords: entry.path,
      run: (runEditor: Editor, range: Range) => {
        runEditor
          .chain()
          .focus()
          .insertContentAt(range, {
            type: 'placeholder',
            attrs: { path: entry.path, label: entry.label },
          })
          .run()
      },
    }))

  return [...structuralMatches, ...fieldMatches].slice(0, 9)
}

export type SlashMenuStorage = {
  getCatalog: () => readonly PlaceholderCatalogEntry[]
}

export const SlashMenu = Extension.create<
  Record<string, never>,
  SlashMenuStorage
>({
  name: 'slashMenu',

  addStorage() {
    return { getCatalog: () => [] }
  },

  addProseMirrorPlugins() {
    const storage = this.storage
    const extensionEditor = this.editor
    const popup = createSuggestPopup<SlashMenuItem>({
      testId: 'slash-menu-popup',
      toView: (item) => ({ title: item.title, hint: item.hint }),
    })

    return [
      Suggestion({
        pluginKey: new PluginKey('cfSlashMenu'),
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }) =>
          buildSlashMenuItems(extensionEditor, storage.getCatalog(), query),
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor
          range: Range
          props: SlashMenuItem
        }) => {
          props.run(editor, range)
        },
        render: () => popup,
      }),
    ]
  },
})
