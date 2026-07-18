/**
 * Shared plain-DOM popup for TipTap Suggestion instances ({{ fields and the
 * '/' slash menu). Imperative on purpose: Suggestion's onStart/onUpdate/
 * onExit lifecycle maps onto direct DOM updates with no React (the repo bans
 * useEffect and the popup outlives render cycles).
 */

export type SuggestItemView = {
  title: string
  hint?: string
}

export type SuggestPopupController<Item> = {
  onStart: (props: {
    items: Item[]
    command: (item: Item) => void
    clientRect?: (() => DOMRect | null) | null
  }) => void
  onUpdate: (props: {
    items: Item[]
    command: (item: Item) => void
    clientRect?: (() => DOMRect | null) | null
  }) => void
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
  onExit: () => void
}

export function createSuggestPopup<Item>({
  testId,
  toView,
}: {
  testId: string
  toView: (item: Item) => SuggestItemView
}): SuggestPopupController<Item> {
  let element: HTMLDivElement | null = null
  let items: Item[] = []
  let selectedIndex = 0
  let command: (item: Item) => void = () => undefined

  // Clicking anywhere outside the popup dismisses it — Suggestion's onExit
  // only fires on editor-state changes, so an outside click on non-editor
  // chrome would otherwise leave the menu stranded.
  const onOutsidePointerDown = (event: PointerEvent) => {
    if (!element) return
    if (event.target instanceof Node && element.contains(event.target)) return
    hide()
  }

  const hide = () => {
    element?.remove()
    element = null
    document.removeEventListener('pointerdown', onOutsidePointerDown, true)
  }

  const renderItems = () => {
    if (!element) return
    element.innerHTML = ''
    if (items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'cf-field-suggest__empty'
      empty.textContent = 'Nada encontrado'
      element.appendChild(empty)
      return
    }
    items.forEach((item, index) => {
      const view = toView(item)
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'cf-field-suggest__item'
      if (index === selectedIndex) {
        button.classList.add('cf-field-suggest__item--active')
      }
      const title = document.createElement('span')
      title.className = 'cf-field-suggest__label'
      title.textContent = view.title
      button.appendChild(title)
      if (view.hint) {
        const hint = document.createElement('span')
        hint.className = 'cf-field-suggest__path'
        hint.textContent = view.hint
        button.appendChild(hint)
      }
      button.addEventListener('mousedown', (event) => {
        // mousedown (not click): the editor must not lose focus first
        event.preventDefault()
        command(item)
      })
      element?.appendChild(button)
    })
  }

  const position = (clientRect?: (() => DOMRect | null) | null) => {
    const rect = clientRect?.()
    if (!rect || !element) return
    element.style.left = `${rect.left}px`
    element.style.top = `${rect.bottom + 4}px`
  }

  return {
    onStart: (props) => {
      element = document.createElement('div')
      element.className = 'cf-field-suggest'
      element.setAttribute('data-testid', testId)
      document.body.appendChild(element)
      document.addEventListener('pointerdown', onOutsidePointerDown, true)
      items = props.items
      selectedIndex = 0
      command = props.command
      renderItems()
      position(props.clientRect)
    },
    onUpdate: (props) => {
      items = props.items
      selectedIndex = Math.min(selectedIndex, Math.max(items.length - 1, 0))
      command = props.command
      renderItems()
      position(props.clientRect)
    },
    onKeyDown: ({ event }) => {
      if (!element) return false
      const count = Math.max(items.length, 1)
      if (event.key === 'ArrowDown') {
        selectedIndex = (selectedIndex + 1) % count
        renderItems()
        return true
      }
      if (event.key === 'ArrowUp') {
        selectedIndex = (selectedIndex - 1 + count) % count
        renderItems()
        return true
      }
      if (event.key === 'Enter') {
        const item = items[selectedIndex]
        if (item) command(item)
        return true
      }
      if (event.key === 'Escape') {
        hide()
        return true
      }
      return false
    },
    onExit: () => {
      hide()
    },
  }
}
