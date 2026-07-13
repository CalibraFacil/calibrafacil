import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Cancel01Icon,
  Delete02Icon,
  Mail01Icon,
  SentIcon,
  UserIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { authClient } from '@calibra-facil/auth/client'
import { translateAuthErrorMessage } from '@calibra-facil/auth/error-messages'
import { calibraApi } from '@/utils/api'
import {
  useOrganizationInvitationsData,
  useOrganizationMembersData,
} from '@/features/settings/queries'
import type { OrganizationMember } from '@/features/settings/types'
import {
  formatInvitationTimeRemaining,
  getInvitationStatusLabel,
  getInvitationStatusVariant,
  getInviterName,
  getOrganizationRoleLabel,
  isGlobalMemberRole,
  ORGANIZATION_AVAILABLE_ROLES,
  organizationInvitationsQueryKey,
  organizationMembersQueryKey,
  organizationRoleGovernanceQueryKeys,
  type GlobalMemberRole,
} from '@/features/settings/organization-model'
import type { ActiveOrganization } from '@/features/settings/organization/shared'
import {
  InvitationsSkeleton,
  MembersSkeleton,
} from '@/features/settings/organization/skeletons'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { FieldError, FieldGroup } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export function OrganizationMembersSection({
  activeOrg,
  canManageOrganizationSettings,
  canManageGlobalRoles,
}: {
  activeOrg: ActiveOrganization
  canManageOrganizationSettings: boolean
  canManageGlobalRoles: boolean
}) {
  const queryClient = useQueryClient()
  const availableRoles = ORGANIZATION_AVAILABLE_ROLES

  const [cancellingInvitation, setCancellingInvitation] = useState<
    string | null
  >(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<GlobalMemberRole>('member')
  const [isInviting, setIsInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [memberToRemove, setMemberToRemove] =
    useState<OrganizationMember | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  const [updatingRoleFor, setUpdatingRoleFor] = useState<string | null>(null)

  const membersQuery = useOrganizationMembersData({
    organizationId: activeOrg.id,
    enabled: canManageOrganizationSettings,
  })
  const invitationsQuery = useOrganizationInvitationsData({
    organizationId: activeOrg.id,
    enabled: canManageOrganizationSettings,
  })
  const members = membersQuery.data ?? []
  const membersLoading = membersQuery.isPending
  const invitations = invitationsQuery.data ?? []
  const invitationsLoading = invitationsQuery.isPending

  const updateGlobalRoleMutation = useMutation({
    mutationFn: async ({
      memberId,
      role,
    }: {
      memberId: string
      role: GlobalMemberRole
    }) => {
      return calibraApi.units.updateMemberRole(memberId, role)
    },
    onSuccess: async () => {
      await Promise.all(
        organizationRoleGovernanceQueryKeys(activeOrg.id).map((queryKey) =>
          queryClient.invalidateQueries({ queryKey: [...queryKey] }),
        ),
      )
      toast.success('Função atualizada com sucesso')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao atualizar função',
      )
    },
  })

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviteError(null)

    if (!inviteEmail.trim()) {
      setInviteError('Email é obrigatório')
      return
    }

    setIsInviting(true)
    try {
      const result = await authClient.organization.inviteMember({
        email: inviteEmail.trim(),
        role: inviteRole,
        organizationId: activeOrg.id,
      })
      if (result.error) {
        throw new Error(
          translateAuthErrorMessage(
            result.error.message,
            'Falha ao enviar convite',
          ),
        )
      }
      toast.success(`Convite enviado para ${inviteEmail}`)
      setInviteEmail('')
      await queryClient.invalidateQueries({
        queryKey: organizationInvitationsQueryKey(activeOrg.id),
      })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Falha ao enviar convite'
      setInviteError(message)
      toast.error(message)
    } finally {
      setIsInviting(false)
    }
  }

  const handleRemoveMember = async () => {
    if (!memberToRemove) return

    setIsRemoving(true)
    try {
      const result = await authClient.organization.removeMember({
        memberIdOrEmail: memberToRemove.user.email,
        organizationId: activeOrg.id,
      })
      if (result.error) {
        throw new Error(
          translateAuthErrorMessage(
            result.error.message,
            'Falha ao remover membro',
          ),
        )
      }
      toast.success('Membro removido com sucesso')
      setMemberToRemove(null)
      await queryClient.invalidateQueries({
        queryKey: organizationMembersQueryKey(activeOrg.id),
      })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Falha ao remover membro'
      toast.error(message)
    } finally {
      setIsRemoving(false)
    }
  }

  const handleUpdateMemberRole = async (memberId: string, newRole: string) => {
    if (!canManageGlobalRoles) return
    if (!isGlobalMemberRole(newRole)) {
      toast.error('Função inválida')
      return
    }

    setUpdatingRoleFor(memberId)
    try {
      await updateGlobalRoleMutation.mutateAsync({
        memberId,
        role: newRole,
      })
    } catch {
      // Mutation handles user-facing errors.
    } finally {
      setUpdatingRoleFor(null)
    }
  }

  const handleCancelInvitation = async (invitationId: string) => {
    setCancellingInvitation(invitationId)
    try {
      const result = await authClient.organization.cancelInvitation({
        invitationId,
      })
      if (result.error) {
        throw new Error(
          translateAuthErrorMessage(
            result.error.message,
            'Falha ao cancelar convite',
          ),
        )
      }
      toast.success('Convite cancelado com sucesso')
      await queryClient.invalidateQueries({
        queryKey: organizationInvitationsQueryKey(activeOrg.id),
      })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Falha ao cancelar convite'
      toast.error(message)
    } finally {
      setCancellingInvitation(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Members Card */}
      {canManageOrganizationSettings && (
        <Card>
          <CardHeader>
            <CardTitle>Membros</CardTitle>
            <CardDescription>
              Gerencie os membros da sua organização.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {membersLoading ? (
              <MembersSkeleton />
            ) : (
              <div className="space-y-4">
                {members.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    Nenhum membro encontrado.
                  </p>
                ) : (
                  members.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                          <HugeiconsIcon icon={UserIcon} className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-medium">{member.user.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {member.user.email}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {member.role === 'owner' ? (
                          <Badge variant="secondary">
                            {getOrganizationRoleLabel(member.role)}
                          </Badge>
                        ) : (
                          <Select
                            value={member.role}
                            onValueChange={(value) =>
                              value && handleUpdateMemberRole(member.id, value)
                            }
                            disabled={updatingRoleFor === member.id}
                          >
                            <SelectTrigger size="sm" className="w-35">
                              <SelectValue>
                                {updatingRoleFor === member.id
                                  ? 'Atualizando...'
                                  : getOrganizationRoleLabel(member.role)}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {availableRoles.map((role) => (
                                <SelectItem key={role.value} value={role.value}>
                                  {role.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        {member.role !== 'owner' && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setMemberToRemove(member)}
                          >
                            <HugeiconsIcon
                              icon={Delete02Icon}
                              className="h-4 w-4 text-destructive"
                            />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))
                )}

                <Separator className="my-4" />

                {/* Invite Member Form */}
                <form onSubmit={handleInviteMember}>
                  <FieldGroup>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <Input
                          type="email"
                          value={inviteEmail}
                          onChange={(e) => {
                            setInviteEmail(e.target.value)
                            setInviteError(null)
                          }}
                          disabled={isInviting}
                          placeholder="email@exemplo.com"
                        />
                      </div>
                      <Select
                        value={inviteRole}
                        onValueChange={(value) => {
                          if (
                            typeof value === 'string' &&
                            isGlobalMemberRole(value)
                          ) {
                            setInviteRole(value)
                          }
                        }}
                        disabled={isInviting}
                      >
                        <SelectTrigger className="w-35">
                          <SelectValue>
                            {availableRoles.find((r) => r.value === inviteRole)
                              ?.label || 'Membro'}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {availableRoles.map((role) => (
                            <SelectItem key={role.value} value={role.value}>
                              {role.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button type="submit" disabled={isInviting}>
                        <HugeiconsIcon icon={Mail01Icon} />
                        {isInviting ? 'Enviando...' : 'Convidar'}
                      </Button>
                    </div>
                    {inviteError && <FieldError>{inviteError}</FieldError>}
                  </FieldGroup>
                </form>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Invitations Card */}
      {canManageOrganizationSettings &&
        (invitations.length > 0 || invitationsLoading) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HugeiconsIcon icon={SentIcon} className="h-5 w-5" />
                Convites
              </CardTitle>
              <CardDescription>
                Histórico de convites enviados para a organização.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {invitationsLoading ? (
                <InvitationsSkeleton />
              ) : (
                <div className="space-y-3">
                  {invitations.map((invitation) => {
                    const isPending = invitation.status === 'pending'
                    const isExpired =
                      isPending && invitation.expiresAt < new Date()
                    return (
                      <div
                        key={invitation.id}
                        className="flex items-center justify-between p-4 border rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                            <HugeiconsIcon
                              icon={Mail01Icon}
                              className="h-5 w-5"
                            />
                          </div>
                          <div>
                            <p className="font-medium">{invitation.email}</p>
                            <p className="text-sm text-muted-foreground">
                              {getOrganizationRoleLabel(invitation.role)}
                              {getInviterName(
                                members,
                                invitation.inviterId,
                              ) && (
                                <span className="ml-1">
                                  · Convidado por{' '}
                                  {getInviterName(
                                    members,
                                    invitation.inviterId,
                                  )}
                                </span>
                              )}
                              {isPending && !isExpired && (
                                <span className="ml-1">
                                  · Expira em{' '}
                                  {formatInvitationTimeRemaining(
                                    invitation.expiresAt,
                                  )}
                                </span>
                              )}
                              {isExpired && (
                                <span className="text-destructive ml-1">
                                  · Expirado
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={getInvitationStatusVariant(
                              invitation.status,
                            )}
                          >
                            {getInvitationStatusLabel(invitation.status)}
                          </Badge>
                          {isPending && !isExpired && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() =>
                                handleCancelInvitation(invitation.id)
                              }
                              disabled={cancellingInvitation === invitation.id}
                            >
                              <HugeiconsIcon
                                icon={Cancel01Icon}
                                className="h-4 w-4 text-muted-foreground"
                              />
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

      {/* Remove Member Confirmation Dialog */}
      {canManageOrganizationSettings && (
        <AlertDialog
          open={!!memberToRemove}
          onOpenChange={(open) => {
            if (!open) setMemberToRemove(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remover membro?</AlertDialogTitle>
              <AlertDialogDescription>
                Você está prestes a remover{' '}
                <strong>{memberToRemove?.user.name}</strong> (
                {memberToRemove?.user.email}) da organização. Esta ação pode ser
                desfeita convidando o membro novamente.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isRemoving}>
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleRemoveMember}
                disabled={isRemoving}
                variant="destructive"
              >
                {isRemoving ? 'Removendo...' : 'Remover membro'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}
