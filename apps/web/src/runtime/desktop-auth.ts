import { authClient } from '@calibra-facil/auth/client'

import { calibraApi } from '@/utils/api'
import { isDesktopRuntime } from '@/runtime/desktop'

const DESKTOP_SIGNED_OUT_KEY = 'calibra-desktop:signed-out'
const DESKTOP_SESSION_CHECK_TTL_MS = 10_000

let localSessionCheck:
  | {
      checkedAt: number
      value: boolean
    }
  | undefined
let localSessionCheckPromise: Promise<boolean> | null = null

export async function hasDesktopSession() {
  if (!isDesktopRuntime()) return false

  if (isDesktopSignedOut()) return false

  if (await hasLocalSessionSnapshot()) {
    return true
  }

  return hasCloudSession()
}

export function markDesktopSignedOut() {
  if (!isDesktopRuntime() || typeof window === 'undefined') return
  resetDesktopSessionCheck()
  window.localStorage.setItem(DESKTOP_SIGNED_OUT_KEY, '1')
}

/**
 * Sign-out on the desktop also ends the offline access this device remembers
 * for the account: on a shared bench PC, the next person starting the app
 * offline must not land in the previous account's database. The queued work
 * stays on disk for that account's next online sign-in.
 */
export async function forgetDesktopOfflineAccess() {
  if (!isDesktopRuntime() || typeof window === 'undefined') return
  try {
    await window.calibraBridge?.forgetOfflineAccess?.()
  } catch (error) {
    console.error('[desktop] could not forget the offline access', error)
  }
}

export function clearDesktopSignedOut() {
  if (!isDesktopRuntime() || typeof window === 'undefined') return
  resetDesktopSessionCheck()
  window.localStorage.removeItem(DESKTOP_SIGNED_OUT_KEY)
}

function isDesktopSignedOut() {
  return (
    typeof window !== 'undefined' &&
    window.localStorage.getItem(DESKTOP_SIGNED_OUT_KEY) === '1'
  )
}

async function hasLocalSessionSnapshot() {
  const now = Date.now()
  if (
    localSessionCheck &&
    now - localSessionCheck.checkedAt < DESKTOP_SESSION_CHECK_TTL_MS
  ) {
    return localSessionCheck.value
  }

  localSessionCheckPromise ??= readLocalSessionSnapshot().finally(() => {
    localSessionCheckPromise = null
  })

  const value = await localSessionCheckPromise
  localSessionCheck = {
    checkedAt: Date.now(),
    value,
  }
  return value
}

async function readLocalSessionSnapshot() {
  try {
    const session = await calibraApi.sync.getSession()
    return Boolean(session.data?.user.id)
  } catch {
    return false
  }
}

function resetDesktopSessionCheck() {
  localSessionCheck = undefined
  localSessionCheckPromise = null
}

async function hasCloudSession() {
  try {
    const { data } = await authClient.getSession()
    return Boolean(data?.user.id)
  } catch {
    return false
  }
}
