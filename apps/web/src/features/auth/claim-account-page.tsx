import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { labAuthClient, useSession } from '@calibra-facil/auth/client'
import { translateAuthErrorMessage } from '@calibra-facil/auth/error-messages'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { BrandLockup } from '@/components/brand'
import {
  AuthStatusMessage,
  type AuthStatus,
} from '@/components/auth-status-message'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@/components/ui/input-otp'
import { Spinner } from '@/components/ui/spinner'
import { calibraApi } from '@/utils/api'
import { startDesktopInitialSync } from '@/components/sign-in-form'
import { cn } from '@/lib/utils'
import { useMountEffect } from '@/hooks/use-mount-effect'

type ClaimCompleteResponse = {
  claimed: boolean
  organizationId: string
  needsOnboarding: boolean
}

type ClaimAccountPageProps = {
  token?: string
  error?: string
}

function isWebAuthnSupported() {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'PublicKeyCredential' in window
  )
}

function statusMessage(status: string | undefined) {
  if (status === 'expired') {
    return 'Este link de acesso expirou. Solicite um novo link ao responsável pelo convite.'
  }

  if (status === 'consumed') {
    return 'Este link de acesso já foi utilizado.'
  }

  if (status === 'email_mismatch') {
    return 'Este link pertence a outro email. Solicite um novo link para a conta correta.'
  }

  if (status === 'invitation_invalid') {
    return 'Este convite não está mais disponível. Solicite um novo convite.'
  }

  if (status === 'membership_missing') {
    return 'Este acesso ainda não está vinculado ao laboratório. Solicite um novo link.'
  }

  if (status === 'organization_invalid' || status === 'user_invalid') {
    return 'Não foi possível validar os dados deste acesso. Solicite um novo link.'
  }

  return 'Este link de acesso é inválido.'
}

export function ClaimAccountPage({ token, error }: ClaimAccountPageProps) {
  const navigate = useNavigate()
  const sessionQuery = useSession()
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(
    error
      ? {
          tone: 'error',
          title: translateAuthErrorMessage(
            error,
            'Falha ao configurar acesso.',
          ),
        }
      : null,
  )
  const [otp, setOtp] = useState('')
  const [otpRequested, setOtpRequested] = useState(false)
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false)
  const [isMagicLinkLoading, setIsMagicLinkLoading] = useState(false)
  const [isOtpRequesting, setIsOtpRequesting] = useState(false)
  const [isOtpSigningIn, setIsOtpSigningIn] = useState(false)

  const setupQuery = useQuery({
    queryKey: ['lab-setup', token],
    queryFn: () => calibraApi.labSetup.get(token ?? ''),
    enabled: Boolean(token),
    retry: false,
  })

  const metadata = setupQuery.data
  const webAuthnSupported = isWebAuthnSupported()
  const hasAuthenticatedSession = Boolean(sessionQuery.data?.user)
  const shouldCompleteAuthenticatedClaim =
    hasAuthenticatedSession && !isPasskeyLoading && !isOtpSigningIn

  async function finishClaim() {
    if (!token) return

    const result =
      await calibraApi.labSetup.complete<ClaimCompleteResponse>(token)

    startDesktopInitialSync()
    navigate({
      to: result.needsOnboarding ? '/onboarding/organization' : '/dashboard',
    })
  }

  async function handleCreatePasskey() {
    if (!token) return
    if (!webAuthnSupported) {
      setAuthStatus({
        tone: 'info',
        title: 'Passkey indisponível neste navegador',
        description:
          'Use link mágico ou código por email para concluir o acesso.',
      })
      return
    }

    setAuthStatus(null)
    setIsPasskeyLoading(true)

    try {
      // No authenticatorAttachment: let the OS offer every option so platform
      // authenticators AND password managers (1Password, Bitwarden) can register.
      const registration = await labAuthClient.passkey.addPasskey({
        name: 'CalibraFácil',
        context: token,
      })

      if (registration.error) {
        setAuthStatus({
          tone: 'error',
          title: translateAuthErrorMessage(
            registration.error.message,
            'Não foi possível criar a passkey.',
          ),
        })
        return
      }

      const signIn = await labAuthClient.signIn.passkey()

      if (signIn.error) {
        setAuthStatus({
          tone: 'info',
          title: translateAuthErrorMessage(
            signIn.error.message,
            'Passkey criada. Entre com a passkey para concluir o acesso.',
          ),
        })
        return
      }

      await finishClaim()
    } catch (err) {
      setAuthStatus({
        tone: 'error',
        title:
          err instanceof Error
            ? err.message
            : 'Não foi possível criar a passkey.',
      })
    } finally {
      setIsPasskeyLoading(false)
    }
  }

  async function handleMagicLink() {
    if (!token) return
    setAuthStatus(null)
    setIsMagicLinkLoading(true)

    try {
      await calibraApi.labSetup.requestMagicLink(token)
      setAuthStatus({
        tone: 'success',
        title: 'Link de acesso enviado',
        description: 'Enviamos um link de acesso para o email provisionado.',
      })
    } catch (err) {
      setAuthStatus({
        tone: 'error',
        title:
          err instanceof Error ? err.message : 'Falha ao enviar link mágico.',
      })
    } finally {
      setIsMagicLinkLoading(false)
    }
  }

  async function handleRequestOtp() {
    if (!token) return
    setAuthStatus(null)
    setIsOtpRequesting(true)

    try {
      await calibraApi.labSetup.requestOtp(token)
      setOtpRequested(true)
      setAuthStatus({
        tone: 'success',
        title: 'Código enviado',
        description:
          'Digite o código de 6 dígitos recebido no email provisionado.',
      })
    } catch (err) {
      setAuthStatus({
        tone: 'error',
        title: err instanceof Error ? err.message : 'Falha ao enviar código.',
      })
    } finally {
      setIsOtpRequesting(false)
    }
  }

  async function handleOtpSignIn(event: React.FormEvent) {
    event.preventDefault()
    if (!metadata?.email) return
    setAuthStatus(null)
    setIsOtpSigningIn(true)

    try {
      const result = await labAuthClient.signIn.emailOtp({
        email: metadata.email,
        otp,
      })

      if (result.error) {
        setAuthStatus({
          tone: 'error',
          title: translateAuthErrorMessage(
            result.error.message,
            'Código inválido.',
          ),
        })
        return
      }

      await finishClaim()
    } catch (err) {
      setAuthStatus({
        tone: 'error',
        title: err instanceof Error ? err.message : 'Falha ao validar código.',
      })
    } finally {
      setIsOtpSigningIn(false)
    }
  }

  if (!token) {
    return <ClaimUnavailable message="Link de acesso não informado." />
  }

  if (setupQuery.isPending) {
    return (
      <ClaimShell>
        <Card>
          <CardHeader>
            <CardTitle>Carregando acesso</CardTitle>
            <CardDescription>
              Verificando o link de configuração.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Spinner />
          </CardContent>
        </Card>
      </ClaimShell>
    )
  }

  if (setupQuery.isError || metadata?.status !== 'ready') {
    return (
      <ClaimUnavailable
        message={statusMessage(metadata?.status)}
        detail={
          setupQuery.error instanceof Error ? setupQuery.error.message : null
        }
      />
    )
  }

  return (
    <ClaimShell>
      <Card>
        <CardHeader>
          <CardTitle>Configurar acesso</CardTitle>
          <CardDescription>
            {metadata.organizationName} preparou uma conta para {metadata.email}
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {authStatus ? <AuthStatusMessage status={authStatus} /> : null}

          {shouldCompleteAuthenticatedClaim ? (
            <AuthenticatedClaimCompletion
              onComplete={finishClaim}
              onError={(err) =>
                setAuthStatus({
                  tone: 'error',
                  title:
                    err instanceof Error
                      ? err.message
                      : 'Não foi possível concluir o acesso.',
                })
              }
            />
          ) : null}

          {!webAuthnSupported ? (
            <div className="rounded-md border p-3 text-sm text-muted-foreground">
              Este navegador não oferece passkeys neste contexto. Use um dos
              métodos por email abaixo.
            </div>
          ) : null}

          <FieldGroup>
            <Field>
              <Button
                type="button"
                onClick={handleCreatePasskey}
                disabled={isPasskeyLoading || !webAuthnSupported}
              >
                {isPasskeyLoading ? (
                  <>
                    <Spinner className="mr-2" />
                    Criando passkey...
                  </>
                ) : (
                  'Criar passkey e acessar'
                )}
              </Button>
            </Field>

            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleMagicLink}
                disabled={isMagicLinkLoading}
              >
                {isMagicLinkLoading ? (
                  <>
                    <Spinner className="mr-2" />
                    Enviando...
                  </>
                ) : (
                  'Receber link de acesso'
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleRequestOtp}
                disabled={isOtpRequesting}
              >
                {isOtpRequesting ? (
                  <>
                    <Spinner className="mr-2" />
                    Enviando...
                  </>
                ) : (
                  'Receber código'
                )}
              </Button>
            </div>

            {otpRequested ? (
              <form className="space-y-3" onSubmit={handleOtpSignIn}>
                <Field>
                  <FieldLabel htmlFor="claim-otp">Código recebido</FieldLabel>
                  <InputOTP
                    id="claim-otp"
                    maxLength={6}
                    pattern={REGEXP_ONLY_DIGITS}
                    value={otp}
                    onChange={setOtp}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    aria-label="Código recebido"
                    containerClassName="justify-center"
                    required
                  >
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                      <InputOTPSlot index={2} />
                    </InputOTPGroup>
                    <InputOTPSeparator />
                    <InputOTPGroup>
                      <InputOTPSlot index={3} />
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                </Field>
                <Button
                  type="submit"
                  disabled={isOtpSigningIn || otp.length < 6}
                >
                  {isOtpSigningIn ? 'Validando...' : 'Entrar com código'}
                </Button>
              </form>
            ) : null}
          </FieldGroup>
        </CardContent>
      </Card>
    </ClaimShell>
  )
}

function AuthenticatedClaimCompletion({
  onComplete,
  onError,
}: {
  onComplete: () => Promise<void>
  onError: (err: unknown) => void
}) {
  const [isCompleting, setIsCompleting] = useState(true)

  useMountEffect(() => {
    let isActive = true

    onComplete()
      .catch((err: unknown) => {
        if (isActive) onError(err)
      })
      .finally(() => {
        if (isActive) setIsCompleting(false)
      })

    return () => {
      isActive = false
    }
  })

  if (!isCompleting) return null

  return (
    <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
      <Spinner />
      Concluindo acesso...
    </div>
  )
}

function ClaimUnavailable({
  message,
  detail,
}: {
  message: string
  detail?: string | null
}) {
  return (
    <ClaimShell>
      <Card>
        <CardHeader>
          <CardTitle>Acesso indisponível</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        {detail ? (
          <CardContent>
            <div className="rounded-md border p-3 text-sm text-muted-foreground">
              {detail}
            </div>
          </CardContent>
        ) : null}
        <CardFooter>
          <Link to="/sign-in" className={cn(buttonVariants(), 'w-full')}>
            Ir para login
          </Link>
        </CardFooter>
      </Card>
    </ClaimShell>
  )
}

function ClaimShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-md space-y-6">
        <Link to="/" className="inline-flex items-center gap-2 font-medium">
          <BrandLockup markClassName="size-7" />
        </Link>
        {children}
      </div>
    </div>
  )
}
