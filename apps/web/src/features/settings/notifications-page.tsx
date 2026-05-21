import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { calibraApi } from '@/utils/api'
import { useNotificationPreferencesData } from '@/features/settings/queries'

type NotificationType =
  | 'JOB_SUBMITTED_FOR_REVIEW'
  | 'JOB_APPROVED'
  | 'JOB_REJECTED'
  | 'JOB_ASSIGNED'
  | 'CERTIFICATE_READY'
  | 'CERTIFICATE_AMENDED'
  | 'ASSET_DUE_FOR_RECALIBRATION'
  | 'STANDARD_EXPIRING'
  | 'JOB_OVERDUE'
  | 'PAYMENT_RECEIVED'
  | 'PAYMENT_FAILED'
  | 'NC_CREATED'
  | 'NC_ESCALATED_TO_CAPA'
  | 'COMPETENCE_EXPIRING'
  | 'COMPETENCE_EXPIRED'
  | 'COMPETENCE_REQUESTED'
  | 'COMPETENCE_APPROVED'
  | 'CUSTOMER_SUCCESS_WORKFLOW_BLOCKED'
  | 'CUSTOMER_SUCCESS_GO_LIVE_AT_RISK'
  | 'CUSTOMER_SUCCESS_NEXT_ACTION_OVERDUE'
  | 'CUSTOMER_SUCCESS_SLA_DUE_SOON'
  | 'CUSTOMER_SUCCESS_SLA_BREACHED'
  | 'CUSTOMER_SUCCESS_ESCALATION_REQUIRED'

type NotificationPreference = {
  inApp: boolean
  email: boolean
}

type NotificationPreferencesMap = Partial<
  Record<NotificationType, NotificationPreference>
>

interface NotificationSetting {
  id: NotificationType
  title: string
  description: string
  category: 'operational' | 'compliance' | 'quality' | 'billing'
}

const notificationSettings: NotificationSetting[] = [
  // Operational notifications
  {
    id: 'JOB_SUBMITTED_FOR_REVIEW',
    title: 'Calibração submetida para revisão',
    description: 'Quando uma calibração é enviada para aprovação',
    category: 'operational',
  },
  {
    id: 'JOB_APPROVED',
    title: 'Calibração aprovada',
    description: 'Quando sua calibração é aprovada',
    category: 'operational',
  },
  {
    id: 'JOB_REJECTED',
    title: 'Calibração rejeitada',
    description: 'Quando sua calibração é rejeitada',
    category: 'operational',
  },
  {
    id: 'JOB_ASSIGNED',
    title: 'Calibração atribuída',
    description: 'Quando uma calibração é atribuída a você',
    category: 'operational',
  },
  {
    id: 'CERTIFICATE_READY',
    title: 'Certificado disponível',
    description: 'Quando um certificado está pronto para download',
    category: 'operational',
  },
  {
    id: 'CERTIFICATE_AMENDED',
    title: 'Certificado retificado',
    description: 'Quando um certificado é retificado',
    category: 'operational',
  },
  {
    id: 'CUSTOMER_SUCCESS_WORKFLOW_BLOCKED',
    title: 'Workflow bloqueado',
    description:
      'Quando onboarding, migração ou go-live entra em bloqueio ativo',
    category: 'operational',
  },
  {
    id: 'CUSTOMER_SUCCESS_GO_LIVE_AT_RISK',
    title: 'Go-live em risco',
    description: 'Quando a operação identifica risco relevante para o go-live',
    category: 'operational',
  },
  {
    id: 'CUSTOMER_SUCCESS_NEXT_ACTION_OVERDUE',
    title: 'Próxima ação atrasada',
    description: 'Quando o plano de acompanhamento fica com ação vencida',
    category: 'operational',
  },
  {
    id: 'CUSTOMER_SUCCESS_SLA_DUE_SOON',
    title: 'SLA prestes a vencer',
    description: 'Quando uma solicitação de suporte se aproxima do vencimento',
    category: 'operational',
  },
  {
    id: 'CUSTOMER_SUCCESS_SLA_BREACHED',
    title: 'SLA violado',
    description: 'Quando uma solicitação de suporte ultrapassa o SLA alvo',
    category: 'operational',
  },
  {
    id: 'CUSTOMER_SUCCESS_ESCALATION_REQUIRED',
    title: 'Escalação necessária',
    description: 'Quando o suporte entra em estado de escalação prioritária',
    category: 'operational',
  },
  // Compliance notifications
  {
    id: 'ASSET_DUE_FOR_RECALIBRATION',
    title: 'Ativo vencendo calibração',
    description: 'Quando um ativo do cliente está próximo da recalibração',
    category: 'compliance',
  },
  {
    id: 'STANDARD_EXPIRING',
    title: 'Padrão de referência vencendo',
    description: 'Quando um padrão de referência está próximo do vencimento',
    category: 'compliance',
  },
  {
    id: 'JOB_OVERDUE',
    title: 'Calibração atrasada',
    description: 'Quando uma calibração passa da data de entrega',
    category: 'compliance',
  },
  {
    id: 'COMPETENCE_REQUESTED',
    title: 'Competência solicitada',
    description: 'Quando uma nova solicitação de competência é criada',
    category: 'compliance',
  },
  {
    id: 'COMPETENCE_APPROVED',
    title: 'Competência aprovada',
    description: 'Quando uma competência é aprovada',
    category: 'compliance',
  },
  {
    id: 'COMPETENCE_EXPIRING',
    title: 'Competência expirando',
    description: 'Quando uma competência está próxima da expiração',
    category: 'compliance',
  },
  {
    id: 'COMPETENCE_EXPIRED',
    title: 'Competência expirada',
    description: 'Quando uma competência expira',
    category: 'compliance',
  },
  // Quality notifications (ISO 17025 Clause 8.7)
  {
    id: 'NC_CREATED',
    title: 'Não conformidade registrada',
    description: 'Quando uma nova NC é registrada no sistema',
    category: 'quality',
  },
  {
    id: 'NC_ESCALATED_TO_CAPA',
    title: 'NC escalada para CAPA',
    description: 'Quando uma NC é escalada para ação corretiva',
    category: 'quality',
  },
  // Billing notifications
  {
    id: 'PAYMENT_RECEIVED',
    title: 'Pagamento recebido',
    description: 'Quando um pagamento é confirmado',
    category: 'billing',
  },
  {
    id: 'PAYMENT_FAILED',
    title: 'Pagamento falhou',
    description: 'Quando um pagamento não é processado',
    category: 'billing',
  },
]

const defaultPreferences: NotificationPreferencesMap = {
  JOB_SUBMITTED_FOR_REVIEW: { inApp: true, email: true },
  JOB_APPROVED: { inApp: true, email: true },
  JOB_REJECTED: { inApp: true, email: true },
  JOB_ASSIGNED: { inApp: true, email: false },
  CERTIFICATE_READY: { inApp: true, email: true },
  CERTIFICATE_AMENDED: { inApp: true, email: true },
  ASSET_DUE_FOR_RECALIBRATION: { inApp: true, email: true },
  STANDARD_EXPIRING: { inApp: true, email: true },
  JOB_OVERDUE: { inApp: true, email: true },
  NC_CREATED: { inApp: true, email: true },
  NC_ESCALATED_TO_CAPA: { inApp: true, email: true },
  COMPETENCE_EXPIRING: { inApp: true, email: true },
  COMPETENCE_EXPIRED: { inApp: true, email: true },
  COMPETENCE_REQUESTED: { inApp: true, email: true },
  COMPETENCE_APPROVED: { inApp: true, email: true },
  CUSTOMER_SUCCESS_WORKFLOW_BLOCKED: { inApp: true, email: true },
  CUSTOMER_SUCCESS_GO_LIVE_AT_RISK: { inApp: true, email: true },
  CUSTOMER_SUCCESS_NEXT_ACTION_OVERDUE: { inApp: true, email: true },
  CUSTOMER_SUCCESS_SLA_DUE_SOON: { inApp: true, email: true },
  CUSTOMER_SUCCESS_SLA_BREACHED: { inApp: true, email: true },
  CUSTOMER_SUCCESS_ESCALATION_REQUIRED: { inApp: true, email: true },
  PAYMENT_RECEIVED: { inApp: true, email: true },
  PAYMENT_FAILED: { inApp: true, email: true },
}

export function NotificationsSettingsPage() {
  const queryClient = useQueryClient()

  const { data: prefsData, isLoading } = useNotificationPreferencesData()

  // Update preferences mutation with optimistic updates
  const updateMutation = useMutation({
    mutationFn: async (data: {
      preferences?: NotificationPreferencesMap
      emailEnabled?: boolean
      notifySelfActions?: boolean
    }) => calibraApi.notifications.updatePreferences(data),
    onMutate: async (newData) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: ['notification-preferences'],
      })

      // Snapshot previous value
      const previousData = queryClient.getQueryData([
        'notification-preferences',
      ])

      // Optimistically update
      queryClient.setQueryData(
        ['notification-preferences'],
        (old: typeof prefsData) => {
          if (!old) return old
          return {
            ...old,
            ...(newData.emailEnabled !== undefined && {
              emailEnabled: newData.emailEnabled,
            }),
            ...(newData.preferences && {
              preferences: { ...old.preferences, ...newData.preferences },
            }),
          }
        },
      )

      return { previousData }
    },
    onError: (_err, _newData, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(
          ['notification-preferences'],
          context.previousData,
        )
      }
      toast.error('Erro ao atualizar preferências')
    },
    onSettled: () => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] })
    },
  })

  const preferences = prefsData?.preferences ?? defaultPreferences
  const emailEnabled = prefsData?.emailEnabled ?? true
  const notifySelfActions = prefsData?.notifySelfActions ?? false

  const togglePreference = (
    notificationType: NotificationType,
    channel: 'inApp' | 'email',
  ) => {
    const current = preferences[notificationType] ?? {
      inApp: true,
      email: true,
    }
    const updated = {
      ...current,
      [channel]: !current[channel],
    }

    updateMutation.mutate({
      preferences: {
        [notificationType]: updated,
      },
    })
  }

  const toggleGlobalEmail = () => {
    updateMutation.mutate({
      emailEnabled: !emailEnabled,
    })
  }

  const toggleSelfNotifications = () => {
    updateMutation.mutate({
      notifySelfActions: !notifySelfActions,
    })
  }

  const operationalSettings = notificationSettings.filter(
    (s) => s.category === 'operational',
  )
  const complianceSettings = notificationSettings.filter(
    (s) => s.category === 'compliance',
  )
  const qualitySettings = notificationSettings.filter(
    (s) => s.category === 'quality',
  )
  const billingSettings = notificationSettings.filter(
    (s) => s.category === 'billing',
  )

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex justify-between items-center">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-64" />
                </div>
                <Skeleton className="h-6 w-10" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Global Email Toggle */}
      <Card>
        <CardHeader>
          <CardTitle>Preferências Globais</CardTitle>
          <CardDescription>
            Controle geral de notificações por email
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 pr-4">
              <label
                htmlFor="global-email"
                className="text-sm font-medium cursor-pointer"
              >
                Receber notificações por email
              </label>
              <p className="text-sm text-muted-foreground">
                Desativar esta opção desliga todos os emails de notificação
              </p>
            </div>
            <Switch
              id="global-email"
              checked={emailEnabled}
              onCheckedChange={toggleGlobalEmail}
              disabled={updateMutation.isPending}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 pr-4">
              <label
                htmlFor="self-notifications"
                className="text-sm font-medium cursor-pointer"
              >
                Notificar minhas próprias ações
              </label>
              <p className="text-sm text-muted-foreground">
                Receber notificações quando você atribui uma calibração para si
                mesmo
              </p>
            </div>
            <Switch
              id="self-notifications"
              checked={notifySelfActions}
              onCheckedChange={toggleSelfNotifications}
              disabled={updateMutation.isPending}
            />
          </div>
        </CardContent>
      </Card>

      {/* Operational Notifications */}
      <Card>
        <CardHeader>
          <CardTitle>Notificações Operacionais</CardTitle>
          <CardDescription>
            Atualizações sobre calibrações e fluxo de trabalho
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {operationalSettings.map((setting, index) => {
              const pref = preferences[setting.id] ?? {
                inApp: true,
                email: true,
              }
              return (
                <div key={setting.id}>
                  {index > 0 && <Separator className="my-4" />}
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-0.5 flex-1">
                      <label className="text-sm font-medium">
                        {setting.title}
                      </label>
                      <p className="text-sm text-muted-foreground">
                        {setting.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          App
                        </span>
                        <Switch
                          checked={pref.inApp}
                          onCheckedChange={() =>
                            togglePreference(setting.id, 'inApp')
                          }
                          disabled={updateMutation.isPending}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          Email
                        </span>
                        <Switch
                          checked={pref.email && emailEnabled}
                          onCheckedChange={() =>
                            togglePreference(setting.id, 'email')
                          }
                          disabled={!emailEnabled || updateMutation.isPending}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Compliance Notifications */}
      <Card>
        <CardHeader>
          <CardTitle>Alertas de Conformidade</CardTitle>
          <CardDescription>
            Lembretes para manter a conformidade ISO 17025
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {complianceSettings.map((setting, index) => {
              const pref = preferences[setting.id] ?? {
                inApp: true,
                email: true,
              }
              return (
                <div key={setting.id}>
                  {index > 0 && <Separator className="my-4" />}
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-0.5 flex-1">
                      <label className="text-sm font-medium">
                        {setting.title}
                      </label>
                      <p className="text-sm text-muted-foreground">
                        {setting.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          App
                        </span>
                        <Switch
                          checked={pref.inApp}
                          onCheckedChange={() =>
                            togglePreference(setting.id, 'inApp')
                          }
                          disabled={updateMutation.isPending}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          Email
                        </span>
                        <Switch
                          checked={pref.email && emailEnabled}
                          onCheckedChange={() =>
                            togglePreference(setting.id, 'email')
                          }
                          disabled={!emailEnabled || updateMutation.isPending}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Quality Notifications */}
      <Card>
        <CardHeader>
          <CardTitle>Qualidade</CardTitle>
          <CardDescription>
            Notificações de não conformidades e ações corretivas (ISO 17025
            Cláusula 8.7)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {qualitySettings.map((setting, index) => {
              const pref = preferences[setting.id] ?? {
                inApp: true,
                email: true,
              }
              return (
                <div key={setting.id}>
                  {index > 0 && <Separator className="my-4" />}
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-0.5 flex-1">
                      <label className="text-sm font-medium">
                        {setting.title}
                      </label>
                      <p className="text-sm text-muted-foreground">
                        {setting.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          App
                        </span>
                        <Switch
                          checked={pref.inApp}
                          onCheckedChange={() =>
                            togglePreference(setting.id, 'inApp')
                          }
                          disabled={updateMutation.isPending}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          Email
                        </span>
                        <Switch
                          checked={pref.email && emailEnabled}
                          onCheckedChange={() =>
                            togglePreference(setting.id, 'email')
                          }
                          disabled={!emailEnabled || updateMutation.isPending}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Billing Notifications */}
      <Card>
        <CardHeader>
          <CardTitle>Notificações de Pagamento</CardTitle>
          <CardDescription>
            Atualizações sobre faturamento e pagamentos
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {billingSettings.map((setting, index) => {
              const pref = preferences[setting.id] ?? {
                inApp: true,
                email: true,
              }
              return (
                <div key={setting.id}>
                  {index > 0 && <Separator className="my-4" />}
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-0.5 flex-1">
                      <label className="text-sm font-medium">
                        {setting.title}
                      </label>
                      <p className="text-sm text-muted-foreground">
                        {setting.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          App
                        </span>
                        <Switch
                          checked={pref.inApp}
                          onCheckedChange={() =>
                            togglePreference(setting.id, 'inApp')
                          }
                          disabled={updateMutation.isPending}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          Email
                        </span>
                        <Switch
                          checked={pref.email && emailEnabled}
                          onCheckedChange={() =>
                            togglePreference(setting.id, 'email')
                          }
                          disabled={!emailEnabled || updateMutation.isPending}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
