import { useSettings } from '@/contexts/settings-context'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

const SESSION_DATETIME_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function SecuritySettingsPage() {
  const {
    session,
    sessions,
    sessionsLoading,
    revokeSession,
    revokeOtherSessions,
    isUpdating,
  } = useSettings()

  const formatDate = (date: Date) => {
    return SESSION_DATETIME_FORMAT.format(date)
  }

  const parseUserAgent = (userAgent: string | null | undefined) => {
    if (!userAgent) return 'Dispositivo desconhecido'
    // Simple user agent parsing
    if (userAgent.includes('Chrome')) return 'Chrome'
    if (userAgent.includes('Firefox')) return 'Firefox'
    if (userAgent.includes('Safari')) return 'Safari'
    if (userAgent.includes('Edge')) return 'Edge'
    return 'Navegador desconhecido'
  }

  return (
    <div className="space-y-6">
      {/* Active Sessions Card */}
      <Card>
        <CardHeader>
          <CardTitle>Sessões Ativas</CardTitle>
          <CardDescription>
            Gerencie os dispositivos conectados à sua conta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sessionsLoading ? (
            <SessionsSkeleton />
          ) : (
            <div className="space-y-4">
              {sessions.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Nenhuma sessão ativa encontrada.
                </p>
              ) : (
                sessions.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {parseUserAgent(s.userAgent)}
                        </span>
                        {s.id === session?.id && (
                          <Badge variant="secondary">Atual</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Criado em: {formatDate(s.createdAt)}
                      </p>
                      {s.ipAddress && (
                        <p className="text-xs text-muted-foreground">
                          IP: {s.ipAddress}
                        </p>
                      )}
                    </div>
                    {s.id !== session?.id && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => revokeSession(s.id)}
                        disabled={isUpdating}
                      >
                        Encerrar
                      </Button>
                    )}
                  </div>
                ))
              )}

              {sessions.length > 1 && (
                <>
                  <Separator />
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      onClick={() => revokeOtherSessions()}
                      disabled={isUpdating}
                    >
                      Encerrar outras sessões
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function SessionsSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex items-center justify-between p-4 border rounded-lg"
        >
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
    </div>
  )
}
