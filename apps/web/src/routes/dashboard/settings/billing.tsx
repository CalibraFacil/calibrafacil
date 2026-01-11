import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Rocket01Icon,
  Invoice02Icon,
  Calendar03Icon,
  AlertCircleIcon,
} from '@hugeicons/core-free-icons'
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
import { Progress } from '@/components/ui/progress'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { CheckoutDialog } from '@/components/billing'
import { api } from '@/utils/api'
import { formatPrice, type PlanId } from '@calibra-facil/shared'

export const Route = createFileRoute('/dashboard/settings/billing')({
  head: () => ({
    meta: [{ title: 'Faturamento | Configuracoes | CalibraFacil' }],
  }),
  component: BillingSettingsPage,
})

// Status badge variants
const STATUS_BADGES: Record<
  string,
  {
    label: string
    variant: 'default' | 'secondary' | 'destructive' | 'outline'
  }
> = {
  ACTIVE: { label: 'Ativo', variant: 'default' },
  TRIAL: { label: 'Trial', variant: 'secondary' },
  PAST_DUE: { label: 'Pagamento Pendente', variant: 'destructive' },
  CANCELED: { label: 'Cancelado', variant: 'outline' },
}

// Payment status badges
const PAYMENT_STATUS: Record<
  string,
  {
    label: string
    variant: 'default' | 'secondary' | 'destructive' | 'outline'
  }
> = {
  CONFIRMED: { label: 'Confirmado', variant: 'default' },
  RECEIVED: { label: 'Recebido', variant: 'default' },
  PENDING: { label: 'Pendente', variant: 'secondary' },
  OVERDUE: { label: 'Vencido', variant: 'destructive' },
  REFUNDED: { label: 'Reembolsado', variant: 'outline' },
}

function BillingSettingsPage() {
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const queryClient = useQueryClient()

  // Fetch subscription data
  const subscriptionQuery = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: async () => {
      const response = await api.api.billing.subscription.$get()
      if (!response.ok) {
        throw new Error('Erro ao carregar assinatura')
      }
      return response.json()
    },
  })

  // Fetch payment history
  const paymentsQuery = useQuery({
    queryKey: ['billing', 'payments'],
    queryFn: async () => {
      const response = await api.api.billing.payments.$get({
        query: { limit: '10', offset: '0' },
      })
      if (!response.ok) {
        throw new Error('Erro ao carregar pagamentos')
      }
      return response.json()
    },
  })

  // Cancel subscription mutation
  const cancelMutation = useMutation({
    mutationFn: async () => {
      const response = await api.api.billing.subscription.$delete()
      if (!response.ok) {
        const error = await response.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao cancelar',
        )
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing'] })
    },
  })

  const { subscription, plan, usage, limits } = subscriptionQuery.data || {
    subscription: null,
    plan: null,
    usage: { certificates: 0, users: 0, storage: 0 },
    limits: { certificates: 10, users: 1, storage: 100 * 1024 * 1024 },
  }

  const payments = paymentsQuery.data?.data || []

  const statusBadge =
    STATUS_BADGES[subscription?.status || 'TRIAL'] || STATUS_BADGES.TRIAL

  // Calculate usage percentages
  const certificatePercentage = limits?.certificates
    ? Math.min(100, (usage.certificates / limits.certificates) * 100)
    : 0
  const userPercentage = limits?.users
    ? Math.min(100, (usage.users / limits.users) * 100)
    : 0

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
        <CardContent className="space-y-6">
          {/* Plan Info */}
          <div className="flex items-start justify-between p-4 border rounded-lg">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-lg font-medium">
                  {plan?.name || 'Gratuito'}
                </span>
                <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
              </div>
              {subscription?.billingCycle && (
                <p className="text-sm text-muted-foreground">
                  Ciclo:{' '}
                  {subscription.billingCycle === 'MONTHLY' ? 'Mensal' : 'Anual'}
                </p>
              )}
              {subscription?.nextBillingDate && (
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <HugeiconsIcon icon={Calendar03Icon} size={14} />
                  Próxima cobrança:{' '}
                  {new Date(subscription.nextBillingDate).toLocaleDateString(
                    'pt-BR',
                  )}
                </p>
              )}
              {subscription?.status === 'PAST_DUE' && (
                <p className="text-sm text-destructive flex items-center gap-1 mt-2">
                  <HugeiconsIcon icon={AlertCircleIcon} size={14} />
                  Pagamento pendente. Regularize para evitar bloqueio.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {subscription?.status !== 'CANCELED' &&
                subscription?.planId !== 'FREE' && (
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={<Button variant="outline" size="sm" />}
                    >
                      Cancelar
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Cancelar assinatura?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          Você perderá acesso aos recursos premium ao final do
                          período atual. Essa acão não pode ser desfeita.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Manter assinatura</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => cancelMutation.mutate()}
                          disabled={cancelMutation.isPending}
                        >
                          {cancelMutation.isPending
                            ? 'Cancelando...'
                            : 'Confirmar cancelamento'}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              <Button onClick={() => setCheckoutOpen(true)}>
                <HugeiconsIcon icon={Rocket01Icon} size={16} />
                {subscription?.planId === 'FREE' || !subscription
                  ? 'Fazer upgrade'
                  : 'Mudar plano'}
              </Button>
            </div>
          </div>

          {/* Usage Meters */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Certificates Usage */}
            <div className="p-4 border rounded-lg space-y-2">
              <div className="flex justify-between text-sm">
                <span className="font-medium">Certificados este mês</span>
                <span className="text-muted-foreground">
                  {usage.certificates} /{' '}
                  {limits?.certificates === 999999
                    ? 'Ilimitado'
                    : limits?.certificates}
                </span>
              </div>
              <Progress value={certificatePercentage} className="h-2" />
              {certificatePercentage >= 80 &&
                limits?.certificates !== 999999 && (
                  <p className="text-xs text-amber-600">
                    Você está próximo do limite. Considere fazer upgrade.
                  </p>
                )}
            </div>

            {/* Users Usage */}
            <div className="p-4 border rounded-lg space-y-2">
              <div className="flex justify-between text-sm">
                <span className="font-medium">Usuarios</span>
                <span className="text-muted-foreground">
                  {usage.users} /{' '}
                  {limits?.users === 999 ? 'Ilimitado' : limits?.users}
                </span>
              </div>
              <Progress value={userPercentage} className="h-2" />
              {userPercentage >= 80 && limits?.users !== 999 && (
                <p className="text-xs text-amber-600">
                  Você está próximo do limite de usuários.
                </p>
              )}
            </div>
          </div>

          {/* Features List */}
          {plan?.features && plan.features.length > 0 && (
            <div className="p-4 border rounded-lg">
              <p className="text-sm font-medium mb-2">Recursos inclusos:</p>
              <div className="flex flex-wrap gap-2">
                {plan.features.map((feature: string) => (
                  <Badge key={feature} variant="secondary">
                    {getFeatureLabel(feature)}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment History */}
      <Card>
        <CardHeader>
          <CardTitle>Histórico de Pagamentos</CardTitle>
          <CardDescription>
            Visualize e baixe suas faturas anteriores.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {paymentsQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : payments.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={Invoice02Icon} />
                </EmptyMedia>
                <EmptyTitle>Nenhum pagamento</EmptyTitle>
                <EmptyDescription>
                  Seus pagamentos aparecerão aqui após a primeira cobrança.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Metodo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Fatura</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment: PaymentRecord) => {
                  const paymentStatus = PAYMENT_STATUS[payment.status] || {
                    label: payment.status,
                    variant: 'outline' as const,
                  }
                  return (
                    <TableRow key={payment.id}>
                      <TableCell>
                        {new Date(payment.createdAt).toLocaleDateString(
                          'pt-BR',
                        )}
                      </TableCell>
                      <TableCell>{formatPrice(payment.amount)}</TableCell>
                      <TableCell>
                        {getPaymentMethodLabel(payment.paymentMethod)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={paymentStatus.variant}>
                          {paymentStatus.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {payment.asaasInvoiceUrl && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              window.open(payment.asaasInvoiceUrl!, '_blank')
                            }
                          >
                            <HugeiconsIcon icon={Invoice02Icon} size={14} />
                            Baixar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Checkout Dialog */}
      <CheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        currentPlanId={(subscription?.planId as PlanId) || 'FREE'}
      />
    </div>
  )
}

// Helper functions
function getFeatureLabel(feature: string): string {
  const labels: Record<string, string> = {
    math_engine: 'Cálculo de incerteza',
    portal: 'Portal do cliente',
    financial: 'Módulo financeiro',
    api: 'Acesso API',
    custom_domain: 'Dominio personalizado',
  }
  return labels[feature] || feature
}

function getPaymentMethodLabel(method: string): string {
  const labels: Record<string, string> = {
    CREDIT_CARD: 'Cartao',
    PIX: 'PIX',
    BOLETO: 'Boleto',
  }
  return labels[method] || method
}

// Type for payment record
interface PaymentRecord {
  id: number
  amount: number
  status: string
  paymentMethod: string
  createdAt: string
  asaasInvoiceUrl?: string | null
  asaasBankSlipUrl?: string | null
}
