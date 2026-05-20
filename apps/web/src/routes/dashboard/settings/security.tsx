import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'

import { useSettings } from '@/contexts/settings-context'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/dashboard/settings/security')({
  head: () => ({
    meta: [{ title: 'Segurança | Configurações | CalibraFácil' }],
  }),
  component: SecuritySettingsPage,
})

function SecuritySettingsPage() {
  const {
    session,
    sessions,
    sessionsLoading,
    changePassword,
    revokeSession,
    revokeOtherSessions,
    isUpdating,
  } = useSettings()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [isChangingPassword, setIsChangingPassword] = useState(false)

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError(null)

    if (!currentPassword) {
      setPasswordError('Digite sua senha atual')
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('As senhas não coincidem')
      return
    }

    if (newPassword.length < 8) {
      setPasswordError('A senha deve ter pelo menos 8 carácteres')
      return
    }

    setIsChangingPassword(true)
    try {
      await changePassword({ currentPassword, newPassword })
      toast.success('Senha alterada com sucesso!')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Falha ao alterar senha'
      toast.error(message)
    } finally {
      setIsChangingPassword(false)
    }
  }

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date)
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
      {/* Password Change Card */}
      <Card>
        <CardHeader>
          <CardTitle>Alterar Senha</CardTitle>
          <CardDescription>
            Atualize sua senha para manter sua conta segura.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordChange}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="current-password">Senha atual</FieldLabel>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value)
                    setPasswordError(null)
                  }}
                  disabled={isChangingPassword}
                  placeholder="Digite sua senha atual"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-password">Nova senha</FieldLabel>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value)
                    setPasswordError(null)
                  }}
                  disabled={isChangingPassword}
                  placeholder="Digite sua nova senha"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="confirm-password">
                  Confirmar nova senha
                </FieldLabel>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value)
                    setPasswordError(null)
                  }}
                  disabled={isChangingPassword}
                  placeholder="Confirme sua nova senha"
                />
                {passwordError && <FieldError>{passwordError}</FieldError>}
              </Field>

              <div className="flex justify-end">
                <Button type="submit" disabled={isChangingPassword}>
                  {isChangingPassword ? 'Alterando...' : 'Alterar senha'}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

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
