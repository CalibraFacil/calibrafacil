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
