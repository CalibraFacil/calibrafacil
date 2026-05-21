import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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

import { calibraApi } from '@/utils/api'
import {
  useCustomerInvitationsData,
  useCustomerMembersData,
} from '@/features/customers/queries'
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

export function ClientUsersTab({ id }: { id: string }) {
  const queryClient = useQueryClient()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const defaultPortalRole = PORTAL_MANAGEABLE_MEMBER_ROLES[0]

  const { data: members = [], isLoading: membersLoading } =
    useCustomerMembersData(id)
  const { data: invitations = [], isLoading: invitationsLoading } =
    useCustomerInvitationsData(id)

  const inviteMutation = useMutation({
    mutationFn: async (email: string) => {
      return calibraApi.customers.createInvitation(id, {
        email,
        role: defaultPortalRole,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-invitations', id] })
      toast.success('Convite enviado com sucesso!')
      setInviteOpen(false)
      setInviteEmail('')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const resendMutation = useMutation({
    mutationFn: async (invId: string) => {
      return calibraApi.customers.resendInvitation(id, invId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-invitations', id] })
      toast.success('Convite reenviado!')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const cancelInvitationMutation = useMutation({
    mutationFn: async (invId: string) => {
      return calibraApi.customers.cancelInvitation(id, invId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-invitations', id] })
      toast.success('Convite cancelado!')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const removeMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      return calibraApi.customers.removeMember(id, memberId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-members', id] })
      toast.success('Usuário removido!')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

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

    inviteMutation.mutate(inviteEmail.trim())
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  }

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
      eyebrow="Portal"
      title="Acesso do Cliente"
      description="Gerencie quem entra no portal, acompanhe convites enviados e mantenha o acesso do cliente enxuto."
      icon={<HugeiconsIcon icon={UserMultipleIcon} className="size-5" />}
      action={
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger render={<Button />}>
            <HugeiconsIcon
              icon={PlusSignIcon}
              className="mr-2 size-4"
              aria-hidden="true"
            />
            Convidar Usuário
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Convidar Usuário</DialogTitle>
              <DialogDescription>
                Envie um convite por email para um novo usuário do portal.
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
                    placeholder="usuario@empresa.com"
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
          label="Usuários Ativos"
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
          title="Usuários"
          description="Pessoas com acesso ativo ao portal do cliente."
        >
          {membersLoading ? (
            <MembersTableSkeleton />
          ) : visibleMembers.length === 0 ? (
            <Empty className="rounded-none border-x-0 border-y border-solid border-border/70 py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={UserMultipleIcon} />
                </EmptyMedia>
                <EmptyTitle>Nenhum usuário</EmptyTitle>
                <EmptyDescription>
                  Convide usuários para acessar o portal do cliente.
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
                            ? 'Usuário'
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
                                  Remover usuário
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  Tem certeza que deseja remover {m.userName} do
                                  portal? Esta ação não pode ser desfeita.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  variant="destructive"
                                  onClick={() =>
                                    removeMemberMutation.mutate(m.id)
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
          description="Histórico de convites enviados para novos usuários."
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
                                onClick={() => resendMutation.mutate(inv.id)}
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
                                        cancelInvitationMutation.mutate(inv.id)
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
