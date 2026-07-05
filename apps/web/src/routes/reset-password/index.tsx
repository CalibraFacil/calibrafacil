import { useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'

import { BrandLockup } from '@/components/brand'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  requestBackofficePasswordReset,
  resetBackofficePassword,
} from '@calibra-facil/auth/client'
import { translateAuthErrorMessage } from '@calibra-facil/auth/error-messages'

// SEC-09 (#669): the lab dashboard is passwordless by principle — password
// sign-in and reset are disabled on the lab auth surface. This page is now
// exclusively the BACKOFFICE operators' password-reset entry point (linked
// from `apps/backoffice`'s sign-in form via `${getLabAppBaseUrl()}/reset-password`,
// since the backoffice app has no reset page of its own); it binds to the
// backoffice auth client, not the lab one.

type ResetPasswordSearch = {
  token?: string
  error?: string
  invitationId?: string
}

export const Route = createFileRoute('/reset-password/')({
  validateSearch: (search: Record<string, unknown>): ResetPasswordSearch => ({
    token: typeof search.token === 'string' ? search.token : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
    invitationId:
      typeof search.invitationId === 'string' ? search.invitationId : undefined,
  }),
  head: () => ({
    meta: [{ title: 'Redefinir senha | CalibraFácil' }],
  }),
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const navigate = useNavigate()
  const { token, error: tokenError, invitationId } = Route.useSearch()
  const [email, setEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState<string | null>(
    tokenError === 'INVALID_TOKEN'
      ? 'O link de redefinição é inválido ou expirou.'
      : null,
  )
  const [isLoading, setIsLoading] = useState(false)

  const isResetMode = Boolean(token)

  async function handleRequestReset(event: React.FormEvent) {
    event.preventDefault()
    setIsLoading(true)
    setMessage(null)

    try {
      const { error } = await requestBackofficePasswordReset({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
      })

      if (error) {
        setMessage(
          translateAuthErrorMessage(
            error.message,
            'Falha ao solicitar redefinição de senha',
          ),
        )
        return
      }

      setMessage(
        'Se o email existir, enviamos um link para definir ou redefinir a senha.',
      )
    } finally {
      setIsLoading(false)
    }
  }

  async function handleResetPassword(event: React.FormEvent) {
    event.preventDefault()
    if (!token) return

    setIsLoading(true)
    setMessage(null)

    try {
      const { error } = await resetBackofficePassword({
        token,
        newPassword,
      })

      if (error) {
        setMessage(
          translateAuthErrorMessage(error.message, 'Falha ao redefinir senha'),
        )
        return
      }

      toast.success('Senha definida com sucesso')
      if (invitationId) {
        navigate({
          to: '/accept-invitation/$id',
          params: { id: invitationId },
        })
        return
      }

      navigate({ to: '/sign-in' })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-md space-y-4">
        <div className="flex justify-center">
          <Link to="/" className="flex items-center gap-2 font-medium">
            <BrandLockup markClassName="size-8" />
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              {isResetMode ? 'Definir nova senha' : 'Redefinir senha'}
            </CardTitle>
            <CardDescription>
              {isResetMode
                ? 'Informe a nova senha para concluir o acesso à conta.'
                : 'Solicite um link para definir ou redefinir sua senha.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={isResetMode ? handleResetPassword : handleRequestReset}
            >
              <FieldGroup>
                {message ? (
                  <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                    {message}
                  </div>
                ) : null}

                {isResetMode ? (
                  <Field>
                    <FieldLabel htmlFor="newPassword">Nova senha</FieldLabel>
                    <Input
                      id="newPassword"
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      required
                    />
                  </Field>
                ) : (
                  <Field>
                    <FieldLabel htmlFor="email">Email</FieldLabel>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                    />
                  </Field>
                )}

                <Field>
                  <Button className="w-full" type="submit" disabled={isLoading}>
                    {isLoading
                      ? isResetMode
                        ? 'Salvando...'
                        : 'Enviando...'
                      : isResetMode
                        ? 'Salvar nova senha'
                        : 'Enviar link'}
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
