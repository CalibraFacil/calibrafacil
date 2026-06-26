import { useState } from 'react'
import { toast } from 'sonner'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '@calibra-facil/auth/client'
import { FingerPrintIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
 * Discovery surface for passkeys: a slim, dismissible banner shown at the top of
 * the dashboard ONLY when the signed-in user has no passkey yet and the browser
 * supports WebAuthn. Creating one here (or signing in with it) clears the list
 * query and the banner self-hides.
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

  if (!webAuthnSupported || !userId || dismissed || !hasNoPasskey) {
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

  return (
    <Alert className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
          <HugeiconsIcon icon={FingerPrintIcon} className="size-5" />
        </span>
        <div className="space-y-0.5">
          <AlertTitle>Entre mais rápido com uma passkey</AlertTitle>
          <AlertDescription>
            Use Face ID, Touch ID ou seu gerenciador de senhas (1Password,
            Bitwarden) para entrar sem digitar senha nem código por email.
          </AlertDescription>
        </div>
      </div>
      <div className="flex items-center gap-2">
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
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={handleDismiss}
          disabled={addPasskey.isPending}
        >
          Agora não
        </Button>
      </div>
    </Alert>
  )
}
