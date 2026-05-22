import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { signUp } from '@calibra-facil/auth/client'
import { cn } from '@/lib/utils'
import { BrandMark } from '@/components/brand'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'

interface SignUpFormProps extends React.ComponentProps<'form'> {
  redirect?: string
}

function getEmailVerificationCallbackURL(redirect?: string) {
  const callbackURL = new URL(
    '/onboarding/organization',
    window.location.origin,
  )

  if (redirect) {
    callbackURL.searchParams.set('redirect', redirect)
  }

  return callbackURL.toString()
}

export function SignUpForm({ className, redirect, ...props }: SignUpFormProps) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      const { error } = await signUp.email({
        name,
        email,
        password,
        callbackURL: getEmailVerificationCallbackURL(redirect),
      })

      if (error) {
        setError(error.message ?? 'Failed to create account')
        return
      }
      navigate({
        to: '/onboarding/organization',
        search: redirect ? { redirect } : undefined,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar conta')
    } finally {
      setIsLoading(false)
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
          <h1 className="text-2xl font-bold">Criar uma conta</h1>
          <p className="text-muted-foreground text-sm text-balance">
            Insira seus detalhes abaixo para criar sua conta
          </p>
        </div>
        {error && (
          <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
            {error}
          </div>
        )}
        <Field>
          <FieldLabel htmlFor="name">Nome</FieldLabel>
          <Input
            id="name"
            type="text"
            placeholder="John Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
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
          <FieldLabel htmlFor="password">Senha</FieldLabel>
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
            {isLoading ? 'Criando conta...' : 'Criar conta'}
          </Button>
        </Field>
        <Field>
          <FieldDescription className="text-center">
            Já possui uma conta?{' '}
            <Link to="/sign-in" className="underline underline-offset-4">
              Entrar
            </Link>
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  )
}
