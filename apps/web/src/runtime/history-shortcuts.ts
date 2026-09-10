/**
 * Back/forward keyboard shortcuts for the desktop shell.
 *
 * The browser gives these for free; an Electron window with no menu bar does
 * not, so a user who drills into a job has no way back except the in-page
 * control.
 *
 * The hard part is *not* stealing keys that already mean something:
 *
 * - `Alt`+`ArrowLeft` is "previous word" in a text field on Linux and Windows,
 *   and `Cmd`+`[` may be indentation in an editor. So an event whose target is
 *   editable is left alone entirely.
 * - A shortcut carrying extra modifiers is a different shortcut. `Ctrl`+`Alt`+
 *   `ArrowLeft` is a workspace switcher on several Linux desktops; matching it
 *   loosely would fight the window manager.
 */

export type HistoryShortcut = 'back' | 'forward'

export type ShortcutEventLike = {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  /** `true` when the keystroke is going to a text field or editable region. */
  editableTarget: boolean
}

export function matchHistoryShortcut(
  event: ShortcutEventLike,
  platform: 'mac' | 'other',
): HistoryShortcut | null {
  // Typing wins, always.
  if (event.editableTarget) return null
  if (event.shiftKey) return null

  if (platform === 'mac') {
    // macOS convention, matching Safari and Finder.
    if (!event.metaKey || event.ctrlKey || event.altKey) return null
    if (event.key === '[') return 'back'
    if (event.key === ']') return 'forward'
    return null
  }

  // Windows and Linux convention.
  if (!event.altKey || event.ctrlKey || event.metaKey) return null
  if (event.key === 'ArrowLeft') return 'back'
  if (event.key === 'ArrowRight') return 'forward'

  return null
}

/**
 * Whether a keystroke is destined for something the user is typing into.
 *
 * Uses `closest` rather than inspecting the target directly, because a
 * keystroke inside a `contenteditable` region reports the *inner* node as the
 * target — a `<span>` mid-paragraph, not the editable container. Matching on
 * the attribute rather than `isContentEditable` also keeps this honest under
 * jsdom, which does not implement that property.
 */
const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [contenteditable=""]'

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false

  return target.closest(EDITABLE_SELECTOR) !== null
}

/**
 * Map the host's own platform string onto a keybinding convention.
 *
 * Deliberately *not* derived from `navigator.userAgent`: the Electron renderer
 * replaces it with `buildDesktopUserAgent`, whose value carries only
 * Mozilla/CalibraFácil/Chrome/Electron tokens and never `Macintosh`. Sniffing
 * it returned "other" on every macOS build, silently installing Alt+Arrow
 * instead of Cmd+[ / Cmd+].
 */
export function shortcutPlatformFor(
  hostPlatform: string | null | undefined,
): 'mac' | 'other' {
  return hostPlatform === 'darwin' ? 'mac' : 'other'
}

export type HistoryNavigator = {
  back(): void
  forward(): void
}

/**
 * Wires the shortcuts and the OS-level back/forward gestures (mouse thumb
 * buttons, trackpad swipe) that the host forwards. Returns an unsubscribe.
 */
export function installHistoryShortcuts({
  navigator: historyNavigator,
  platform,
  target = typeof window === 'undefined' ? null : window,
  bridge,
}: {
  navigator: HistoryNavigator
  platform: 'mac' | 'other'
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null
  bridge?: { onHistoryCommand(listener: (command: string) => void): () => void }
}) {
  const run = (command: HistoryShortcut) => {
    if (command === 'back') historyNavigator.back()
    else historyNavigator.forward()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const matched = matchHistoryShortcut(
      {
        key: event.key,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        editableTarget: isEditableTarget(event.target),
      },
      platform,
    )

    if (!matched) return

    event.preventDefault()
    run(matched)
  }

  target?.addEventListener('keydown', onKeyDown)
  const unsubscribeBridge = bridge?.onHistoryCommand((command) => {
    if (command === 'back' || command === 'forward') run(command)
  })

  return () => {
    target?.removeEventListener('keydown', onKeyDown)
    unsubscribeBridge?.()
  }
}
