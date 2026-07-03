/**
 * Opt-in on-device tracing for the mobile-sidebar dismissal bug.
 *
 * The sheet keeps closing mid-scroll on real iOS devices in ways desktop
 * touch emulation does not reproduce, so this records every relevant event
 * into a ring buffer that `SidebarDebugOverlay` renders on screen — the
 * device itself tells us which code path closed the sheet.
 *
 * Enable by visiting any page with `?sidebar-debug` in the URL (persists for
 * the browser session). Completely inert otherwise. Remove once the bug is
 * understood.
 */

type SidebarDebugEntry = {
  at: number
  msg: string
}

const MAX_ENTRIES = 40
const STORAGE_KEY = 'cf-sidebar-debug'

let entries: SidebarDebugEntry[] = []
const listeners = new Set<() => void>()

export function sidebarDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (new URLSearchParams(window.location.search).has('sidebar-debug')) {
      window.sessionStorage.setItem(STORAGE_KEY, '1')
    }
    return window.sessionStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function sidebarDebugLog(msg: string) {
  if (!sidebarDebugEnabled()) return
  entries = [...entries.slice(-(MAX_ENTRIES - 1)), { at: Date.now(), msg }]
  Reflect.set(window, '__sbdbg', entries)
  for (const listener of listeners) listener()
}

export function subscribeSidebarDebug(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getSidebarDebugEntries(): ReadonlyArray<SidebarDebugEntry> {
  return entries
}

export function describeEventTarget(target: EventTarget | null): string {
  if (!(target instanceof Element)) return String(target)
  const sidebarPart = target.closest('[data-sidebar]')
  const part =
    sidebarPart instanceof Element
      ? sidebarPart.getAttribute('data-sidebar')
      : null
  return `${target.tagName.toLowerCase()}${part ? `[${part}]` : ''}`
}
