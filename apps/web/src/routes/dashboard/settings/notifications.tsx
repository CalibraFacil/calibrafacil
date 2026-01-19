import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
import { api } from '@/utils/api'

export const Route = createFileRoute('/dashboard/settings/notifications')({
  head: () => ({
    meta: [{ title: 'Notificações | Configurações | CalibraFácil' }],
  }),
  component: NotificationsSettingsPage,
})

type NotificationType =
  | 'JOB_SUBMITTED_FOR_REVIEW'
  | 'JOB_APPROVED'
  | 'JOB_REJECTED'
  | 'JOB_ASSIGNED'
  | 'CERTIFICATE_READY'
  | 'ASSET_DUE_FOR_RECALIBRATION'
  | 'STANDARD_EXPIRING'
  | 'JOB_OVERDUE'
  | 'PAYMENT_RECEIVED'
  | 'PAYMENT_FAILED'

type NotificationPreference = {
  inApp: boolean
  email: boolean
}

type NotificationPreferencesMap = Partial<Record<NotificationType, NotificationPreference>>

interface NotificationSetting {
  id: NotificationType
  title: string
  description: string
  category: 'operational' | 'compliance' | 'billing'
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
  ASSET_DUE_FOR_RECALIBRATION: { inApp: true, email: true },
  STANDARD_EXPIRING: { inApp: true, email: true },
  JOB_OVERDUE: { inApp: true, email: true },
  PAYMENT_RECEIVED: { inApp: true, email: true },
  PAYMENT_FAILED: { inApp: true, email: true },
}

function NotificationsSettingsPage() {
  const queryClient = useQueryClient()

  // Fetch preferences
  const { data: prefsData, isLoading } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: async () => {
      const res = await api.api.notifications.preferences.$get()
      if (!res.ok) throw new Error('Failed to fetch preferences')
      return res.json()
    },
  })

  // Update preferences mutation
  const updateMutation = useMutation({
    mutationFn: async (data: {
      preferences?: NotificationPreferencesMap
      emailEnabled?: boolean
      notifySelfActions?: boolean
    }) => {
      const res = await api.api.notifications.preferences.$put({
        json: data,
      })
      if (!res.ok) throw new Error('Failed to update preferences')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] })
      toast.success('Preferências atualizadas')
    },
    onError: () => {
      toast.error('Erro ao atualizar preferências')
    },
  })

  const preferences = prefsData?.preferences ?? defaultPreferences
  const emailEnabled = prefsData?.emailEnabled ?? true
  const notifySelfActions = prefsData?.notifySelfActions ?? false

  const togglePreference = (
    notificationType: NotificationType,
    channel: 'inApp' | 'email',
  ) => {
    const current = preferences[notificationType] ?? { inApp: true, email: true }
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
                Receber notificações quando você atribui uma calibração para si mesmo
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
              const pref = preferences[setting.id] ?? { inApp: true, email: true }
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
                          disabled={updateMutation.isPending || !emailEnabled}
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
              const pref = preferences[setting.id] ?? { inApp: true, email: true }
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
                          disabled={updateMutation.isPending || !emailEnabled}
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
              const pref = preferences[setting.id] ?? { inApp: true, email: true }
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
                          disabled={updateMutation.isPending || !emailEnabled}
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
