import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Mail01Icon,
  MoreHorizontalIcon,
  ShieldKeyIcon,
  UserBlock01Icon,
  UserSwitchIcon,
} from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { BackofficeUser } from '@/features/backoffice/types'
import { getAssignablePlatformRole, toAssignablePlatformRole } from './model'
import type { UserMutations } from './mutations'

/**
 * One overflow menu per row — every action (impersonate, role, ban, password
 * setup) lives here instead of behind row-expansion. Impersonation opens a
 * governed reason dialog whose justification is recorded in the audit log.
 */
export function UserActionsMenu({
  user,
  isCurrentUser,
  canManageRoles,
  mutations,
}: {
  user: BackofficeUser
  isCurrentUser: boolean
  canManageRoles: boolean
  mutations: UserMutations
}) {
  const [impersonateOpen, setImpersonateOpen] = useState(false)
  const role = getAssignablePlatformRole(user.role)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Ações para ${user.name}`}
            />
          }
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            disabled={isCurrentUser}
            onClick={() => setImpersonateOpen(true)}
          >
            <HugeiconsIcon icon={UserSwitchIcon} className="size-4" />
            Impersonar
          </DropdownMenuItem>

          {canManageRoles ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Papel de plataforma</DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuRadioGroup
                value={role}
                onValueChange={(value) =>
                  mutations.setRole.mutate({
                    userId: user.id,
                    role: toAssignablePlatformRole(value),
                  })
                }
              >
                <DropdownMenuRadioItem value="user">
                  Sem backoffice
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="platform_operator">
                  Operador
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="platform_admin">
                  Admin
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>

              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => mutations.requestPasswordSetup.mutate(user.id)}
              >
                <HugeiconsIcon icon={Mail01Icon} className="size-4" />
                Enviar setup de senha
              </DropdownMenuItem>
              {user.banned ? (
                <DropdownMenuItem
                  onClick={() => mutations.unban.mutate(user.id)}
                >
                  <HugeiconsIcon icon={UserBlock01Icon} className="size-4" />
                  Reabilitar conta
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  variant="destructive"
                  disabled={isCurrentUser}
                  onClick={() => mutations.ban.mutate(user.id)}
                >
                  <HugeiconsIcon icon={UserBlock01Icon} className="size-4" />
                  Banir conta
                </DropdownMenuItem>
              )}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <ImpersonateDialog
        open={impersonateOpen}
        onOpenChange={setImpersonateOpen}
        userId={user.id}
        impersonate={mutations.impersonate}
      />
    </>
  )
}

function ImpersonateDialog({
  open,
  onOpenChange,
  userId,
  impersonate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  impersonate: UserMutations['impersonate']
}) {
  const [reason, setReason] = useState('')
  const isValid = reason.trim().length >= 5

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Impersonar usuário</DialogTitle>
          <DialogDescription>
            Informe o motivo do acesso. Ele é registrado na trilha de auditoria e
            fica visível para toda a equipe.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Ex.: investigar o ticket #1234 a pedido do laboratório"
          autoFocus
        />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancelar
          </DialogClose>
          <Button
            disabled={!isValid || impersonate.isPending}
            onClick={() =>
              impersonate.mutate({ userId, reason: reason.trim() })
            }
            className="transition-transform active:scale-[0.96]"
          >
            <HugeiconsIcon icon={ShieldKeyIcon} className="size-4" />
            {impersonate.isPending ? 'Iniciando…' : 'Confirmar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
