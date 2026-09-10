// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCountdown } from './use-countdown'

function Probe({ seconds }: { seconds: number }) {
  const countdown = useCountdown()

  return (
    <div>
      <output>{countdown.secondsLeft}</output>
      <button type="button" onClick={() => countdown.start(seconds)}>
        start
      </button>
      <button type="button" onClick={countdown.reset}>
        reset
      </button>
    </div>
  )
}

function readSeconds() {
  return screen.getByRole('status').textContent
}

describe('useCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('starts at zero and only counts once started', () => {
    render(<Probe seconds={30} />)

    expect(readSeconds()).toBe('0')

    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    expect(readSeconds()).toBe('0')
  })

  it('counts whole seconds down to zero and stops there', () => {
    render(<Probe seconds={3} />)

    act(() => {
      screen.getByRole('button', { name: 'start' }).click()
    })
    expect(readSeconds()).toBe('3')

    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(readSeconds()).toBe('2')

    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(readSeconds()).toBe('0')

    // Never runs past zero, however long the tab stays open.
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(readSeconds()).toBe('0')
  })

  it('restarts from the new deadline when started again mid-count', () => {
    render(<Probe seconds={10} />)

    act(() => {
      screen.getByRole('button', { name: 'start' }).click()
      vi.advanceTimersByTime(4_000)
    })
    expect(readSeconds()).toBe('6')

    act(() => {
      screen.getByRole('button', { name: 'start' }).click()
    })
    expect(readSeconds()).toBe('10')
  })

  it('drops to zero on reset', () => {
    render(<Probe seconds={30} />)

    act(() => {
      screen.getByRole('button', { name: 'start' }).click()
    })
    expect(readSeconds()).toBe('30')

    act(() => {
      screen.getByRole('button', { name: 'reset' }).click()
      vi.advanceTimersByTime(2_000)
    })
    expect(readSeconds()).toBe('0')
  })

  it('stops ticking after unmount', () => {
    const { unmount } = render(<Probe seconds={30} />)

    act(() => {
      screen.getByRole('button', { name: 'start' }).click()
    })
    unmount()

    expect(() => {
      vi.advanceTimersByTime(30_000)
    }).not.toThrow()
    expect(vi.getTimerCount()).toBe(0)
  })
})
