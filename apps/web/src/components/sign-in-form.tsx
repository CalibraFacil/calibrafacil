import { useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Building03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { labAuthClient, signIn } from '@calibra-facil/auth/client'
import { translateAuthErrorMessage } from '@calibra-facil/auth/error-messages'
import { useCountdown } from '@/hooks/use-countdown'
import { useMountEffect } from '@/hooks/use-mount-effect'
import { clearDesktopSignedOut } from '@/runtime/desktop-auth'
import { cn } from '@/lib/utils'
import { sanitizeLabRedirect } from '@/lib/auth-redirect'
import {
  AuthStatusMessage,
  type AuthStatus,
} from '@/components/auth-status-message'
import { BrandMark } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { OTP_CODE_LENGTH } from '@/components/otp-code-field'
import {
  SignInCodeStep,
  type SignInCodeStatus,
} from '@/components/sign-in-code-step'

/** Matches the emailOTP rate limit (5 requests / 60s) with room to spare. */
const RESEND_COOLDOWN_SECONDS = 30

/** Rejections that retyping the same code cannot fix. */
const NEEDS_FRESH_CODE = new Set(['otp_expired', 'too_many_attempts'])

function needsFreshCode(message: string | null | undefined) {
  return NEEDS_FRESH_CODE.has(message?.trim().toLowerCase() ?? '')
}

/**
 * A beat between "code accepted" and the redirect, so the confirmation is seen
 * instead of the page vanishing mid-keystroke.
 */
const VERIFIED_HOLD_MS = 450

interface SignInFormProps extends React.ComponentProps<'form'> {
  redirect?: string
  onSwitchToSso?: () => void
}

export function SignInForm({
  className,
  redirect,
  onSwitchToSso,
  ...props
}: SignInFormProps) {
  const navigate = useNavigate()
  const prefersReducedMotion = useReducedMotion()
  const [email, setEmail] = useState('')
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isMagicLinkLoading, setIsMagicLinkLoading] = useState(false)
  const [isOtpRequesting, setIsOtpRequesting] = useState(false)
  const [otp, setOtp] = useState('')
  const [otpStatus, setOtpStatus] = useState<SignInCodeStatus>('idle')
  const [otpError, setOtpError] = useState<string | null>(null)
  const [otpErrorNonce, setOtpErrorNonce] = useState(0)
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null)

  const resendCooldown = useCountdown()
  const otpInputRef = useRef<HTMLInputElement>(null)
  const deferredRef = useRef<Array<ReturnType<typeof setTimeout>>>([])

  const isCodeStep = codeSentTo !== null
  const safeRedirect = sanitizeLabRedirect(redirect)

  useMountEffect(() => () => {
    for (const handle of deferredRef.current) clearTimeout(handle)
    deferredRef.current = []
  })

  function defer(callback: () => void, delayMs: number) {
    deferredRef.current.push(setTimeout(callback, delayMs))
  }

  // Conditional-UI autofill: when the browser supports conditional mediation,
  // pre-arm a passkey request on mount so the email field (autoComplete
  // "username webauthn") surfaces saved passkeys / lets password managers fill.
  // This is what makes Apple, Google, 1Password and Bitwarden actually prompt on
  // page load. Best-effort: cancellations/absence of credentials are ignored.
  useMountEffect(() => {
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

    // Enter inside the code field must verify the code, not fire the passkey
    // prompt that owns this form's submit in the first step.
    if (isCodeStep) {
      await handleOtpSignIn(otp)
      return
    }

    await handlePasskeySignIn()
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

      setOtp('')
      setOtpError(null)
      setOtpStatus('idle')
      setCodeSentTo(email)
      resendCooldown.start(RESEND_COOLDOWN_SECONDS)
    } catch {
      setAuthStatus({
        tone: 'error',
        title: 'Falha ao solicitar código.',
      })
    } finally {
      setIsOtpRequesting(false)
    }
  }

  function handleChangeEmail() {
    setCodeSentTo(null)
    setOtp('')
    setOtpError(null)
    setOtpStatus('idle')
    setAuthStatus(null)
    resendCooldown.reset()
  }

  async function handleOtpSignIn(code: string) {
    // `onComplete` and the fallback button can both land on the same value;
    // one verification at a time.
    if (otpStatus !== 'idle' || code.length < OTP_CODE_LENGTH) return

    setAuthStatus(null)
    setOtpError(null)
    setOtpStatus('validating')

    try {
      const { error: otpSignInError } = await labAuthClient.signIn.emailOtp({
        email: codeSentTo ?? email,
        otp: code,
      })

      if (otpSignInError) {
        // "Solicite um novo código" must not point at a button still counting
        // down: when retrying this code is pointless, free the resend now.
        if (needsFreshCode(otpSignInError.message)) resendCooldown.reset()
        rejectOtp(
          translateAuthErrorMessage(otpSignInError.message, 'Código inválido.'),
        )
        return
      }

      setOtpStatus('verified')
      clearDesktopSignedOut()
      startDesktopInitialSync()
      defer(() => navigate({ to: safeRedirect }), VERIFIED_HOLD_MS)
    } catch {
      rejectOtp('Falha ao validar código.')
    }
  }

  /**
   * A rejected code is cleared rather than left in place: retyping six digits is
   * faster than hunting for the wrong one, and it re-arms the auto-submit.
   */
  function rejectOtp(message: string) {
    setOtpStatus('idle')
    setOtp('')
    setOtpError(message)
    setOtpErrorNonce((nonce) => nonce + 1)
    // After the re-enable has been committed, not before it.
    defer(() => otpInputRef.current?.focus(), 0)
  }

  const emailField = (
    <Field>
      <FieldLabel htmlFor="email">Email</FieldLabel>
      <Input
        id="email"
        type="email"
        autoComplete="username webauthn"
        placeholder="seu@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required={isMagicLinkLoading || isOtpRequesting}
      />
    </Field>
  )

  return (
    <form
      className={cn('flex flex-col gap-6', className)}
      onSubmit={handleSubmit}
      {...props}
    >
      <FieldGroup>
        <div className="flex flex-col items-center gap-3 text-center">
          <BrandMark className="size-12" />
          <h1 className="text-2xl font-bold text-balance">
            {isCodeStep ? 'Verifique seu email' : 'Entre em sua conta'}
          </h1>
          <p className="text-muted-foreground text-sm text-balance">
            {isCodeStep ? (
              <>
                Se{' '}
                <span className="text-foreground font-medium break-all">
                  {codeSentTo}
                </span>{' '}
                tiver acesso LAB, o código chega em instantes.
              </>
            ) : (
              'Use sua passkey ou um método seguro por email'
            )}
          </p>
        </div>
        {authStatus ? <AuthStatusMessage status={authStatus} /> : null}
        <AnimatePresence mode="wait" initial={false}>
          {isCodeStep ? (
            <SignInCodeStep
              key="code"
              code={otp}
              onCodeChange={setOtp}
              onSubmit={() => void handleOtpSignIn(otp)}
              onResend={() => void handleRequestOtp()}
              onChangeEmail={handleChangeEmail}
              status={otpStatus}
              error={otpError}
              errorNonce={otpErrorNonce}
              resendSecondsLeft={resendCooldown.secondsLeft}
              isResending={isOtpRequesting}
              inputRef={otpInputRef}
            />
          ) : (
            <motion.div
              key="methods"
              className="flex flex-col gap-6"
              initial={false}
              animate={{
                opacity: 1,
                transform: 'translateY(0px)',
                filter: 'blur(0px)',
              }}
              exit={
                prefersReducedMotion
                  ? { opacity: 0 }
                  : {
                      opacity: 0,
                      transform: 'translateY(-6px)',
                      filter: 'blur(3px)',
                    }
              }
              transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
            >
              {emailField}
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
              {onSwitchToSso ? (
                <>
                  <Separator />
                  <Field>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onSwitchToSso}
                    >
                      <HugeiconsIcon icon={Building03Icon} className="size-4" />
                      Entrar com SSO corporativo
                    </Button>
                  </Field>
                </>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>
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
