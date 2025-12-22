import { createFileRoute } from '@tanstack/react-router'
import { CreditCardIcon, Rocket01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

export const Route = createFileRoute('/dashboard/settings/billing')({
  head: () => ({
    meta: [{ title: 'Faturamento | Configurações | CalibraFácil' }],
  }),
  component: BillingSettingsPage,
})

function BillingSettingsPage() {
  // Mock data - in real implementation, this would come from a billing provider
  const mockPlan = {
    name: 'Plano Gratuito',
    price: 0,
    features: ['5 calibrações por mês', '1 usuário', 'Suporte por email'],
  }

  return (
    <div className="space-y-6">
      {/* Current Plan */}
      <Card>
        <CardHeader>
          <CardTitle>Plano Atual</CardTitle>
          <CardDescription>
            Gerencie sua assinatura e faturamento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{mockPlan.name}</span>
                <Badge>Ativo</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {mockPlan.price === 0
                  ? 'Gratuito para sempre'
                  : `R$ ${mockPlan.price}/mes`}
              </p>
              <ul className="text-sm text-muted-foreground mt-2 space-y-1">
                {mockPlan.features.map((feature, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <span className="text-green-600">&#10003;</span>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
            <Button variant="outline">
              <HugeiconsIcon icon={Rocket01Icon} />
              Fazer upgrade
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Payment Methods */}
      <Card>
        <CardHeader>
          <CardTitle>Métodos de Pagamento</CardTitle>
          <CardDescription>
            Adicione ou remova métodos de pagamento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={CreditCardIcon} />
              </EmptyMedia>
              <EmptyTitle>Nenhum método de pagamento</EmptyTitle>
              <EmptyDescription>
                Adicione um cartão de crédito para fazer upgrade do seu plano.
              </EmptyDescription>
            </EmptyHeader>
            <Button variant="outline" size="sm">
              Adicionar cartão
            </Button>
          </Empty>
        </CardContent>
      </Card>

      {/* Invoice History */}
      <Card>
        <CardHeader>
          <CardTitle>Historico de Faturas</CardTitle>
          <CardDescription>
            Visualize e baixe suas faturas anteriores.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>Nenhuma fatura</EmptyTitle>
              <EmptyDescription>
                Suas faturas aparecerão aqui apos o primeiro pagamento.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    </div>
  )
}
