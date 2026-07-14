import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Building03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import {
  backofficeSignIn,
  backofficeSignOut,
  labAuthClient,
  signIn,
} from '@calibra-facil/auth/client'
import { translateAuthErrorMessage } from '@calibra-facil/auth/error-messages'
import { calibraApi } from '@/utils/api'
import { useMountEffect } from '@/hooks/use-mount-effect'
import { clearDesktopSignedOut } from '@/runtime/desktop-auth'
import { getBackofficeAppUrl } from '@/app/config/runtime'
import { cn } from '@/lib/utils'
import {
  sanitizeBackofficeRedirect,
  sanitizeLabRedirect,
} from '@/lib/auth-redirect'
import {
  AuthStatusMessage,
  type AuthStatus,
} from '@/components/auth-status-message'
import { BrandMark } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@/components/ui/input-otp'
import { Separator } from '@/components/ui/separator'

interface SignInFormProps extends React.ComponentProps<'form'> {
  redirect?: string
  mode?: 'lab' | 'backoffice'
  onSwitchToSso?: () => void
}

export function SignInForm({
  className,
  redirect,
  mode = 'lab',
  onSwitchToSso,
  ...props
}: SignInFormProps) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isMagicLinkLoading, setIsMagicLinkLoading] = useState(false)
  const [isOtpRequesting, setIsOtpRequesting] = useState(false)
  const [isOtpSigningIn, setIsOtpSigningIn] = useState(false)
  const [otp, setOtp] = useState('')
  const [otpRequested, setOtpRequested] = useState(false)

  const isLabMode = mode === 'lab'
  const safeRedirect = isLabMode
    ? sanitizeLabRedirect(redirect)
    : sanitizeBackofficeRedirect(redirect)

  // Conditional-UI autofill: when the browser supports conditional mediation,
  // pre-arm a passkey request on mount so the email field (autoComplete
  // "username webauthn") surfaces saved passkeys / lets password managers fill.
  // This is what makes Apple, Google, 1Password and Bitwarden actually prompt on
  // page load. Best-effort: cancellations/absence of credentials are ignored.
  useMountEffect(() => {
    if (!isLabMode) return

    let isActive = true

    void (async () => {
      try {
        if (
          typeof window === 'undefined' ||
          !window.isSecureContext ||
          !window.PublicKeyCredential ||
          typeof window.PublicKeyCredential.isConditionalMediationAvailable !==
            'function'
        ) {
          return
        }

        const available =
          await window.PublicKeyCredential.isConditionalMediationAvailable()
        if (!isActive || !available) return

        const result = await labAuthClient.signIn.passkey({ autoFill: true })
        if (!isActive || !result || result.error) return

        clearDesktopSignedOut()
        startDesktopInitialSync()
        navigate({ to: safeRedirect })
      } catch {
        // Conditional UI is best-effort; ignore failures/cancellations.
      }
    })()

    return () => {
      isActive = false
    }
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isLabMode) {
      await handlePasskeySignIn()
      return
    }

    setAuthStatus(null)
    setIsLoading(true)

    try {
      const { error: signInError } = await backofficeSignIn.email({
        email,
        password,
      })

      if (signInError) {
        setAuthStatus({
          tone: 'error',
          title: translateAuthErrorMessage(
            signInError.message,
            'Não foi possível entrar. Verifique os dados e tente novamente.',
          ),
        })
        return
      }

      clearDesktopSignedOut()

      const access = await calibraApi.backoffice.getAccess()

      if (access.allowed) {
        window.location.assign(`${getBackofficeAppUrl()}${safeRedirect}`)
        return
      }

      if (access.bootstrapAvailable) {
        window.location.assign(`${getBackofficeAppUrl()}/bootstrap`)
        return
      }

      await backofficeSignOut()
      setAuthStatus({
        tone: 'error',
        title: 'Sua conta não possui acesso ao backoffice',
      })
    } catch {
      setAuthStatus({
        tone: 'error',
        title:
          'Não foi possível conectar ao servidor de autenticação. Verifique sua conexão e tente novamente.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  async function handlePasskeySignIn() {
    setAuthStatus(null)
    setIsLoading(true)

    try {
      const result = await labAuthClient.signIn.passkey()

      if (result.error) {
        setAuthStatus({
          tone: 'error',
          title: translateAuthErrorMessage(
            result.error.message,
            'Não foi possível entrar com passkey.',
          ),
        })
        return
      }

      clearDesktopSignedOut()
      startDesktopInitialSync()
      navigate({ to: safeRedirect })
    } catch {
      setAuthStatus({
        tone: 'error',
        title: 'Não foi possível entrar com passkey.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  async function handleMagicLinkSignIn() {
    setAuthStatus(null)
    setIsMagicLinkLoading(true)

    try {
      const callbackURL = `${window.location.origin}${safeRedirect}`
      const { error: magicLinkError } = await signIn.magicLink({
        email,
        callbackURL,
        errorCallbackURL: `${window.location.origin}/sign-in`,
      })

      if (magicLinkError) {
        setAuthStatus({
          tone: 'error',
          title: translateAuthErrorMessage(
            magicLinkError.message,
            'Não foi possível enviar o link mágico.',
          ),
        })
        return
      }

      setAuthStatus({
        tone: 'success',
        title: 'Link de acesso solicitado',
        description:
          'Se o email tiver acesso LAB, enviaremos o link em instantes.',
      })
    } catch {
      setAuthStatus({
        tone: 'error',
        title: 'Falha ao solicitar link mágico.',
      })
    } finally {
      setIsMagicLinkLoading(false)
    }
  }

  async function handleRequestOtp() {
    setAuthStatus(null)
    setIsOtpRequesting(true)

    try {
      const { error: otpRequestError } =
        await labAuthClient.emailOtp.sendVerificationOtp({
          email,
          type: 'sign-in',
        })

      if (otpRequestError) {
        setAuthStatus({
          tone: 'error',
          title: translateAuthErrorMessage(
            otpRequestError.message,
            'Falha ao enviar código.',
          ),
        })
        return
      }

      setOtpRequested(true)
      setAuthStatus({
        tone: 'success',
        title: 'Código solicitado',
        description:
          'Se o email tiver acesso LAB, enviaremos um código de 6 dígitos.',
      })
    } catch {
      setAuthStatus({
        tone: 'error',
        title: 'Falha ao solicitar código.',
      })
    } finally {
      setIsOtpRequesting(false)
    }
  }

  async function handleOtpSignIn() {
    setAuthStatus(null)
    setIsOtpSigningIn(true)

    try {
      const { error: otpSignInError } = await labAuthClient.signIn.emailOtp({
        email,
        otp,
      })

      if (otpSignInError) {
        setAuthStatus({
          tone: 'error',
          title: translateAuthErrorMessage(
            otpSignInError.message,
            'Código inválido.',
          ),
        })
        return
      }

      clearDesktopSignedOut()
      startDesktopInitialSync()
      navigate({ to: safeRedirect })
    } catch {
      setAuthStatus({
        tone: 'error',
        title: 'Falha ao validar código.',
      })
    } finally {
      setIsOtpSigningIn(false)
    }
  }

  return (
    <form
      className={cn('flex flex-col gap-6', className)}
      onSubmit={handleSubmit}
      {...props}
    >
      <FieldGroup>
        <div className="flex flex-col items-center gap-3 text-center">
          <BrandMark className="size-12" />
          <h1 className="text-2xl font-bold">
            {mode === 'backoffice'
              ? 'Entrar no backoffice'
              : 'Entre em sua conta'}
          </h1>
          <p className="text-muted-foreground text-sm text-balance">
            {mode === 'backoffice'
              ? 'Acesso interno da equipe CalibraFácil'
              : 'Use sua passkey ou um método seguro por email'}
          </p>
        </div>
        {authStatus ? <AuthStatusMessage status={authStatus} /> : null}
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete={isLabMode ? 'username webauthn' : 'username'}
            placeholder="seu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required={!isLabMode || isMagicLinkLoading || isOtpRequesting}
          />
        </Field>
        {isLabMode ? (
          <>
            <Field>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Spinner className="mr-2" />
                    Entrando...
                  </>
                ) : (
                  'Entrar com passkey'
                )}
              </Button>
            </Field>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant="outline"
                disabled={isMagicLinkLoading || !email.trim()}
                onClick={handleMagicLinkSignIn}
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
                disabled={isOtpRequesting || !email.trim()}
                onClick={handleRequestOtp}
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
              <div className="space-y-3">
                <Field>
                  <FieldLabel htmlFor="sign-in-otp">Código recebido</FieldLabel>
                  <InputOTP
                    id="sign-in-otp"
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
                  type="button"
                  disabled={isOtpSigningIn || otp.length < 6}
                  onClick={handleOtpSignIn}
                >
                  {isOtpSigningIn ? 'Validando...' : 'Entrar com código'}
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <Field>
              <div className="flex items-center">
                <FieldLabel htmlFor="password">Senha</FieldLabel>
                <Link
                  to="/reset-password"
                  className="ml-auto text-sm underline-offset-4 hover:underline"
                >
                  Esqueceu sua senha?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <Field>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Spinner className="mr-2" />
                    Entrando...
                  </>
                ) : (
                  'Entrar'
                )}
              </Button>
            </Field>
          </>
        )}
        {mode === 'lab' && onSwitchToSso ? (
          <>
            <Separator />
            <Field>
              <Button type="button" variant="outline" onClick={onSwitchToSso}>
                <HugeiconsIcon icon={Building03Icon} className="size-4" />
                Entrar com SSO corporativo
              </Button>
            </Field>
          </>
        ) : null}
      </FieldGroup>
    </form>
  )
}

export function startDesktopInitialSync() {
  if (typeof window === 'undefined' || !window.calibraBridge) return

  void window.calibraBridge.startSync().catch(() => {
    // The sync status banner surfaces failures after navigation.
  })
}
