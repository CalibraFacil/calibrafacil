import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Delete02Icon, Logout01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { useSettings } from '@/contexts/settings-context'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
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

export const Route = createFileRoute('/dashboard/settings/danger')({
  head: () => ({
    meta: [{ title: 'Zona de Perigo | Configurações | CalibraFácil' }],
  }),
  component: DangerSettingsPage,
})

function DangerSettingsPage() {
  const { revokeAllSessions, deleteAccount, isUpdating } = useSettings()

  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [signOutDialogOpen, setSignOutDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const handleSignOutEverywhere = async () => {
    setIsSigningOut(true)
    try {
      await revokeAllSessions()
      // Redirect to sign-in after global logout
      window.location.href = '/sign-in'
    } catch (err) {
      console.error('Failed to sign out everywhere:', err)
      setIsSigningOut(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      setDeleteError('Digite sua senha para confirmar')
      return
    }

    setDeleteError(null)
    setIsDeleting(true)

    try {
      await deleteAccount(deletePassword)
      // Redirect to home page after deletion
      window.location.href = '/'
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Falha ao excluir conta',
      )
      setIsDeleting(false)
    }
  }

  const resetDeleteDialog = () => {
    setDeletePassword('')
    setDeleteError(null)
    setDeleteDialogOpen(false)
  }

  return (
    <div className="space-y-6">
      {/* Sign Out Everywhere */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">
            Sair de Todos os Dispositivos
          </CardTitle>
          <CardDescription>
            Encerre todas as suas sessões ativas em todos os dispositivos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog
            open={signOutDialogOpen}
            onOpenChange={setSignOutDialogOpen}
          >
            <AlertDialogTrigger
              render={
                <Button variant="destructive">
                  <HugeiconsIcon icon={Logout01Icon} />
                  Sair de todos os dispositivos
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Sair de todos os dispositivos?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Esta ação irá encerrar todas as suas sessões ativas, incluindo
                  esta. Você precisará fazer login novamente.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isSigningOut}>
                  Cancelar
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleSignOutEverywhere}
                  disabled={isSigningOut || isUpdating}
                >
                  {isSigningOut ? 'Saindo...' : 'Confirmar'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  )
}
