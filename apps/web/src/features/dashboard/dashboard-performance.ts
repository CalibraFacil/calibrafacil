export const DASHBOARD_LAYOUT_MOUNT_MARK = 'dashboard:layout:mount'
export const DASHBOARD_LAYOUT_READY_MARK = 'dashboard:layout:ready'
export const DASHBOARD_CONTEXT_START_MARK = 'dashboard:context:start'
export const DASHBOARD_CONTEXT_END_MARK = 'dashboard:context:end'

export function mark(name: string) {
  if (typeof window === 'undefined' || !window.performance) return
  window.performance.mark(name)
}

export function measure(name: string, startMark: string, endMark: string) {
  if (typeof window === 'undefined' || !window.performance) return

  try {
    window.performance.measure(name, startMark, endMark)
  } catch {
    // Marks may not exist in edge navigation cases.
  }
}
