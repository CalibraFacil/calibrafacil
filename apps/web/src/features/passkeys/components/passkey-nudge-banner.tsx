import { useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '@calibra-facil/auth/client'
import { Cancel01Icon, FingerPrintIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

import { passkeysQueryOptions, useAddPasskey } from '../queries'
import { defaultPasskeyName } from '../forms'
import { isWebAuthnSupported } from '../webauthn'

const DISMISS_KEY_PREFIX = 'cf:passkey-nudge-dismissed:'

function dismissKey(userId: string): string {
  return `${DISMISS_KEY_PREFIX}${userId}`
}

// Dismissal is scoped to the browser session and to the user id, so the nudge
// reappears on a new login session (and never leaks across users) until a
// passkey actually exists.
function readDismissed(userId: string): boolean {
  try {
    return window.sessionStorage.getItem(dismissKey(userId)) === '1'
  } catch {
    return false
  }
}

function writeDismissed(userId: string): void {
  try {
    window.sessionStorage.setItem(dismissKey(userId), '1')
  } catch {
    // Best-effort; if storage is unavailable the banner simply reappears.
  }
}

/**
 * Discovery surface for passkeys: a dismissible card that floats in the
 * bottom-right corner of the dashboard ONLY when the signed-in user has no
 * passkey yet and the browser supports WebAuthn. It is rendered through a portal
 * to <body> so it stays viewport-fixed regardless of layout/transform ancestors.
 * Creating a passkey here clears the list query and the card self-hides.
 */
export function PasskeyNudgeBanner() {
  const { data: session } = useSession()
  const userId = session?.user?.id
  const webAuthnSupported = isWebAuthnSupported()

  const passkeysQuery = useQuery({
    ...passkeysQueryOptions(),
    enabled: webAuthnSupported && Boolean(userId),
  })
  const addPasskey = useAddPasskey()

  const [locallyDismissed, setLocallyDismissed] = useState(false)
  const dismissed = locallyDismissed || (userId ? readDismissed(userId) : false)

  const hasNoPasskey =
    passkeysQuery.isSuccess && (passkeysQuery.data?.length ?? 0) === 0

  if (
    typeof document === 'undefined' ||
    !webAuthnSupported ||
    !userId ||
    dismissed ||
    !hasNoPasskey
  ) {
    return null
  }

  async function handleCreate() {
    try {
      await addPasskey.mutateAsync(defaultPasskeyName(new Date()))
      toast.success('Passkey criada com sucesso.')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Não foi possível criar a passkey.',
      )
    }
  }

  function handleDismiss() {
    if (userId) writeDismissed(userId)
    setLocallyDismissed(true)
  }

  return createPortal(
    <section
      aria-label="Configurar passkey"
      className="fixed bottom-4 right-4 z-50 w-[min(22rem,calc(100vw-2rem))] animate-in fade-in slide-in-from-bottom-4 duration-300"
    >
      <div className="rounded-xl border bg-background p-4 shadow-lg ring-1 ring-foreground/10">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
            <HugeiconsIcon icon={FingerPrintIcon} className="size-5" />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium leading-none">
              Entre mais rápido com uma passkey
            </p>
            <p className="text-sm text-muted-foreground">
              Use Face ID, Touch ID ou seu gerenciador de senhas para entrar sem
              senha.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Agora não"
            onClick={handleDismiss}
            disabled={addPasskey.isPending}
            className="-mr-1 -mt-1 shrink-0"
          >
            <HugeiconsIcon icon={Cancel01Icon} className="size-4" />
          </Button>
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={handleCreate}
            disabled={addPasskey.isPending}
          >
            {addPasskey.isPending ? (
              <>
                <Spinner className="mr-2" />
                Criando...
              </>
            ) : (
              'Criar passkey'
            )}
          </Button>
        </div>
      </div>
    </section>,
    document.body,
  )
}
