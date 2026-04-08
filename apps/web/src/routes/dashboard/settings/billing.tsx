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
import { usePlanAccess } from '@/hooks/use-plan-access'
import { api } from '@/utils/api'
import {
  ENTITLEMENT_METADATA,
  formatPrice,
  getEnabledEntitlements,
  isValidPlanId,
  type FeatureFlag,
  type PlanId,
} from '@calibra-facil/shared'

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
  const accessQuery = usePlanAccess()
  const accessReady = accessQuery.isSuccess && !!accessQuery.data
  const accessPlanId =
    accessReady && isValidPlanId(accessQuery.data.planId)
      ? accessQuery.data.planId
      : undefined
  const hasFinancialModule = accessReady
    ? accessQuery.data.hasFinancialModule ?? accessQuery.data.hasFinancial ?? false
    : false
  const canManageBilling = accessReady
    ? accessQuery.data.canManageBilling ?? true
    : false

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
    enabled: accessReady && canManageBilling,
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
    enabled: accessReady && canManageBilling,
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
    plan: accessQuery.data
      ? {
          id: accessPlanId ?? 'FREE',
          name: accessQuery.data.planName,
          description: '',
        }
      : null,
    usage: { jobsCreated: 0, users: 0, storage: 0 },
    limits:
      accessQuery.data?.limits ?? {
        certificates: 10,
        users: 1,
        storage: 100 * 1024 * 1024,
      },
  }

  const payments = paymentsQuery.data?.data || []
  const selectedPlanId = plan?.id && isValidPlanId(plan.id) ? plan.id : undefined
  const enabledEntitlements = selectedPlanId
    ? getEnabledEntitlements(selectedPlanId)
    : []

  const statusBadge =
    STATUS_BADGES[subscription?.status || 'TRIAL'] || STATUS_BADGES.TRIAL

  // Calculate usage percentages
  const jobsCreatedPercentage = limits?.certificates
    ? Math.min(100, (usage.jobsCreated / limits.certificates) * 100)
    : 0
  const userPercentage = limits?.users
    ? Math.min(100, (usage.users / limits.users) * 100)
    : 0

  return (
    <div className="space-y-6">
      {!hasFinancialModule && accessQuery.data && (
        <Card>
          <CardHeader>
            <CardTitle>Módulo Financeiro indisponível</CardTitle>
            <CardDescription>
              Seu plano atual é {accessQuery.data.planName}. O módulo financeiro
              fica disponível a partir do plano Professional.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4 rounded-lg border p-4">
            <div className="space-y-1">
              <p className="font-medium">
                Faça upgrade para liberar o módulo financeiro avançado
              </p>
              <p className="text-sm text-muted-foreground">
                Você ainda pode gerenciar sua assinatura e acompanhar cobranças
                neste painel. O upgrade libera os recursos operacionais do
                módulo financeiro.
              </p>
            </div>
            <Button onClick={() => setCheckoutOpen(true)}>
              <HugeiconsIcon icon={Rocket01Icon} size={16} />
              Fazer upgrade
            </Button>
          </CardContent>
        </Card>
      )}

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
              {plan?.description && (
                <p className="text-sm text-muted-foreground">{plan.description}</p>
              )}
              {plan?.recommendedFor && (
                <p className="text-sm font-medium text-primary">
                  {plan.recommendedFor}
                </p>
              )}
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
                <span className="font-medium">Ordens criadas este mês</span>
                <span className="text-muted-foreground">
                  {usage.jobsCreated} /{' '}
                  {limits?.certificates === 999999
                    ? 'Ilimitado'
                    : limits?.certificates}
                </span>
              </div>
              <Progress value={jobsCreatedPercentage} className="h-2" />
              {jobsCreatedPercentage >= 80 &&
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
          {enabledEntitlements.length > 0 && (
            <div className="p-4 border rounded-lg">
              <p className="text-sm font-medium mb-2">Recursos inclusos:</p>
              <div className="flex flex-wrap gap-2">
                {enabledEntitlements.map((feature) => (
                  <Badge key={feature} variant="secondary">
                    {getFeatureLabel(feature)}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {canManageBilling && (
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
                                window.open(
                                  payment.asaasInvoiceUrl!,
                                  '_blank',
                                  'noopener,noreferrer',
                                )
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
      )}

      {/* Checkout Dialog */}
      <CheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        currentPlanId={
          (subscription?.planId &&
          isValidPlanId(subscription.planId)
            ? subscription.planId
            : undefined) ??
          accessPlanId ??
          'FREE'
        }
      />
    </div>
  )
}

// Helper functions
function getFeatureLabel(feature: string): string {
  const metadata = ENTITLEMENT_METADATA[feature as FeatureFlag]
  return metadata?.name || feature
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
