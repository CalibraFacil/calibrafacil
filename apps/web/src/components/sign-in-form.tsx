import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  backofficeSignIn,
  backofficeSignOut,
  labAuthClient,
  signIn,
} from '@calibra-facil/auth/client'
import { translateAuthErrorMessage } from '@calibra-facil/auth/error-messages'
import { getBackofficeAccess } from '@/features/backoffice/queries'
import { calibraApi } from '@/utils/api'
import { clearDesktopSignedOut } from '@/runtime/desktop-auth'
import { cn } from '@/lib/utils'
import { BrandMark } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'

interface SignInFormProps extends React.ComponentProps<'form'> {
  redirect?: string
  mode?: 'lab' | 'backoffice'
}

export function SignInForm({
  className,
  redirect,
  mode = 'lab',
  ...props
}: SignInFormProps) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [organizationSlug, setOrganizationSlug] = useState('')
  const [ssoEmail, setSsoEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSsoLoading, setIsSsoLoading] = useState(false)
  const [isMagicLinkLoading, setIsMagicLinkLoading] = useState(false)
  const [isOtpRequesting, setIsOtpRequesting] = useState(false)
  const [isOtpSigningIn, setIsOtpSigningIn] = useState(false)
  const [otp, setOtp] = useState('')
  const [otpRequested, setOtpRequested] = useState(false)

  const isLabMode = mode === 'lab'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isLabMode) {
      await handlePasskeySignIn()
      return
    }

    setError(null)
    setIsLoading(true)

    try {
      const { error: signInError } = await backofficeSignIn.email({
        email,
        password,
      })

      if (signInError) {
        setError(
          translateAuthErrorMessage(
            signInError.message,
            'Não foi possível entrar. Verifique os dados e tente novamente.',
          ),
        )
        return
      }

      clearDesktopSignedOut()

      const access = await getBackofficeAccess()

      if (access.allowed) {
        navigate({ to: redirect || '/backoffice' })
        return
      }

      if (access.bootstrapAvailable) {
        navigate({ to: '/backoffice/bootstrap' })
        return
      }

      await backofficeSignOut()
      setError('Sua conta não possui acesso ao backoffice')
    } catch {
      setError(
        'Não foi possível conectar ao servidor de autenticação. Verifique sua conexão e tente novamente.',
      )
    } finally {
      setIsLoading(false)
    }
  }

  async function handlePasskeySignIn() {
    setError(null)
    setIsLoading(true)

    try {
      const result = await labAuthClient.signIn.passkey()

      if (result.error) {
        setError(
          translateAuthErrorMessage(
            result.error.message,
            'Não foi possível entrar com passkey.',
          ),
        )
        return
      }

      clearDesktopSignedOut()
      startDesktopInitialSync()
      navigate({ to: redirect || '/dashboard' })
    } catch {
      setError('Não foi possível entrar com passkey.')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleMagicLinkSignIn() {
    setError(null)
    setIsMagicLinkLoading(true)

    try {
      const callbackURL = `${window.location.origin}${redirect || '/dashboard'}`
      const { error: magicLinkError } = await signIn.magicLink({
        email,
        callbackURL,
        errorCallbackURL: `${window.location.origin}/sign-in`,
      })

      if (magicLinkError) {
        setError(
          translateAuthErrorMessage(
            magicLinkError.message,
            'Não foi possível enviar o link mágico.',
          ),
        )
        return
      }

      setError('Se o email tiver acesso LAB, enviaremos um link mágico.')
    } catch {
      setError('Falha ao solicitar link mágico.')
    } finally {
      setIsMagicLinkLoading(false)
    }
  }

  async function handleRequestOtp() {
    setError(null)
    setIsOtpRequesting(true)

    try {
      const { error: otpRequestError } =
        await labAuthClient.emailOtp.sendVerificationOtp({
          email,
          type: 'sign-in',
        })

      if (otpRequestError) {
        setError(
          translateAuthErrorMessage(
            otpRequestError.message,
            'Falha ao enviar código.',
          ),
        )
        return
      }

      setOtpRequested(true)
      setError('Se o email tiver acesso LAB, enviaremos um código de acesso.')
    } catch {
      setError('Falha ao solicitar código.')
    } finally {
      setIsOtpRequesting(false)
    }
  }

  async function handleOtpSignIn() {
    setError(null)
    setIsOtpSigningIn(true)

    try {
      const { error: otpSignInError } = await labAuthClient.signIn.emailOtp({
        email,
        otp,
      })

      if (otpSignInError) {
        setError(
          translateAuthErrorMessage(otpSignInError.message, 'Código inválido.'),
        )
        return
      }

      clearDesktopSignedOut()
      startDesktopInitialSync()
      navigate({ to: redirect || '/dashboard' })
    } catch {
      setError('Falha ao validar código.')
    } finally {
      setIsOtpSigningIn(false)
    }
  }

  async function handleSsoSubmit(e: React.SyntheticEvent) {
    e.preventDefault()
    setError(null)
    setIsSsoLoading(true)

    try {
      const data = await calibraApi.sso.start({
        organizationSlug,
        ...(ssoEmail ? { email: ssoEmail } : {}),
        redirectPath: redirect || '/dashboard',
      })
      if (!data.url) {
        setError('Falha ao iniciar login via SSO')
        return
      }

      clearDesktopSignedOut()
      window.location.assign(data.url)
    } catch {
      setError('Falha ao iniciar login via SSO')
    } finally {
      setIsSsoLoading(false)
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
        {error && (
          <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
            {error}
          </div>
        )}
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete={isLabMode ? 'username webauthn' : 'username'}
            placeholder="m@example.com"
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
                {isMagicLinkLoading ? 'Enviando...' : 'Link mágico'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isOtpRequesting || !email.trim()}
                onClick={handleRequestOtp}
              >
                {isOtpRequesting ? 'Enviando...' : 'Código por email'}
              </Button>
            </div>
            {otpRequested ? (
              <div className="space-y-3">
                <Field>
                  <FieldLabel htmlFor="sign-in-otp">Código recebido</FieldLabel>
                  <Input
                    id="sign-in-otp"
                    value={otp}
                    onChange={(event) => setOtp(event.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                  />
                </Field>
                <Button
                  type="button"
                  disabled={isOtpSigningIn || !otp.trim()}
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
        {mode === 'lab' ? (
          <>
            <Separator />
            <Field>
              <div className="space-y-1">
                <FieldLabel htmlFor="organizationSlug">
                  Entrar com SSO
                </FieldLabel>
                <p className="text-sm text-muted-foreground">
                  Informe o slug da organização e, se quiser, um email
                  corporativo como login hint.
                </p>
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="organizationSlug">
                Slug da organização
              </FieldLabel>
              <Input
                id="organizationSlug"
                value={organizationSlug}
                onChange={(e) => setOrganizationSlug(e.target.value)}
                placeholder="laboratorio-acreditado"
                required={false}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="ssoEmail">Email corporativo</FieldLabel>
              <Input
                id="ssoEmail"
                type="email"
                value={ssoEmail}
                onChange={(e) => setSsoEmail(e.target.value)}
                placeholder="voce@empresa.com.br"
                required={false}
              />
            </Field>
            <Field>
              <Button
                type="button"
                variant="outline"
                disabled={isSsoLoading || !organizationSlug.trim()}
                onClick={handleSsoSubmit}
              >
                {isSsoLoading ? (
                  <>
                    <Spinner className="mr-2" />
                    Redirecionando...
                  </>
                ) : (
                  'Entrar com SSO'
                )}
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
