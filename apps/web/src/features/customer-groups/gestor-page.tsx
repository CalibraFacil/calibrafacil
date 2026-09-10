import { useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  PORTAL_MANAGEABLE_MEMBER_ROLES,
  isPortalManageableMemberRole,
  isPortalVisibleMemberRole,
} from '@calibra-facil/auth/access'
import {
  Delete02Icon,
  Mail01Icon,
  PlusSignIcon,
  SentIcon,
  UserMultipleIcon,
} from '@hugeicons/core-free-icons'

import {
  useCancelGroupInvitationMutation,
  useCustomerGroupInvitationsData,
  useCustomerGroupMembersData,
  useInviteGroupManagerMutation,
  useRemoveGroupMemberMutation,
  useResendGroupInvitationMutation,
} from '@/features/customer-groups/queries'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  ClientMetric,
  ClientMetricStrip,
  ClientPanel,
  ClientPanelBody,
  ClientSection,
  TableFrame,
} from '@/features/customers/components/client-detail-ui'

export function CustomerGroupGestorTab({ groupId }: { groupId: number }) {
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const defaultPortalRole = PORTAL_MANAGEABLE_MEMBER_ROLES[0]

  const { data: members = [], isLoading: membersLoading } =
    useCustomerGroupMembersData(groupId)
  const { data: invitations = [], isLoading: invitationsLoading } =
    useCustomerGroupInvitationsData(groupId)

  const inviteMutation = useInviteGroupManagerMutation(
    groupId,
    defaultPortalRole,
  )
  const resendMutation = useResendGroupInvitationMutation(groupId)
  const cancelInvitationMutation = useCancelGroupInvitationMutation(groupId)
  const removeMemberMutation = useRemoveGroupMemberMutation(groupId)

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault()
    setInviteError(null)

    if (!inviteEmail.trim()) {
      setInviteError('Email é obrigatório.')
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail)) {
      setInviteError('Email inválido.')
      return
    }

    inviteMutation.mutate(inviteEmail.trim(), {
      onSuccess: () => {
        toast.success('Convite enviado com sucesso!')
        setInviteOpen(false)
        setInviteEmail('')
      },
      onError: (error) => toast.error(error.message),
    })
  }

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })

  const getStatusBadge = (status: string, expiresAt: string) => {
    const isExpired = new Date(expiresAt) < new Date()

    if (status === 'accepted') {
      return <Badge variant="default">Aceito</Badge>
    }
    if (status === 'canceled') {
      return <Badge variant="secondary">Cancelado</Badge>
    }
    if (isExpired) {
      return <Badge variant="destructive">Expirado</Badge>
    }
    return <Badge variant="outline">Pendente</Badge>
  }

  const visibleMembers = members.filter((member) =>
    isPortalVisibleMemberRole(member.role),
  )
  const pendingInvitations = invitations.filter(
    (invitation) =>
      invitation.status === 'pending' &&
      new Date(invitation.expiresAt) >= new Date(),
  )

  return (
    <ClientPanel
      title="Acesso consolidado do grupo"
      description="O gestor do grupo acompanha todas as unidades em um único portal. Gerencie quem tem acesso e os convites pendentes."
      action={
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger render={<Button />}>
            <HugeiconsIcon
              icon={PlusSignIcon}
              className="mr-2 size-4"
              aria-hidden="true"
            />
            Convidar gestor
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Convidar gestor</DialogTitle>
              <DialogDescription>
                Envie um convite por email para um gestor do portal consolidado
                do grupo.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleInvite}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="invite-email">Email</FieldLabel>
                  <Input
                    id="invite-email"
                    name="invite-email"
                    type="email"
                    autoComplete="email"
                    value={inviteEmail}
                    onChange={(e) => {
                      setInviteEmail(e.target.value)
                      setInviteError(null)
                    }}
                    placeholder="gestor@rede.com.br"
                    disabled={inviteMutation.isPending}
                    aria-invalid={inviteError ? true : undefined}
                  />
                  {inviteError && <FieldError>{inviteError}</FieldError>}
                </Field>
              </FieldGroup>
              <DialogFooter className="mt-6">
                <DialogClose render={<Button variant="outline" />}>
                  Cancelar
                </DialogClose>
                <Button type="submit" disabled={inviteMutation.isPending}>
                  {inviteMutation.isPending ? 'Enviando…' : 'Enviar Convite'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }
    >
      <ClientMetricStrip className="xl:grid-cols-3">
        <ClientMetric
          icon={<HugeiconsIcon icon={UserMultipleIcon} className="size-4" />}
          label="Gestores Ativos"
          value={String(visibleMembers.length)}
        />
        <ClientMetric
          icon={<HugeiconsIcon icon={Mail01Icon} className="size-4" />}
          label="Convites Enviados"
          value={String(invitations.length)}
        />
        <ClientMetric
          icon={<HugeiconsIcon icon={SentIcon} className="size-4" />}
          label="Convites Pendentes"
          value={String(pendingInvitations.length)}
        />
      </ClientMetricStrip>
      <ClientPanelBody className="space-y-8">
        <ClientSection
          icon={<HugeiconsIcon icon={UserMultipleIcon} className="size-4" />}
          title="Gestores"
          description="Pessoas com acesso ao portal consolidado do grupo."
        >
          {membersLoading ? (
            <MembersTableSkeleton />
          ) : visibleMembers.length === 0 ? (
            <Empty className="rounded-none border-x-0 border-y border-solid border-border/70 py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={UserMultipleIcon} />
                </EmptyMedia>
                <EmptyTitle>Nenhum gestor</EmptyTitle>
                <EmptyDescription>
                  Convide um gestor para acessar o portal consolidado do grupo.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <TableFrame>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Função</TableHead>
                    <TableHead className="w-20">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleMembers.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">
                        {m.userName}
                      </TableCell>
                      <TableCell>{m.userEmail}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {isPortalVisibleMemberRole(m.role)
                            ? 'Gestor'
                            : m.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {isPortalManageableMemberRole(m.role) && (
                          <AlertDialog>
                            <AlertDialogTrigger
                              render={<Button variant="ghost" size="icon-sm" />}
                              aria-label={`Remover ${m.userName}`}
                            >
                              <HugeiconsIcon
                                icon={Delete02Icon}
                                className="size-4 text-destructive"
                              />
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Remover gestor
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  Tem certeza que deseja remover {m.userName} do
                                  portal do grupo? Esta ação não pode ser
                                  desfeita.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  variant="destructive"
                                  onClick={() =>
                                    removeMemberMutation.mutate(m.id, {
                                      onSuccess: () =>
                                        toast.success('Gestor removido!'),
                                      onError: (error) =>
                                        toast.error(error.message),
                                    })
                                  }
                                  disabled={removeMemberMutation.isPending}
                                >
                                  Remover
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableFrame>
          )}
        </ClientSection>

        <ClientSection
          icon={<HugeiconsIcon icon={Mail01Icon} className="size-4" />}
          title="Convites"
          description="Histórico de convites enviados para gestores do grupo."
        >
          {invitationsLoading ? (
            <InvitationsTableSkeleton />
          ) : invitations.length === 0 ? (
            <Empty className="rounded-none border-x-0 border-y border-solid border-border/70 py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={Mail01Icon} />
                </EmptyMedia>
                <EmptyTitle>Nenhum convite</EmptyTitle>
                <EmptyDescription>
                  Convites enviados aparecerão aqui.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <TableFrame>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Expira em</TableHead>
                    <TableHead className="w-30">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations.map((inv) => {
                    const isPending =
                      inv.status === 'pending' &&
                      new Date(inv.expiresAt) >= new Date()
                    return (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium">
                          {inv.email}
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(inv.status, inv.expiresAt)}
                        </TableCell>
                        <TableCell>{formatDate(inv.expiresAt)}</TableCell>
                        <TableCell>
                          {isPending && (
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() =>
                                  resendMutation.mutate(inv.id, {
                                    onSuccess: () =>
                                      toast.success('Convite reenviado!'),
                                    onError: (error) =>
                                      toast.error(error.message),
                                  })
                                }
                                disabled={resendMutation.isPending}
                                aria-label={`Reenviar convite para ${inv.email}`}
                              >
                                <HugeiconsIcon
                                  icon={SentIcon}
                                  className="size-4"
                                />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger
                                  render={
                                    <Button variant="ghost" size="icon-sm" />
                                  }
                                  aria-label={`Cancelar convite para ${inv.email}`}
                                >
                                  <HugeiconsIcon
                                    icon={Delete02Icon}
                                    className="size-4 text-destructive"
                                  />
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      Cancelar convite
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Tem certeza que deseja cancelar o convite
                                      para {inv.email}?
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>
                                      Voltar
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      variant="destructive"
                                      onClick={() =>
                                        cancelInvitationMutation.mutate(
                                          inv.id,
                                          {
                                            onSuccess: () =>
                                              toast.success(
                                                'Convite cancelado!',
                                              ),
                                            onError: (error) =>
                                              toast.error(error.message),
                                          },
                                        )
                                      }
                                      disabled={
                                        cancelInvitationMutation.isPending
                                      }
                                    >
                                      Cancelar Convite
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableFrame>
          )}
        </ClientSection>
      </ClientPanelBody>
    </ClientPanel>
  )
}

function MembersTableSkeleton() {
  return (
    <TableFrame>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Função</TableHead>
            <TableHead className="w-20">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 3 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="h-4 w-32" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-40" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-16" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-8 w-8" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableFrame>
  )
}

function InvitationsTableSkeleton() {
  return (
    <TableFrame>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Expira em</TableHead>
            <TableHead className="w-30">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 2 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="h-4 w-40" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-20" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-24" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-8 w-16" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableFrame>
  )
}
