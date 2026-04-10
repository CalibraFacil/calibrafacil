import { Link, Navigate, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { BrandLockup } from '@/components/brand'
import { SignInForm } from '@/components/sign-in-form'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  backofficeSignOut,
  getBackofficeSession,
  useBackofficeSession,
} from '@calibra-facil/auth/client'
import { api } from '@/utils/api'
import { useMountEffect } from '@/hooks/use-mount-effect'

type BackofficeSignInSearch = {
  redirect?: string
}

export const Route = createFileRoute('/backoffice/sign-in')({
  validateSearch: (search: Record<string, unknown>): BackofficeSignInSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: async () => {
    const { data: session } = await getBackofficeSession()

    if (!session) {
      return
    }
  },
  head: () => ({
    meta: [{ title: 'Backoffice | Entrar | CalibraFácil' }],
  }),
  component: BackofficeSignInPage,
})

function BackofficeSignInPage() {
  const navigate = useNavigate()
  const { redirect: redirectTo } = Route.useSearch()
  const { data: session } = useBackofficeSession()
  const accessQuery = useQuery({
    queryKey: ['backoffice', 'access', 'sign-in'],
    queryFn: async () => {
      const res = await api.api.backoffice.access.$get()
      if (!res.ok) {
        throw new Error('Falha ao validar acesso ao backoffice')
      }

      return res.json() as Promise<{
        allowed: boolean
        bootstrapAvailable: boolean
      }>
    },
    enabled: Boolean(session?.user),
    retry: false,
  })

  if (session?.user && accessQuery.data?.allowed) {
    return <Navigate to={redirectTo || '/backoffice'} />
  }

  if (session?.user && accessQuery.data?.bootstrapAvailable) {
    return <Navigate to="/backoffice/bootstrap" />
  }

  if (session?.user && accessQuery.isSuccess) {
    return <BackofficeSignOutOnMount />
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <Link to="/" className="flex items-center gap-2 font-medium">
            <BrandLockup markClassName="size-7" />
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm space-y-4">
            <SignInForm redirect={redirectTo || '/backoffice'} mode="backoffice" />
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Acesso separado</CardTitle>
                <CardDescription>
                  O backoffice é exclusivo da equipe interna. Usuários do
                  laboratório devem entrar pelo dashboard.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Button variant="outline" onClick={() => navigate({ to: '/sign-in' })}>
                  Ir para o login do laboratório
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <div className="relative hidden overflow-hidden bg-muted p-10 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 bg-linear-to-br from-primary/10 via-muted to-chart-1/10" />
        <div className="absolute -top-1/2 -left-1/2 h-full w-full rounded-full bg-chart-1/20 blur-[100px]" />
        <div className="absolute -bottom-1/2 -right-1/2 h-full w-full rounded-full bg-primary/20 blur-[100px]" />

        <div className="relative z-10 max-w-md space-y-2">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Operação interna
          </p>
          <h2 className="text-3xl font-semibold leading-tight">
            Atendimento, contas, governança e suporte da plataforma em uma área
            separada.
          </h2>
        </div>

        <div className="relative z-10 rounded-xl border bg-background/80 p-6 backdrop-blur">
          <p className="text-sm text-muted-foreground">
            Use impersonação apenas para suporte e troubleshooting. A operação do
            cliente continua no dashboard do laboratório.
          </p>
        </div>
      </div>
    </div>
  )
}

function BackofficeSignOutOnMount() {
  useMountEffect(() => {
    void backofficeSignOut()
  })

  return (
    <div className="grid min-h-svh place-items-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Saindo...</CardTitle>
          <CardDescription>
            Esta conta não possui acesso ao backoffice.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
