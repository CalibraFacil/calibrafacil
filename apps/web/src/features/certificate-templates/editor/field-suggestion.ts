import { Extension, type Editor, type Range } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'

import type { PlaceholderCatalogEntry } from '../types'

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

type SuggestionPopup = {
  element: HTMLDivElement
  items: PlaceholderCatalogEntry[]
  selectedIndex: number
  command: (entry: PlaceholderCatalogEntry) => void
}

function renderPopupItems(popup: SuggestionPopup) {
  popup.element.innerHTML = ''
  if (popup.items.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'cf-field-suggest__empty'
    empty.textContent = 'Nenhum campo encontrado'
    popup.element.appendChild(empty)
    return
  }
  popup.items.forEach((entry, index) => {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'cf-field-suggest__item'
    if (index === popup.selectedIndex) {
      item.classList.add('cf-field-suggest__item--active')
    }
    const label = document.createElement('span')
    label.className = 'cf-field-suggest__label'
    label.textContent = entry.label
    const path = document.createElement('span')
    path.className = 'cf-field-suggest__path'
    path.textContent = `{{${entry.path}}}`
    item.appendChild(label)
    item.appendChild(path)
    item.addEventListener('mousedown', (event) => {
      // mousedown (not click): the editor must not lose focus first
      event.preventDefault()
      popup.command(entry)
    })
    popup.element.appendChild(item)
  })
}

function positionPopup(
  popup: SuggestionPopup,
  clientRect: (() => DOMRect | null) | null | undefined,
) {
  const rect = clientRect?.()
  if (!rect) return
  popup.element.style.left = `${rect.left}px`
  popup.element.style.top = `${rect.bottom + 4}px`
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
    let popup: SuggestionPopup | null = null

    return [
      Suggestion({
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
        render: () => ({
          onStart: (props) => {
            const element = document.createElement('div')
            element.className = 'cf-field-suggest'
            element.setAttribute('data-testid', 'field-suggest-popup')
            document.body.appendChild(element)
            popup = {
              element,
              items: props.items,
              selectedIndex: 0,
              command: (entry) => props.command(entry),
            }
            renderPopupItems(popup)
            positionPopup(popup, props.clientRect)
          },
          onUpdate: (props) => {
            if (!popup) return
            popup.items = props.items
            popup.selectedIndex = Math.min(
              popup.selectedIndex,
              Math.max(props.items.length - 1, 0),
            )
            popup.command = (entry) => props.command(entry)
            renderPopupItems(popup)
            positionPopup(popup, props.clientRect)
          },
          onKeyDown: (props) => {
            if (!popup) return false
            if (props.event.key === 'ArrowDown') {
              popup.selectedIndex =
                (popup.selectedIndex + 1) % Math.max(popup.items.length, 1)
              renderPopupItems(popup)
              return true
            }
            if (props.event.key === 'ArrowUp') {
              popup.selectedIndex =
                (popup.selectedIndex - 1 + Math.max(popup.items.length, 1)) %
                Math.max(popup.items.length, 1)
              renderPopupItems(popup)
              return true
            }
            if (props.event.key === 'Enter') {
              const entry = popup.items[popup.selectedIndex]
              if (entry) popup.command(entry)
              return true
            }
            if (props.event.key === 'Escape') {
              popup.element.remove()
              popup = null
              return true
            }
            return false
          },
          onExit: () => {
            popup?.element.remove()
            popup = null
          },
        }),
      }),
    ]
  },
})
