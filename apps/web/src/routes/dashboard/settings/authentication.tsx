import { createFileRoute } from '@tanstack/react-router'
import { Cancel01Icon, CheckmarkBadge01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { useSettings } from '@/contexts/settings-context'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/dashboard/settings/authentication')({
  head: () => ({
    meta: [{ title: 'Autenticação | Configurações | CalibraFácil' }],
  }),
  component: AuthenticationSettingsPage,
})

function AuthenticationSettingsPage() {
  const { user, isLoading } = useSettings()

  if (isLoading) {
    return <AuthenticationSkeleton />
  }

  // Since no OAuth is configured, password is the only auth method
  const hasPassword = true // Users always have password auth in this setup

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Métodos de Autenticação</CardTitle>
          <CardDescription>
            Gerencie como você faz login na sua conta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Password Authentication */}
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <HugeiconsIcon
                    icon={CheckmarkBadge01Icon}
                    className="h-5 w-5"
                  />
                </div>
                <div>
                  <p className="font-medium">Senha</p>
                  <p className="text-sm text-muted-foreground">
                    Faça login com email e senha
                  </p>
                </div>
              </div>
              <Badge variant={hasPassword ? 'default' : 'secondary'}>
                {hasPassword ? 'Ativo' : 'Nao configurado'}
              </Badge>
            </div>

            {/* Email Verification Status */}
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  {user?.emailVerified ? (
                    <HugeiconsIcon
                      icon={CheckmarkBadge01Icon}
                      className="h-5 w-5 text-green-600"
                    />
                  ) : (
                    <HugeiconsIcon
                      icon={Cancel01Icon}
                      className="h-5 w-5 text-yellow-600"
                    />
                  )}
                </div>
                <div>
                  <p className="font-medium">Verificação de Email</p>
                  <p className="text-sm text-muted-foreground">{user?.email}</p>
                </div>
              </div>
              <Badge variant={user?.emailVerified ? 'default' : 'secondary'}>
                {user?.emailVerified ? 'Verificado' : 'Pendente'}
              </Badge>
            </div>

            {/* OAuth Providers Placeholder */}
            <div className="mt-6 p-4 border border-dashed rounded-lg">
              <p className="text-sm text-muted-foreground text-center">
                Provedores de autenticação social (Google, GitHub, etc.) estarão
                disponíveis em breve.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function AuthenticationSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-64 mt-2" />
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between p-4 border rounded-lg"
            >
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-36" />
                </div>
              </div>
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
