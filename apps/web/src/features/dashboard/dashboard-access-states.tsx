import { useNavigate } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function DashboardOnboardingState() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Complete o onboarding</CardTitle>
          <CardDescription>
            Sua conta foi criada, mas você ainda não configurou um laboratório
            para acessar o dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button onClick={() => navigate({ to: '/onboarding/organization' })}>
            Criar laboratório
          </Button>
          <Button variant="outline" onClick={() => navigate({ to: '/' })}>
            Voltar para o início
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export function DashboardRestrictedState() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Acesso Restrito</CardTitle>
          <CardDescription>
            Esta área é exclusiva para usuários do laboratório. Se você é um
            cliente, acesse o Portal do Cliente.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button
            onClick={() => {
              const host = window.location.hostname
              window.location.href = `${window.location.protocol}//${host}:5174`
            }}
          >
            Acessar Portal do Cliente
          </Button>
          <Button variant="outline" onClick={() => navigate({ to: '/' })}>
            Voltar para o início
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
