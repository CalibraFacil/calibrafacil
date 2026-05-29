import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Panel, PanelHeader } from '@/components/instrument-panel'
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
  | 'STANDARD_EXPIRED'
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
  | 'CALIBRATION_REQUEST_SUBMITTED'
  | 'CALIBRATION_REQUEST_UNDER_REVIEW'
  | 'CALIBRATION_REQUEST_APPROVED'
  | 'CALIBRATION_REQUEST_REJECTED'
  | 'CALIBRATION_REQUEST_CONVERTED'

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
    id: 'CALIBRATION_REQUEST_SUBMITTED',
    title: 'Solicitação de calibração enviada',
    description: 'Quando um cliente envia uma nova solicitação pelo portal',
    category: 'operational',
  },
  {
    id: 'CALIBRATION_REQUEST_UNDER_REVIEW',
    title: 'Solicitação em análise',
    description: 'Quando o laboratório começa a analisar uma solicitação',
    category: 'operational',
  },
  {
    id: 'CALIBRATION_REQUEST_APPROVED',
    title: 'Solicitação aprovada',
    description: 'Quando uma solicitação de calibração é aprovada',
    category: 'operational',
  },
  {
    id: 'CALIBRATION_REQUEST_REJECTED',
    title: 'Solicitação recusada',
    description: 'Quando uma solicitação de calibração é recusada',
    category: 'operational',
  },
  {
    id: 'CALIBRATION_REQUEST_CONVERTED',
    title: 'Solicitação convertida em OS',
    description: 'Quando uma solicitação vira ordem de serviço',
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
    id: 'STANDARD_EXPIRED',
    title: 'Padrão de referência vencido',
    description: 'Quando um padrão de referência passa do vencimento',
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
  CALIBRATION_REQUEST_SUBMITTED: { inApp: true, email: true },
  CALIBRATION_REQUEST_UNDER_REVIEW: { inApp: true, email: true },
  CALIBRATION_REQUEST_APPROVED: { inApp: true, email: true },
  CALIBRATION_REQUEST_REJECTED: { inApp: true, email: true },
  CALIBRATION_REQUEST_CONVERTED: { inApp: true, email: true },
  ASSET_DUE_FOR_RECALIBRATION: { inApp: true, email: true },
  STANDARD_EXPIRING: { inApp: true, email: true },
  STANDARD_EXPIRED: { inApp: true, email: true },
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

  const groups = [
    { title: 'Operacionais', items: operationalSettings },
    { title: 'Conformidade', items: complianceSettings },
    { title: 'Qualidade', items: qualitySettings },
    { title: 'Pagamentos', items: billingSettings },
  ]

  if (isLoading) {
    return (
      <Panel className="space-y-3 p-5 sm:p-6">
        <Skeleton className="h-6 w-48" />
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </Panel>
    )
  }

  return (
    <div className="space-y-6">
      {/* Global preferences */}
      <Panel className="p-5 sm:p-6">
        <PanelHeader
          title="Preferências globais"
          description="Controle geral dos canais de notificação."
        />
        <div className="mt-4 divide-y divide-foreground/10">
          <div className="flex items-center justify-between gap-4 pb-4">
            <div className="space-y-0.5 pr-4">
              <label
                htmlFor="global-email"
                className="cursor-pointer text-sm font-medium"
              >
                Receber notificações por email
              </label>
              <p className="text-sm text-muted-foreground">
                Desativar desliga todos os emails de notificação.
              </p>
            </div>
            <Switch
              id="global-email"
              checked={emailEnabled}
              onCheckedChange={toggleGlobalEmail}
              disabled={updateMutation.isPending}
            />
          </div>
          <div className="flex items-center justify-between gap-4 pt-4">
            <div className="space-y-0.5 pr-4">
              <label
                htmlFor="self-notifications"
                className="cursor-pointer text-sm font-medium"
              >
                Notificar minhas próprias ações
              </label>
              <p className="text-sm text-muted-foreground">
                Receber notificações quando você atribui uma calibração para si
                mesmo.
              </p>
            </div>
            <Switch
              id="self-notifications"
              checked={notifySelfActions}
              onCheckedChange={toggleSelfNotifications}
              disabled={updateMutation.isPending}
            />
          </div>
        </div>
      </Panel>

      {/* Per-event matrix */}
      <Panel className="p-5 sm:p-6">
        <PanelHeader
          title="Por evento"
          description="Escolha como você recebe cada tipo de notificação."
        />
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] gap-3 border-b pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>Evento</span>
          <span className="text-center">No app</span>
          <span className="text-center">Email</span>
        </div>
        <div className="mt-2 space-y-6">
          {groups.map((group) => (
            <section key={group.title}>
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {group.title}
              </p>
              <div className="mt-1 divide-y divide-foreground/10">
                {group.items.map((setting) => {
                  const pref = preferences[setting.id] ?? {
                    inApp: true,
                    email: true,
                  }
                  return (
                    <div
                      key={setting.id}
                      className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center gap-3 py-2.5"
                    >
                      <div className="min-w-0 pr-2">
                        <p className="text-sm font-medium">{setting.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {setting.description}
                        </p>
                      </div>
                      <div className="flex justify-center">
                        <Switch
                          checked={pref.inApp}
                          onCheckedChange={() =>
                            togglePreference(setting.id, 'inApp')
                          }
                          disabled={updateMutation.isPending}
                        />
                      </div>
                      <div className="flex justify-center">
                        <Switch
                          checked={pref.email && emailEnabled}
                          onCheckedChange={() =>
                            togglePreference(setting.id, 'email')
                          }
                          disabled={!emailEnabled || updateMutation.isPending}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      </Panel>
    </div>
  )
}
