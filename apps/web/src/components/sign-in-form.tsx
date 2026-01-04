import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { signIn } from '@calibra-facil/auth/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'

interface SignInFormProps extends React.ComponentProps<'form'> {
  redirect?: string
}

export function SignInForm({ className, redirect, ...props }: SignInFormProps) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

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

  return (
    <form
      className={cn('flex flex-col gap-6', className)}
      onSubmit={handleSubmit}
      {...props}
    >
      <FieldGroup>
        <div className="flex flex-col items-center gap-1 text-center">
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
