import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Building06Icon,
  Delete02Icon,
  Mail01Icon,
  UserMultiple02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { authClient, useActiveOrganization } from '@calibra-facil/auth/client'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

export const Route = createFileRoute('/dashboard/settings/organization')({
  head: () => ({
    meta: [{ title: 'Organização | Configurações | CalibraFácil' }],
  }),
  component: OrganizationSettingsPage,
})

interface Member {
  id: string
  userId: string
  role: string
  createdAt: Date
  user: {
    id: string
    name: string
    email: string
    image?: string
  }
}

function OrganizationSettingsPage() {
  const { data: activeOrg, isPending: isLoadingOrg } = useActiveOrganization()

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [isUpdating, setIsUpdating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [members, setMembers] = useState<Array<Member>>([])
  const [membersLoading, setMembersLoading] = useState(false)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole] = useState<
    'member' | 'admin' | 'technician' | 'client_user'
  >('member')
  const [isInviting, setIsInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    if (activeOrg) {
      setName(activeOrg.name)
      setSlug(activeOrg.slug)
    }
  }, [activeOrg?.id, activeOrg?.name, activeOrg?.slug])

  useEffect(() => {
    if (!activeOrg?.id) return

    let cancelled = false
    const fetchMembers = async () => {
      setMembersLoading(true)
      try {
        const result = await authClient.organization.listMembers({
          query: { organizationId: activeOrg.id },
        })
        if (!cancelled && result.data) {
          setMembers(
            result.data.members.map((m) => ({
              ...m,
              createdAt: new Date(m.createdAt),
            })),
          )
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load members:', err)
        }
      } finally {
        if (!cancelled) {
          setMembersLoading(false)
        }
      }
    }

    fetchMembers()
    return () => {
      cancelled = true
    }
  }, [activeOrg?.id])

  const loadMembers = async () => {
    if (!activeOrg) return
    setMembersLoading(true)
    try {
      const result = await authClient.organization.listMembers({
        query: { organizationId: activeOrg.id },
      })
      if (result.data) {
        setMembers(
          result.data.members.map((m) => ({
            ...m,
            createdAt: new Date(m.createdAt),
          })),
        )
      }
    } catch (err) {
      console.error('Failed to load members:', err)
    } finally {
      setMembersLoading(false)
    }
  }

  if (isLoadingOrg) {
    return <OrganizationSkeleton />
  }

  if (!activeOrg) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={Building06Icon} />
          </EmptyMedia>
          <EmptyTitle>Nenhuma organização selecionada</EmptyTitle>
          <EmptyDescription>
            Selecione ou crie uma organização para gerenciar suas configurações.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const handleUpdateOrganization = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (!name.trim()) {
      setFormError('Nome é obrigatório')
      return
    }

    setIsUpdating(true)
    try {
      const result = await authClient.organization.update({
        data: {
          name: name.trim(),
          slug: slug.trim() || undefined,
        },
      })
      if (result.error) {
        throw new Error(
          result.error.message ?? 'Falha ao atualizar organização',
        )
      }
      toast.success('Organização atualizada com sucesso!')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Falha ao atualizar organização'
      setFormError(message)
      toast.error(message)
    } finally {
      setIsUpdating(false)
    }
  }

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
        throw new Error(result.error.message ?? 'Falha ao enviar convite')
      }
      toast.success(`Convite enviado para ${inviteEmail}`)
      setInviteEmail('')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Falha ao enviar convite'
      setInviteError(message)
      toast.error(message)
    } finally {
      setIsInviting(false)
    }
  }

  const handleRemoveMember = async (memberIdOrEmail: string) => {
    try {
      const result = await authClient.organization.removeMember({
        memberIdOrEmail,
        organizationId: activeOrg.id,
      })
      if (result.error) {
        throw new Error(result.error.message ?? 'Falha ao remover membro')
      }
      toast.success('Membro removido com sucesso')
      await loadMembers()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Falha ao remover membro'
      toast.error(message)
    }
  }

  const handleDeleteOrganization = async () => {
    if (deleteConfirmName !== activeOrg.name) {
      toast.error('O nome da organização não confere')
      return
    }

    setIsDeleting(true)
    try {
      const result = await authClient.organization.delete({
        organizationId: activeOrg.id,
      })
      if (result.error) {
        throw new Error(result.error.message ?? 'Falha ao excluir organização')
      }
      toast.success('Organização excluída com sucesso')
      // Redirect to dashboard after deletion
      window.location.href = '/dashboard'
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Falha ao excluir organização'
      toast.error(message)
      setIsDeleting(false)
    }
  }

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      owner: 'Proprietário',
      admin: 'Administrador',
      member: 'Membro',
      technician: 'Técnico',
      client_user: 'Cliente',
    }
    return labels[role] || role
  }

  return (
    <div className="space-y-6">
      {/* Organization Details Card */}
      <Card>
        <CardHeader>
          <CardTitle>Detalhes da Organização</CardTitle>
          <CardDescription>
            Atualize as informações da sua organização.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpdateOrganization}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="org-name">Nome</FieldLabel>
                <Input
                  id="org-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    setFormError(null)
                  }}
                  disabled={isUpdating}
                  placeholder="Nome da organização"
                />
                {formError && <FieldError>{formError}</FieldError>}
              </Field>

              <Field>
                <FieldLabel htmlFor="org-slug">Slug</FieldLabel>
                <Input
                  id="org-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  disabled={isUpdating}
                  placeholder="slug-da-organizacao"
                />
                <FieldDescription>
                  URL amigável para identificar sua organização.
                </FieldDescription>
              </Field>

              <div className="flex justify-end">
                <Button type="submit" disabled={isUpdating}>
                  {isUpdating ? 'Salvando...' : 'Salvar alterações'}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      {/* Members Card */}
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
                        <HugeiconsIcon
                          icon={UserMultiple02Icon}
                          className="h-5 w-5"
                        />
                      </div>
                      <div>
                        <p className="font-medium">{member.user.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {member.user.email}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">
                        {getRoleLabel(member.role)}
                      </Badge>
                      {member.role !== 'owner' && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleRemoveMember(member.user.email)}
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

      {/* Danger Zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">
            Excluir Organizacao
          </CardTitle>
          <CardDescription>
            Exclua permanentemente esta organização e todos os seus dados.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog
            open={deleteDialogOpen}
            onOpenChange={(open) => {
              if (!open) {
                setDeleteConfirmName('')
              }
              setDeleteDialogOpen(open)
            }}
          >
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
                <AlertDialogTitle>
                  Excluir organização permanentemente?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Esta ação é irreversível. Todos os dados da organização serão
                  excluídos permanentemente, incluindo membros, calibrações e
                  certificados.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="py-4">
                <Field>
                  <FieldLabel htmlFor="delete-confirm-name">
                    Digite <strong>{activeOrg.name}</strong> para confirmar
                  </FieldLabel>
                  <Input
                    id="delete-confirm-name"
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                    placeholder={activeOrg.name}
                    disabled={isDeleting}
                  />
                </Field>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeleting}>
                  Cancelar
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeleteOrganization}
                  disabled={isDeleting || deleteConfirmName !== activeOrg.name}
                  variant="destructive"
                >
                  {isDeleting ? 'Excluindo...' : 'Excluir permanentemente'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  )
}

function OrganizationSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <div className="flex justify-end">
            <Skeleton className="h-9 w-32" />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function MembersSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex items-center justify-between p-4 border rounded-lg"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
          <Skeleton className="h-5 w-20" />
        </div>
      ))}
    </div>
  )
}
