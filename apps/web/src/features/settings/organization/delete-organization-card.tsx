import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Delete02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { signOut } from '@calibra-facil/auth/client'
import { calibraApi } from '@/utils/api'
import { parseSoftDeleteOrganizationForm } from '@/features/settings/organization/delete-organization-form'
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
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

/**
 * Danger zone of the organization settings. Records retention (decision Q16):
 * "excluir" is a soft delete. The laboratory's regulated records are kept for
 * the retention period (10 years by default, never below 5), the laboratory is
 * locked and its API keys are revoked. Owner only (the API enforces it too).
 */
export function DeleteOrganizationCard({
  organizationName,
}: {
  organizationName: string
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [reason, setReason] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  const parsed = parseSoftDeleteOrganizationForm({
    organizationName,
    confirmName,
    reason,
  })

  const handleOpenChange = (next: boolean) => {
    if (isDeleting) return
    if (!next) {
      setConfirmName('')
      setReason('')
    }
    setOpen(next)
  }

  const handleDelete = async () => {
    if (!parsed.ok) {
      toast.error(parsed.error)
      return
    }

    setIsDeleting(true)
    try {
      await calibraApi.organizationLifecycle.softDelete(parsed.value)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Falha ao excluir a organização',
      )
      setIsDeleting(false)
      return
    }

    toast.success('Organização excluída. Os registros foram mantidos.')
    // The laboratory is locked from now on: end this session and leave.
    await signOut().catch(() => undefined)
    // Nothing cached may outlive the organization it belonged to.
    queryClient.clear()
    window.location.replace('/sign-in')
  }

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-destructive">Excluir organização</CardTitle>
        <CardDescription>
          A organização é bloqueada e deixa de aparecer para os membros. Os
          registros regulados (calibrações, certificados e trilhas de auditoria)
          são mantidos durante o período de retenção.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog open={open} onOpenChange={handleOpenChange}>
          <AlertDialogTrigger
            render={
              <Button variant="destructive">
                <HugeiconsIcon icon={Delete02Icon} />
                Excluir organização
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir esta organização?</AlertDialogTitle>
              <AlertDialogDescription>
                Os registros regulados são mantidos durante o período de
                retenção (no mínimo 10 anos, salvo configuração da organização)
                e só podem ser removidos depois dele. A organização será
                bloqueada: ninguém conseguirá entrar, as chaves de API serão
                revogadas e esta sessão será encerrada. Os certificados já
                emitidos continuam verificáveis.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <FieldGroup className="py-4">
              <Field>
                <FieldLabel htmlFor="delete-reason">
                  Motivo da exclusão
                </FieldLabel>
                <Textarea
                  id="delete-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Ex.: encerramento das atividades do laboratório"
                  disabled={isDeleting}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="delete-confirm-name">
                  Digite <strong>{organizationName}</strong> para confirmar
                </FieldLabel>
                <Input
                  id="delete-confirm-name"
                  value={confirmName}
                  onChange={(event) => setConfirmName(event.target.value)}
                  placeholder={organizationName}
                  disabled={isDeleting}
                />
              </Field>
            </FieldGroup>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                disabled={isDeleting || !parsed.ok}
                variant="destructive"
              >
                {isDeleting ? 'Excluindo...' : 'Excluir e bloquear'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}
