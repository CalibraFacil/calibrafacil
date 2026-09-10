// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

import {
  installHistoryShortcuts,
  isEditableTarget,
  matchHistoryShortcut,
  shortcutPlatformFor,
  type ShortcutEventLike,
} from './history-shortcuts'

function event(overrides: Partial<ShortcutEventLike> = {}): ShortcutEventLike {
  return {
    key: 'ArrowLeft',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    editableTarget: false,
    ...overrides,
  }
}

describe('matchHistoryShortcut on Windows and Linux', () => {
  it('matches Alt+Left and Alt+Right', () => {
    expect(matchHistoryShortcut(event({ altKey: true }), 'other')).toBe('back')
    expect(
      matchHistoryShortcut(event({ key: 'ArrowRight', altKey: true }), 'other'),
    ).toBe('forward')
  })

  it('ignores the arrow keys on their own', () => {
    expect(matchHistoryShortcut(event(), 'other')).toBeNull()
  })

  it('ignores extra modifiers, which are a different shortcut', () => {
    // Ctrl+Alt+Left switches workspace on several Linux desktops; matching it
    // loosely would fight the window manager.
    expect(
      matchHistoryShortcut(event({ altKey: true, ctrlKey: true }), 'other'),
    ).toBeNull()
    expect(
      matchHistoryShortcut(event({ altKey: true, metaKey: true }), 'other'),
    ).toBeNull()
    expect(
      matchHistoryShortcut(event({ altKey: true, shiftKey: true }), 'other'),
    ).toBeNull()
  })

  it('does not use the macOS binding', () => {
    expect(
      matchHistoryShortcut(event({ key: '[', metaKey: true }), 'other'),
    ).toBeNull()
  })
})

describe('matchHistoryShortcut on macOS', () => {
  it('matches Cmd+[ and Cmd+]', () => {
    expect(
      matchHistoryShortcut(event({ key: '[', metaKey: true }), 'mac'),
    ).toBe('back')
    expect(
      matchHistoryShortcut(event({ key: ']', metaKey: true }), 'mac'),
    ).toBe('forward')
  })

  it('does not use the Windows binding', () => {
    // Alt+Left is "previous word" on macOS too.
    expect(matchHistoryShortcut(event({ altKey: true }), 'mac')).toBeNull()
  })

  it('ignores extra modifiers', () => {
    expect(
      matchHistoryShortcut(
        event({ key: '[', metaKey: true, altKey: true }),
        'mac',
      ),
    ).toBeNull()
  })
})

describe('text editing always wins', () => {
  it.each(['mac', 'other'] as const)(
    'is inert while typing on %s',
    (platform) => {
      // Alt+Left is "previous word" in a text field; stealing it would make the
      // app feel broken in every form.
      const binding =
        platform === 'mac'
          ? event({ key: '[', metaKey: true, editableTarget: true })
          : event({ altKey: true, editableTarget: true })

      expect(matchHistoryShortcut(binding, platform)).toBeNull()
    },
  )
})

describe('isEditableTarget', () => {
  it('recognizes form fields', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(isEditableTarget(document.createElement(tag))).toBe(true)
    }
  })

  it('recognizes contenteditable regions', () => {
    const element = document.createElement('div')
    element.setAttribute('contenteditable', 'true')

    expect(isEditableTarget(element)).toBe(true)
  })

  it('recognizes a node inside a contenteditable region', () => {
    // The real case: a keystroke mid-paragraph reports the inner span, not
    // the editable container.
    const region = document.createElement('div')
    region.setAttribute('contenteditable', 'true')
    const inner = document.createElement('span')
    region.append(inner)

    expect(isEditableTarget(inner)).toBe(true)
  })

  it('is false for ordinary elements and for nothing', () => {
    expect(isEditableTarget(document.createElement('div'))).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })
})

describe('shortcutPlatformFor', () => {
  it('maps the host platform, not a sniffed user agent', () => {
    // The renderer's user agent is overridden by `buildDesktopUserAgent` and
    // carries no OS token at all, so sniffing it reported "other" on every
    // macOS build and installed the wrong bindings.
    expect(shortcutPlatformFor('darwin')).toBe('mac')
    expect(shortcutPlatformFor('win32')).toBe('other')
    expect(shortcutPlatformFor('linux')).toBe('other')
  })

  it('falls back to the non-mac convention when the host says nothing', () => {
    expect(shortcutPlatformFor(null)).toBe('other')
    expect(shortcutPlatformFor(undefined)).toBe('other')
    expect(shortcutPlatformFor('')).toBe('other')
  })
})

describe('installHistoryShortcuts', () => {
  function setup(platform: 'mac' | 'other' = 'other') {
    const navigation = { back: vi.fn(), forward: vi.fn() }
    const dispose = installHistoryShortcuts({
      navigator: navigation,
      platform,
      target: window,
    })

    return { navigation, dispose }
  }

  it('navigates back on the keyboard shortcut', () => {
    const { navigation, dispose } = setup()

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true }),
    )

    expect(navigation.back).toHaveBeenCalledOnce()
    dispose()
  })

  it('stops listening once disposed', () => {
    const { navigation, dispose } = setup()
    dispose()

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true }),
    )

    expect(navigation.back).not.toHaveBeenCalled()
  })

  it('responds to host mouse and trackpad gestures', () => {
    const navigation = { back: vi.fn(), forward: vi.fn() }
    const unsubscribe = vi.fn()
    const captured: Array<(command: string) => void> = []

    const dispose = installHistoryShortcuts({
      navigator: navigation,
      platform: 'other',
      target: null,
      bridge: {
        onHistoryCommand(next) {
          captured.push(next)
          return unsubscribe
        },
      },
    })

    const [emit] = captured
    emit?.('forward')
    expect(navigation.forward).toHaveBeenCalledOnce()

    // An unknown command must not be guessed at.
    emit?.('sideways')
    expect(navigation.back).not.toHaveBeenCalled()

    dispose()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
