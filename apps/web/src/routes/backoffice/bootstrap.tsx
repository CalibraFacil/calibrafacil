import { useState } from 'react'
import { Navigate, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useBackofficeSession } from '@calibra-facil/auth/client'
import { useBackofficeAccessData } from '@/features/backoffice/queries'
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
import { calibraApi } from '@/utils/api'

export const Route = createFileRoute('/backoffice/bootstrap')({
  head: () => ({
    meta: [{ title: 'Backoffice | Bootstrap | CalibraFácil' }],
  }),
  component: BackofficeBootstrapPage,
})

function BackofficeBootstrapPage() {
  const navigate = useNavigate()
  const { data: session } = useBackofficeSession()
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)

  const accessQuery = useBackofficeAccessData({
    scope: 'bootstrap',
    enabled: Boolean(session?.user),
  })

  if (accessQuery.data?.allowed) {
    return <Navigate to="/backoffice" />
  }

  const bootstrapMutation = useMutation({
    mutationFn: async () => calibraApi.backoffice.bootstrap({ token }),
    onSuccess: () => {
      toast.success('Backoffice inicializado com sucesso')
      window.location.assign('/backoffice')
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : 'Falha ao concluir bootstrap',
      )
    },
  })

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-md space-y-4">
        <div className="flex justify-center">
          <BrandLockup markClassName="size-8" />
        </div>
        <Card>
          <CardHeader className="text-center">
            <CardTitle>Bootstrap do Backoffice</CardTitle>
            <CardDescription>
              Use o token secreto de inicialização para promover esta conta ao
              primeiro admin da plataforma.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {accessQuery.data && !accessQuery.data.bootstrapAvailable ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  O bootstrap já foi concluído nesta instância. O primeiro admin
                  de plataforma já existe.
                </p>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => navigate({ to: '/backoffice/sign-in' })}
                >
                  Voltar ao login do backoffice
                </Button>
              </div>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  setError(null)
                  bootstrapMutation.mutate()
                }}
              >
                <FieldGroup>
                  <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                    Use uma conta interna dedicada da equipe CalibraFácil. Após
                    promovida, essa conta deve operar o dashboard apenas via
                    impersonação.
                  </div>
                  {error ? (
                    <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                      {error}
                    </div>
                  ) : null}
                  <Field>
                    <FieldLabel htmlFor="bootstrapToken">
                      Token de bootstrap
                    </FieldLabel>
                    <Input
                      id="bootstrapToken"
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      placeholder="Cole o token configurado no ambiente"
                      autoComplete="off"
                      required
                    />
                  </Field>
                  <Field>
                    <Button
                      className="w-full"
                      type="submit"
                      disabled={bootstrapMutation.isPending || !token.trim()}
                    >
                      {bootstrapMutation.isPending
                        ? 'Promovendo...'
                        : 'Promover esta conta'}
                    </Button>
                  </Field>
                </FieldGroup>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
