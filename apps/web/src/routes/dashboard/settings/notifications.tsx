import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'

export const Route = createFileRoute('/dashboard/settings/notifications')({
  head: () => ({
    meta: [{ title: 'Notificações | Configurações | CalibraFácil' }],
  }),
  component: NotificationsSettingsPage,
})

interface NotificationSetting {
  id: string
  title: string
  description: string
  enabled: boolean
}

function NotificationsSettingsPage() {
  // Mock state - in real implementation, this would be persisted
  const [emailNotifications, setEmailNotifications] = useState<
    Array<NotificationSetting>
  >([
    {
      id: 'calibration-complete',
      title: 'Calibração concluída',
      description: 'Receba um email quando uma calibração for finalizada',
      enabled: true,
    },
    {
      id: 'calibration-pending',
      title: 'Calibração pendente de aprovação',
      description:
        'Receba um email quando uma calibração estiver aguardando sua aprovação',
      enabled: true,
    },
    {
      id: 'certificate-available',
      title: 'Certificado disponível',
      description:
        'Receba um email quando um certificado estiver pronto para download',
      enabled: false,
    },
    {
      id: 'equipment-due',
      title: 'Ativo com calibração vencendo',
      description:
        'Receba um email quando um ativo estiver próximo da data de recalibração',
      enabled: true,
    },
  ])

  const [marketingNotifications, setMarketingNotifications] = useState<
    Array<NotificationSetting>
  >([
    {
      id: 'product-updates',
      title: 'Novidades e atualizações',
      description:
        'Receba emails sobre novos recursos e melhorias do CalibraFácil',
      enabled: false,
    },
    {
      id: 'tips-tutorials',
      title: 'Dicas e tutoriais',
      description: 'Receba dicas para aproveitar melhor a plataforma',
      enabled: false,
    },
  ])

  const toggleEmailNotification = (id: string) => {
    setEmailNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, enabled: !n.enabled } : n)),
    )
    // In real implementation: persist to backend
  }

  const toggleMarketingNotification = (id: string) => {
    setMarketingNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, enabled: !n.enabled } : n)),
    )
    // In real implementation: persist to backend
  }

  return (
    <div className="space-y-6">
      {/* Email Notifications */}
      <Card>
        <CardHeader>
          <CardTitle>Notificações por Email</CardTitle>
          <CardDescription>
            Escolha quais notificações você deseja receber por email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {emailNotifications.map((notification, index) => (
              <div key={notification.id}>
                {index > 0 && <Separator className="my-4" />}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <label
                      htmlFor={notification.id}
                      className="text-sm font-medium cursor-pointer"
                    >
                      {notification.title}
                    </label>
                    <p className="text-sm text-muted-foreground">
                      {notification.description}
                    </p>
                  </div>
                  <Switch
                    id={notification.id}
                    checked={notification.enabled}
                    onCheckedChange={() =>
                      toggleEmailNotification(notification.id)
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Marketing Notifications */}
      <Card>
        <CardHeader>
          <CardTitle>Comunicacoes de Marketing</CardTitle>
          <CardDescription>
            Gerencie suas preferências de comunicação promocional.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {marketingNotifications.map((notification, index) => (
              <div key={notification.id}>
                {index > 0 && <Separator className="my-4" />}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <label
                      htmlFor={notification.id}
                      className="text-sm font-medium cursor-pointer"
                    >
                      {notification.title}
                    </label>
                    <p className="text-sm text-muted-foreground">
                      {notification.description}
                    </p>
                  </div>
                  <Switch
                    id={notification.id}
                    checked={notification.enabled}
                    onCheckedChange={() =>
                      toggleMarketingNotification(notification.id)
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
