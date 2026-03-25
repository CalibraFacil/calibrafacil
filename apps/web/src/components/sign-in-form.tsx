import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { signIn } from '@calibra-facil/auth/client'
import { api } from '@/utils/api'
import { cn } from '@/lib/utils'
import { BrandMark } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'

interface SignInFormProps extends React.ComponentProps<'form'> {
  redirect?: string
}

export function SignInForm({ className, redirect, ...props }: SignInFormProps) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [organizationSlug, setOrganizationSlug] = useState('')
  const [ssoEmail, setSsoEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSsoLoading, setIsSsoLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    const { error } = await signIn.email({
      email,
      password,
    })

    if (error) {
      setIsLoading(false)
      setError(error.message ?? 'Failed to sign in')
      return
    }

    setIsLoading(false)
    navigate({ to: redirect || '/dashboard' })
  }

  async function handleSsoSubmit(e: React.SyntheticEvent) {
    e.preventDefault()
    setError(null)
    setIsSsoLoading(true)

    try {
      const res = await api.api.sso.start.$post({
        json: {
          organizationSlug,
          ...(ssoEmail ? { email: ssoEmail } : {}),
          redirectPath: redirect || '/dashboard',
        },
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        const message =
          data &&
          typeof data === 'object' &&
          'error' in data &&
          typeof data.error === 'string'
            ? data.error
            : 'Falha ao iniciar login via SSO'
        setError(message)
        return
      }

      const data = await res.json()
      if (!data.url) {
        setError('Falha ao iniciar login via SSO')
        return
      }

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
          <h1 className="text-2xl font-bold">Entre em sua conta</h1>
          <p className="text-muted-foreground text-sm text-balance">
            Insira seu email abaixo para entrar em sua conta
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
            placeholder="m@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field>
          <div className="flex items-center">
            <FieldLabel htmlFor="password">Senha</FieldLabel>
            <Link
              to="/"
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
        <Separator />
        <Field>
          <div className="space-y-1">
            <FieldLabel htmlFor="organizationSlug">Entrar com SSO</FieldLabel>
            <p className="text-sm text-muted-foreground">
              Informe o slug da organização e, se quiser, um email corporativo
              como login hint.
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
        {/* <Field>
          <FieldDescription className="text-center">
            Não possui uma conta?{' '}
            <Link to="/sign-up" className="underline underline-offset-4">
              Cadastre-se
            </Link>
          </FieldDescription>
        </Field> */}
      </FieldGroup>
    </form>
  )
}
