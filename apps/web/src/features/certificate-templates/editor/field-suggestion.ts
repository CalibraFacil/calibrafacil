import { Extension, type Editor, type Range } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'

import type { PlaceholderCatalogEntry } from '../types'
import { createSuggestPopup } from './suggest-popup'

/**
 * Inline `{{` placeholder autocomplete (shell reframe step 2, r1 pattern #1):
 * typing `{{` opens a filtered field list at the caret; Enter/click inserts
 * the TYPED placeholder atom (never plain text, so catalog validation and the
 * §7.8.4.3 bans still apply).
 *
 * The popup is PLAIN DOM driven by the Suggestion lifecycle — deliberately no
 * React (the repo bans useEffect, and Suggestion's imperative onStart/
 * onUpdate/onExit map cleanly onto direct DOM updates).
 */

export function filterFieldSuggestions(
  catalog: readonly PlaceholderCatalogEntry[],
  query: string,
): PlaceholderCatalogEntry[] {
  const normalized = query.trim().toLowerCase()
  const matches =
    normalized === ''
      ? [...catalog]
      : catalog.filter(
          (entry) =>
            entry.label.toLowerCase().includes(normalized) ||
            entry.path.toLowerCase().includes(normalized) ||
            entry.group.toLowerCase().includes(normalized),
        )
  return matches.slice(0, 8)
}

export type FieldSuggestionStorage = {
  getCatalog: () => readonly PlaceholderCatalogEntry[]
}

export const FieldSuggestion = Extension.create<
  Record<string, never>,
  FieldSuggestionStorage
>({
  name: 'fieldSuggestion',

  addStorage() {
    return { getCatalog: () => [] }
  },

  addProseMirrorPlugins() {
    const storage = this.storage
    const popup = createSuggestPopup<PlaceholderCatalogEntry>({
      testId: 'field-suggest-popup',
      toView: (entry) => ({
        title: entry.label,
        hint: `{{${entry.path}}}`,
      }),
    })

    return [
      Suggestion({
        pluginKey: new PluginKey('cfFieldSuggestion'),
        editor: this.editor,
        char: '{{',
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }) => filterFieldSuggestions(storage.getCatalog(), query),
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor
          range: Range
          props: PlaceholderCatalogEntry
        }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, {
              type: 'placeholder',
              attrs: { path: props.path, label: props.label },
            })
            .run()
        },
        render: () => popup,
      }),
    ]
  },
})
