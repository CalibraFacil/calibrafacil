import { describe, expect, it } from 'vitest'

import { createSidebarScrollTapGuard } from './sidebar-scroll-tap-guard'

function guardWithClock(start = 0) {
  let time = start
  const guard = createSidebarScrollTapGuard(() => time)
  return {
    guard,
    advance(ms: number) {
      time += ms
    },
  }
}

describe('createSidebarScrollTapGuard', () => {
  it('does not suppress taps when no scroll has happened', () => {
    const { guard } = guardWithClock()
    expect(guard.shouldSuppressTap()).toBe(false)
  })

  it('suppresses a tap that lands right after a scroll event (tap-to-stop momentum)', () => {
    const { guard, advance } = guardWithClock()
    guard.noteScroll()
    advance(50)
    expect(guard.shouldSuppressTap()).toBe(true)
  })

  it('allows a tap once the list has been at rest', () => {
    const { guard, advance } = guardWithClock()
    guard.noteScroll()
    advance(500)
    expect(guard.shouldSuppressTap()).toBe(false)
  })

  it('keeps suppressing while scroll events keep arriving', () => {
    const { guard, advance } = guardWithClock()
    for (let i = 0; i < 10; i++) {
      guard.noteScroll()
      advance(16)
    }
    expect(guard.shouldSuppressTap()).toBe(true)
  })
})
