import { useState } from 'react'
import { Logout01Icon } from '@hugeicons/core-free-icons'
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

export function DangerSettingsPage() {
  const { revokeAllSessions, isUpdating } = useSettings()

  const [isSigningOut, setIsSigningOut] = useState(false)
  const [signOutDialogOpen, setSignOutDialogOpen] = useState(false)

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
