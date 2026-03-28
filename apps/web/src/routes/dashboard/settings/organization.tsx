import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Building06Icon,
  Cancel01Icon,
  Delete02Icon,
  Mail01Icon,
  SentIcon,
  UserIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { authClient, useActiveOrganization } from '@calibra-facil/auth/client'
import { usePlanAccess } from '@/hooks/use-plan-access'
import { api } from '@/utils/api'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export const Route = createFileRoute('/dashboard/settings/organization')({
  head: () => ({
    meta: [{ title: 'Organização | Configurações | CalibraFácil' }],
  }),
  component: OrganizationSettingsRoute,
})

type ActiveOrganization = NonNullable<
  ReturnType<typeof useActiveOrganization>['data']
>

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

interface Invitation {
  id: string
  email: string
  role: string
  status: 'pending' | 'accepted' | 'rejected' | 'canceled'
  expiresAt: Date
  inviterId: string
}

interface OrganizationUnit {
  id: number
  name: string
  slug: string
  legalName: string | null
  tradeName: string | null
  cnpj: string | null
  accreditationNumber: string | null
  accreditationBody: string | null
  installationType: 'PERMANENT' | 'TEMPORARY' | 'MOBILE'
  street: string | null
  number: string | null
  complement: string | null
  neighbourhood: string | null
  city: string | null
  state: string | null
  cep: string | null
  phone: string | null
  email: string | null
  website: string | null
  technicalManagerName: string | null
  technicalManagerTitle: string | null
  scopeSummary: string | null
  scopeNotes: string | null
  status: 'ACTIVE' | 'ARCHIVED'
  isDefault: boolean
  createdAt: string
  archivedAt: string | null
}

interface UnitProfileDraft {
  name: string
  legalName: string
  tradeName: string
  cnpj: string
  accreditationNumber: string
  accreditationBody: string
  installationType: 'PERMANENT' | 'TEMPORARY' | 'MOBILE'
  street: string
  number: string
  complement: string
  neighbourhood: string
  city: string
  state: string
  cep: string
  phone: string
  email: string
  website: string
  technicalManagerName: string
  technicalManagerTitle: string
  scopeSummary: string
  scopeNotes: string
}

function createUnitProfileDraft(unit: OrganizationUnit): UnitProfileDraft {
  return {
    name: unit.name,
    legalName: unit.legalName ?? '',
    tradeName: unit.tradeName ?? '',
    cnpj: unit.cnpj ?? '',
    accreditationNumber: unit.accreditationNumber ?? '',
    accreditationBody: unit.accreditationBody ?? '',
    installationType: unit.installationType ?? 'PERMANENT',
    street: unit.street ?? '',
    number: unit.number ?? '',
    complement: unit.complement ?? '',
    neighbourhood: unit.neighbourhood ?? '',
    city: unit.city ?? '',
    state: unit.state ?? '',
    cep: unit.cep ?? '',
    phone: unit.phone ?? '',
    email: unit.email ?? '',
    website: unit.website ?? '',
    technicalManagerName: unit.technicalManagerName ?? '',
    technicalManagerTitle: unit.technicalManagerTitle ?? '',
    scopeSummary: unit.scopeSummary ?? '',
    scopeNotes: unit.scopeNotes ?? '',
  }
}

type UnitAssignmentRole = 'member' | 'technician' | 'unit_admin'
type EditableUnitAssignmentRole = UnitAssignmentRole | 'none'

interface GovernanceViewer {
  isGlobalManager: boolean
  canManageOrganizationUnits: boolean
  canManageAssignments: boolean
  canManageGlobalRoles: boolean
  canViewGovernance: boolean
  canAccessConsolidatedView: boolean
  managedUnitIds: number[]
}

interface GovernanceAssignment {
  unitId: number
  unitName: string
  role: UnitAssignmentRole
}

interface GovernanceMember {
  id: string
  userId: string
  role: string
  name: string
  email: string
  createdAt: string
  assignments: GovernanceAssignment[]
}

interface UnitContextResponse {
  activeUnitId: number | null
  activeUnitName: string | null
  selectedUnitScope: 'all' | 'unit'
  canAccessAllUnits: boolean
  data: Array<{
    id: number
    name: string
    slug: string
    role: string
  }>
}

function OrganizationSettingsRoute() {
  const { data: activeOrg, isPending: isLoadingOrg } = useActiveOrganization()

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

  return <OrganizationSettingsPage key={activeOrg.id} activeOrg={activeOrg} />
}

function OrganizationSettingsPage({
  activeOrg,
}: {
  activeOrg: ActiveOrganization
}) {
  const queryClient = useQueryClient()
  const currentOrgRole =
    typeof activeOrg.members?.[0]?.role === 'string'
      ? activeOrg.members[0].role
      : 'member'
  const canManageOrganizationSettings =
    currentOrgRole === 'owner' || currentOrgRole === 'admin'
  const [name, setName] = useState(activeOrg.name ?? '')
  const [slug, setSlug] = useState(activeOrg.slug ?? '')
  const [isUpdating, setIsUpdating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [members, setMembers] = useState<Array<Member>>([])
  const [membersLoading, setMembersLoading] = useState(false)

  const [invitations, setInvitations] = useState<Array<Invitation>>([])
  const [invitationsLoading, setInvitationsLoading] = useState(false)
  const [cancellingInvitation, setCancellingInvitation] = useState<
    string | null
  >(null)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<string>('member')
  const [isInviting, setIsInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)

  const [memberToRemove, setMemberToRemove] = useState<Member | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)

  const [updatingRoleFor, setUpdatingRoleFor] = useState<string | null>(null)
  const [savingAssignmentsFor, setSavingAssignmentsFor] = useState<string | null>(
    null,
  )
  const [assignmentDrafts, setAssignmentDrafts] = useState<
    Record<string, Record<number, EditableUnitAssignmentRole>>
  >({})
  const [editingUnitId, setEditingUnitId] = useState<number | null>(null)
  const [unitProfileDrafts, setUnitProfileDrafts] = useState<
    Record<number, UnitProfileDraft>
  >({})
  const [updatingUnitId, setUpdatingUnitId] = useState<number | null>(null)

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [newUnitName, setNewUnitName] = useState('')

  const availableRoles = [
    { value: 'member', label: 'Membro' },
    { value: 'technician', label: 'Técnico' },
    { value: 'admin', label: 'Administrador' },
  ] as const

  const unitsQuery = useQuery({
    queryKey: ['organization-units', activeOrg.id],
    queryFn: async () => {
      const response = await api.api.units.admin.units.$get()
      if (response.status === 403) {
        return {
          data: [] as OrganizationUnit[],
          viewer: {
            isGlobalManager: false,
            canManageOrganizationUnits: false,
            canManageAssignments: false,
            canManageGlobalRoles: false,
            canViewGovernance: false,
            canAccessConsolidatedView: false,
            managedUnitIds: [],
          } satisfies GovernanceViewer,
        }
      }

      if (!response.ok) {
        throw new Error('Falha ao carregar unidades')
      }

      return (await response.json()) as {
        data: OrganizationUnit[]
        viewer: GovernanceViewer
      }
    },
  })

  const unitContextQuery = useQuery({
    queryKey: ['dashboard-units', activeOrg.id],
    queryFn: async () => {
      const response = await api.api.units.$get()
      if (!response.ok) {
        throw new Error('Falha ao carregar contexto da unidade')
      }

      return (await response.json()) as UnitContextResponse
    },
  })

  const governanceMembersQuery = useQuery({
    queryKey: ['organization-governance-members', activeOrg.id],
    queryFn: async () => {
      const response = await api.api.units.admin.members.$get()
      if (response.status === 403) {
        return {
          data: [] as GovernanceMember[],
          viewer: {
            isGlobalManager: false,
            canManageOrganizationUnits: false,
            canManageAssignments: false,
            canManageGlobalRoles: false,
            canViewGovernance: false,
            canAccessConsolidatedView: false,
            managedUnitIds: [],
          } satisfies GovernanceViewer,
        }
      }

      if (!response.ok) {
        throw new Error('Falha ao carregar governança por unidade')
      }

      return (await response.json()) as {
        data: GovernanceMember[]
        viewer: GovernanceViewer
      }
    },
  })

  const governanceViewer =
    governanceMembersQuery.data?.viewer ?? unitsQuery.data?.viewer ?? null
  const canManageOrganizationUnits =
    governanceViewer?.canManageOrganizationUnits ?? canManageOrganizationSettings
  const canManageAssignments = governanceViewer?.canManageAssignments ?? false
  const canManageGlobalRoles =
    governanceViewer?.canManageGlobalRoles ?? canManageOrganizationSettings
  const canViewGovernance = governanceViewer?.canViewGovernance ?? false
  const selectedUnit =
    unitContextQuery.data?.selectedUnitScope === 'unit'
      ? (unitsQuery.data?.data ?? []).find(
          (unit) => unit.id === unitContextQuery.data?.activeUnitId,
        ) ?? null
      : null

  const createUnitMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await api.api.units.admin.units.$post({
        json: { name },
      })

      const data = (await response.json()) as
        | OrganizationUnit
        | { error?: string }

      if (!response.ok || 'error' in data) {
        throw new Error(('error' in data && data.error) || 'Erro ao criar unidade')
      }

      return data
    },
    onSuccess: async () => {
      setNewUnitName('')
      await queryClient.invalidateQueries({
        queryKey: ['organization-units', activeOrg.id],
      })
      await queryClient.invalidateQueries({
        queryKey: ['organization-governance-members', activeOrg.id],
      })
      await queryClient.invalidateQueries({
        queryKey: ['dashboard-units', activeOrg.id],
      })
      toast.success('Unidade criada com sucesso')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao criar unidade')
    },
  })

  const updateUnitMutation = useMutation({
    mutationFn: async ({
      unitId,
      payload,
    }: {
      unitId: number
      payload: Partial<UnitProfileDraft> & {
        status?: 'ACTIVE' | 'ARCHIVED'
      }
    }) => {
      const response = await api.api.units.admin.units[':id'].$patch({
        param: { id: String(unitId) },
        json: payload,
      })

      const data = (await response.json()) as OrganizationUnit | { error?: string }

      if (!response.ok || 'error' in data) {
        throw new Error(
          ('error' in data && data.error) || 'Erro ao atualizar unidade',
        )
      }

      return data
    },
    onSuccess: async () => {
      setEditingUnitId(null)
      setUpdatingUnitId(null)
      await queryClient.invalidateQueries({
        queryKey: ['organization-units', activeOrg.id],
      })
      await queryClient.invalidateQueries({
        queryKey: ['organization-governance-members', activeOrg.id],
      })
      await queryClient.invalidateQueries({
        queryKey: ['dashboard-units', activeOrg.id],
      })
      toast.success('Unidade atualizada com sucesso')
    },
    onError: (error) => {
      setUpdatingUnitId(null)
      toast.error(
        error instanceof Error ? error.message : 'Erro ao atualizar unidade',
      )
    },
  })

  const updateAssignmentsMutation = useMutation({
    mutationFn: async ({
      memberId,
      assignments,
    }: {
      memberId: string
      assignments: Array<{ unitId: number; role: UnitAssignmentRole }>
    }) => {
      const response = await api.api.units.admin.members[':memberId'].assignments.$put(
        {
          param: { memberId },
          json: { assignments },
        },
      )

      const data = (await response.json()) as { success?: boolean; error?: string }
      if (!response.ok || data.error) {
        throw new Error(data.error || 'Erro ao atualizar atribuições')
      }

      return data
    },
    onSuccess: async () => {
      setSavingAssignmentsFor(null)
      await queryClient.invalidateQueries({
        queryKey: ['organization-governance-members', activeOrg.id],
      })
      await queryClient.invalidateQueries({
        queryKey: ['dashboard-units', activeOrg.id],
      })
      toast.success('Atribuições atualizadas com sucesso')
    },
    onError: (error) => {
      setSavingAssignmentsFor(null)
      toast.error(
        error instanceof Error ? error.message : 'Erro ao atualizar atribuições',
      )
    },
  })

  const updateGlobalRoleMutation = useMutation({
    mutationFn: async ({
      memberId,
      role,
    }: {
      memberId: string
      role: 'member' | 'technician' | 'admin'
    }) => {
      const response = await api.api.units.admin.members[':memberId'].role.$patch({
        param: { memberId },
        json: { role },
      })

      const data = (await response.json()) as { success?: boolean; error?: string }
      if (!response.ok || data.error) {
        throw new Error(data.error || 'Erro ao atualizar papel global')
      }

      return data
    },
    onSuccess: async () => {
      await Promise.all([
        loadMembers(),
        queryClient.invalidateQueries({
          queryKey: ['organization-governance-members', activeOrg.id],
        }),
      ])
      toast.success('Função atualizada com sucesso')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao atualizar função',
      )
    },
  })

  useEffect(() => {
    if (!activeOrg?.id) return

    let cancelled = false
    const fetchMembers = async () => {
      if (!canManageOrganizationSettings) {
        setMembers([])
        setMembersLoading(false)
        return
      }
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

    const fetchInvitations = async () => {
      if (!canManageOrganizationSettings) {
        setInvitations([])
        setInvitationsLoading(false)
        return
      }
      setInvitationsLoading(true)
      try {
        const result = await authClient.organization.listInvitations({
          query: { organizationId: activeOrg.id },
        })
        if (!cancelled && result.data) {
          setInvitations(
            result.data.map((inv) => ({
              ...inv,
              expiresAt: new Date(inv.expiresAt),
            })),
          )
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load invitations:', err)
        }
      } finally {
        if (!cancelled) {
          setInvitationsLoading(false)
        }
      }
    }

    fetchMembers()
    fetchInvitations()
    return () => {
      cancelled = true
    }
  }, [activeOrg?.id, canManageOrganizationSettings])

  useEffect(() => {
    const units = unitsQuery.data?.data ?? []
    const governanceMembers = governanceMembersQuery.data?.data ?? []

    if (units.length === 0 || governanceMembers.length === 0) {
      setAssignmentDrafts({})
      setUnitProfileDrafts(
        Object.fromEntries(units.map((unit) => [unit.id, createUnitProfileDraft(unit)])),
      )
      return
    }

    setUnitProfileDrafts(
      Object.fromEntries(units.map((unit) => [unit.id, createUnitProfileDraft(unit)])),
    )
    setAssignmentDrafts(
      Object.fromEntries(
        governanceMembers.map((member) => [
          member.id,
          Object.fromEntries(
            units.map((unit) => [
              unit.id,
              member.assignments.find((assignment) => assignment.unitId === unit.id)
                ?.role ?? 'none',
            ]),
          ),
        ]),
      ),
    )
  }, [governanceMembersQuery.data, unitsQuery.data])

  const loadMembers = async () => {
    if (!activeOrg || !canManageOrganizationSettings) return
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

  const loadInvitations = async () => {
    if (!activeOrg || !canManageOrganizationSettings) return
    setInvitationsLoading(true)
    try {
      const result = await authClient.organization.listInvitations({
        query: { organizationId: activeOrg.id },
      })
      if (result.data) {
        setInvitations(
          result.data.map((inv) => ({
            ...inv,
            expiresAt: new Date(inv.expiresAt),
          })),
        )
      }
    } catch (err) {
      console.error('Failed to load invitations:', err)
    } finally {
      setInvitationsLoading(false)
    }
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
        role: inviteRole as 'member' | 'admin' | 'technician',
        organizationId: activeOrg.id,
      })
      if (result.error) {
        throw new Error(result.error.message ?? 'Falha ao enviar convite')
      }
      toast.success(`Convite enviado para ${inviteEmail}`)
      setInviteEmail('')
      await loadInvitations()
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
        throw new Error(result.error.message ?? 'Falha ao remover membro')
      }
      toast.success('Membro removido com sucesso')
      setMemberToRemove(null)
      await loadMembers()
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
    setUpdatingRoleFor(memberId)
    try {
      await updateGlobalRoleMutation.mutateAsync({
        memberId,
        role: newRole as 'member' | 'technician' | 'admin',
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
        throw new Error(result.error.message ?? 'Falha ao cancelar convite')
      }
      toast.success('Convite cancelado com sucesso')
      await loadInvitations()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Falha ao cancelar convite'
      toast.error(message)
    } finally {
      setCancellingInvitation(null)
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

  const getUnitRoleLabel = (role: EditableUnitAssignmentRole) => {
    const labels: Record<EditableUnitAssignmentRole, string> = {
      none: 'Sem acesso',
      member: 'Membro',
      technician: 'Técnico',
      unit_admin: 'Admin. da unidade',
    }
    return labels[role] || role
  }

  const updateAssignmentDraft = (
    memberId: string,
    unitId: number,
    role: EditableUnitAssignmentRole,
  ) => {
    setAssignmentDrafts((current) => ({
      ...current,
      [memberId]: {
        ...(current[memberId] ?? {}),
        [unitId]: role,
      },
    }))
  }

  const getDraftAssignmentsForMember = (memberId: string) => {
    const draft = assignmentDrafts[memberId] ?? {}
    return Object.entries(draft)
      .filter(([, role]) => role && role !== 'none')
      .map(([unitId, role]) => ({
        unitId: Number(unitId),
        role: role as UnitAssignmentRole,
      }))
      .sort((a, b) => a.unitId - b.unitId)
  }

  const getPersistedAssignmentsForMember = (member: GovernanceMember) =>
    [...member.assignments]
      .map((assignment) => ({
        unitId: assignment.unitId,
        role: assignment.role,
      }))
      .sort((a, b) => a.unitId - b.unitId)

  const hasAssignmentChanges = (member: GovernanceMember) => {
    const draft = JSON.stringify(getDraftAssignmentsForMember(member.id))
    const persisted = JSON.stringify(getPersistedAssignmentsForMember(member))
    return draft !== persisted
  }

  const handleSaveAssignments = async (member: GovernanceMember) => {
    setSavingAssignmentsFor(member.id)
    try {
      await updateAssignmentsMutation.mutateAsync({
        memberId: member.id,
        assignments: getDraftAssignmentsForMember(member.id),
      })
    } catch {
      setSavingAssignmentsFor(null)
    }
  }

  const handleSaveUnitProfile = async (unit: OrganizationUnit) => {
    const draft = unitProfileDrafts[unit.id]
    const nextName = draft?.name.trim()

    if (!draft || !nextName) {
      toast.error('Nome da unidade é obrigatório')
      return
    }

    setUpdatingUnitId(unit.id)
    try {
      await updateUnitMutation.mutateAsync({
        unitId: unit.id,
        payload: {
          ...draft,
          name: nextName,
        },
      })
    } catch {
      setUpdatingUnitId(null)
    }
  }

  const handleToggleUnitStatus = async (unit: OrganizationUnit) => {
    setUpdatingUnitId(unit.id)
    try {
      await updateUnitMutation.mutateAsync({
        unitId: unit.id,
        payload: {
          status: unit.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE',
        },
      })
    } catch {
      setUpdatingUnitId(null)
    }
  }

  const formatTimeRemaining = (expiresAt: Date) => {
    const now = new Date()
    const diff = expiresAt.getTime() - now.getTime()

    if (diff <= 0) return 'expirado'

    const hours = Math.floor(diff / (1000 * 60 * 60))
    const days = Math.floor(hours / 24)

    if (days > 0) {
      return `${days} dia${days > 1 ? 's' : ''}`
    }
    if (hours > 0) {
      return `${hours} hora${hours > 1 ? 's' : ''}`
    }
    const minutes = Math.floor(diff / (1000 * 60))
    return `${minutes} minuto${minutes > 1 ? 's' : ''}`
  }

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: 'Pendente',
      accepted: 'Aceito',
      rejected: 'Rejeitado',
      canceled: 'Cancelado',
    }
    return labels[status] || status
  }

  const getStatusVariant = (
    status: string,
  ): 'default' | 'secondary' | 'destructive' | 'outline' => {
    const variants: Record<
      string,
      'default' | 'secondary' | 'destructive' | 'outline'
    > = {
      pending: 'default',
      accepted: 'secondary',
      rejected: 'destructive',
      canceled: 'outline',
    }
    return variants[status] || 'secondary'
  }

  const getInviterName = (inviterId: string) => {
    const member = members.find((m) => m.userId === inviterId)
    return member?.user.name
  }

  return (
    <div className="space-y-6">
      {canManageOrganizationSettings && (
        <>
          {/* Organization Details Card */}
          <Card>
            <CardHeader>
              <CardTitle>Conta da Organização</CardTitle>
              <CardDescription>
                Dados globais da conta comercial e do tenant do CalibraFácil.
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

          {/* Selected Unit Institutional Profile */}
          <Card>
            <CardHeader>
              <CardTitle>Perfil Institucional da Unidade Selecionada</CardTitle>
              <CardDescription>
                Identidade jurídica, técnica e de acreditação da matriz ou
                filial ativa no contexto atual.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {unitContextQuery.isPending || unitsQuery.isPending ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : unitContextQuery.data?.selectedUnitScope === 'all' ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  A visão consolidada está ativa. Selecione uma matriz ou filial
                  específica no switcher para visualizar o perfil institucional
                  correto daquela unidade.
                </div>
              ) : !selectedUnit ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  Nenhuma unidade ativa encontrada.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{selectedUnit.name}</Badge>
                    <Badge variant="outline">
                      {selectedUnit.installationType === 'PERMANENT'
                        ? 'Instalação permanente'
                        : selectedUnit.installationType === 'TEMPORARY'
                          ? 'Instalação temporária'
                          : 'Unidade móvel'}
                    </Badge>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Field>
                      <FieldLabel>CNPJ</FieldLabel>
                      <Input value={selectedUnit.cnpj ?? 'Não informado'} disabled />
                    </Field>
                    <Field>
                      <FieldLabel>Número de acreditação</FieldLabel>
                      <Input
                        value={selectedUnit.accreditationNumber ?? 'Não informado'}
                        disabled
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Órgão acreditador</FieldLabel>
                      <Input
                        value={selectedUnit.accreditationBody ?? 'Não informado'}
                        disabled
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Razão social</FieldLabel>
                      <Input value={selectedUnit.legalName ?? 'Não informado'} disabled />
                    </Field>
                    <Field>
                      <FieldLabel>Nome fantasia</FieldLabel>
                      <Input value={selectedUnit.tradeName ?? 'Não informado'} disabled />
                    </Field>
                    <Field>
                      <FieldLabel>Responsável técnico</FieldLabel>
                      <Input
                        value={
                          selectedUnit.technicalManagerName
                            ? `${selectedUnit.technicalManagerName}${
                                selectedUnit.technicalManagerTitle
                                  ? ` · ${selectedUnit.technicalManagerTitle}`
                                  : ''
                              }`
                            : 'Não informado'
                        }
                        disabled
                      />
                    </Field>
                    <Field className="lg:col-span-2">
                      <FieldLabel>Endereço</FieldLabel>
                      <Input
                        value={
                          [
                            selectedUnit.street,
                            selectedUnit.number,
                            selectedUnit.complement,
                            selectedUnit.neighbourhood,
                            selectedUnit.city,
                            selectedUnit.state,
                            selectedUnit.cep,
                          ]
                            .filter(Boolean)
                            .join(', ') || 'Não informado'
                        }
                        disabled
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Contato</FieldLabel>
                      <Input
                        value={
                          [selectedUnit.email, selectedUnit.phone]
                            .filter(Boolean)
                            .join(' · ') || 'Não informado'
                        }
                        disabled
                      />
                    </Field>
                    <Field className="lg:col-span-3">
                      <FieldLabel>Resumo do escopo</FieldLabel>
                      <Input
                        value={selectedUnit.scopeSummary ?? 'Não informado'}
                        disabled
                      />
                      <FieldDescription>
                        A edição continua na seção de Unidades logo abaixo.
                      </FieldDescription>
                    </Field>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <CustomPortalDomainCard />
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Unidades</CardTitle>
          <CardDescription>
            Estruture a operação por matriz, filial ou instalação acreditável,
            com identidade técnica e jurídica própria.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canManageOrganizationUnits && (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Você pode consultar as unidades e gerenciar atribuições dentro do
              seu escopo, mas a criação, edição estrutural e arquivamento de
              unidades ficam disponíveis apenas para administradores globais.
            </div>
          )}

          {unitsQuery.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <div className="space-y-3">
              {(unitsQuery.data?.data ?? []).map((unit) => (
                <div
                  key={unit.id}
                  className="rounded-lg border p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2">
                      {editingUnitId === unit.id ? (
                        <div className="space-y-4">
                          <div className="grid gap-3 md:grid-cols-2">
                            <Input
                              value={unitProfileDrafts[unit.id]?.name ?? unit.name}
                              onChange={(event) =>
                                setUnitProfileDrafts((current) => ({
                                  ...current,
                                  [unit.id]: {
                                    ...current[unit.id],
                                    name: event.target.value,
                                  },
                                }))
                              }
                              disabled={updatingUnitId === unit.id}
                              placeholder="Nome da unidade"
                            />
                            <Select
                              value={
                                unitProfileDrafts[unit.id]?.installationType ??
                                unit.installationType
                              }
                              onValueChange={(value) =>
                                setUnitProfileDrafts((current) => ({
                                  ...current,
                                  [unit.id]: {
                                    ...current[unit.id],
                                    installationType:
                                      value as UnitProfileDraft['installationType'],
                                  },
                                }))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Tipo de instalação" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="PERMANENT">Instalação permanente</SelectItem>
                                <SelectItem value="TEMPORARY">Instalação temporária</SelectItem>
                                <SelectItem value="MOBILE">Unidade móvel</SelectItem>
                              </SelectContent>
                            </Select>
                            <Input
                              value={unitProfileDrafts[unit.id]?.tradeName ?? ''}
                              onChange={(event) =>
                                setUnitProfileDrafts((current) => ({
                                  ...current,
                                  [unit.id]: {
                                    ...current[unit.id],
                                    tradeName: event.target.value,
                                  },
                                }))
                              }
                              disabled={updatingUnitId === unit.id}
                              placeholder="Nome fantasia"
                            />
                            <Input
                              value={unitProfileDrafts[unit.id]?.legalName ?? ''}
                              onChange={(event) =>
                                setUnitProfileDrafts((current) => ({
                                  ...current,
                                  [unit.id]: {
                                    ...current[unit.id],
                                    legalName: event.target.value,
                                  },
                                }))
                              }
                              disabled={updatingUnitId === unit.id}
                              placeholder="Razão social"
                            />
                            <Input
                              value={unitProfileDrafts[unit.id]?.cnpj ?? ''}
                              onChange={(event) =>
                                setUnitProfileDrafts((current) => ({
                                  ...current,
                                  [unit.id]: {
                                    ...current[unit.id],
                                    cnpj: event.target.value,
                                  },
                                }))
                              }
                              disabled={updatingUnitId === unit.id}
                              placeholder="CNPJ"
                            />
                            <Input
                              value={
                                unitProfileDrafts[unit.id]?.accreditationNumber ?? ''
                              }
                              onChange={(event) =>
                                setUnitProfileDrafts((current) => ({
                                  ...current,
                                  [unit.id]: {
                                    ...current[unit.id],
                                    accreditationNumber: event.target.value,
                                  },
                                }))
                              }
                              disabled={updatingUnitId === unit.id}
                              placeholder="Número da acreditação"
                            />
                            <Input
                              value={unitProfileDrafts[unit.id]?.accreditationBody ?? ''}
                              onChange={(event) =>
                                setUnitProfileDrafts((current) => ({
                                  ...current,
                                  [unit.id]: {
                                    ...current[unit.id],
                                    accreditationBody: event.target.value,
                                  },
                                }))
                              }
                              disabled={updatingUnitId === unit.id}
                              placeholder="Organismo acreditador"
                            />
                            <Input
                              value={
                                unitProfileDrafts[unit.id]?.technicalManagerName ?? ''
                              }
                              onChange={(event) =>
                                setUnitProfileDrafts((current) => ({
                                  ...current,
                                  [unit.id]: {
                                    ...current[unit.id],
                                    technicalManagerName: event.target.value,
                                  },
                                }))
                              }
                              disabled={updatingUnitId === unit.id}
                              placeholder="Responsável técnico"
                            />
                            <Input
                              value={
                                unitProfileDrafts[unit.id]?.technicalManagerTitle ?? ''
                              }
                              onChange={(event) =>
                                setUnitProfileDrafts((current) => ({
                                  ...current,
                                  [unit.id]: {
                                    ...current[unit.id],
                                    technicalManagerTitle: event.target.value,
                                  },
                                }))
                              }
                              disabled={updatingUnitId === unit.id}
                              placeholder="Cargo do responsável técnico"
                            />
                            <Input
                              value={unitProfileDrafts[unit.id]?.email ?? ''}
                              onChange={(event) =>
                                setUnitProfileDrafts((current) => ({
                                  ...current,
                                  [unit.id]: {
                                    ...current[unit.id],
                                    email: event.target.value,
                                  },
                                }))
                              }
                              disabled={updatingUnitId === unit.id}
                              placeholder="Email da unidade"
                            />
                            <Input
                              value={unitProfileDrafts[unit.id]?.phone ?? ''}
                              onChange={(event) =>
                                setUnitProfileDrafts((current) => ({
                                  ...current,
                                  [unit.id]: {
                                    ...current[unit.id],
                                    phone: event.target.value,
                                  },
                                }))
                              }
                              disabled={updatingUnitId === unit.id}
                              placeholder="Telefone"
                            />
                            <Input
                              value={unitProfileDrafts[unit.id]?.website ?? ''}
                              onChange={(event) =>
                                setUnitProfileDrafts((current) => ({
                                  ...current,
                                  [unit.id]: {
                                    ...current[unit.id],
                                    website: event.target.value,
                                  },
                                }))
                              }
                              disabled={updatingUnitId === unit.id}
                              placeholder="Website"
                            />
                            <Input
                              value={unitProfileDrafts[unit.id]?.street ?? ''}
                              onChange={(event) =>
                                setUnitProfileDrafts((current) => ({
                                  ...current,
                                  [unit.id]: {
                                    ...current[unit.id],
                                    street: event.target.value,
                                  },
                                }))
                              }
                              disabled={updatingUnitId === unit.id}
                              placeholder="Logradouro"
                            />
                            <Input
                              value={unitProfileDrafts[unit.id]?.number ?? ''}
                              onChange={(event) =>
                                setUnitProfileDrafts((current) => ({
                                  ...current,
                                  [unit.id]: {
                                    ...current[unit.id],
                                    number: event.target.value,
                                  },
                                }))
                              }
                              disabled={updatingUnitId === unit.id}
                              placeholder="Número"
                            />
                            <Input
                              value={unitProfileDrafts[unit.id]?.complement ?? ''}
                              onChange={(event) =>
                                setUnitProfileDrafts((current) => ({
                                  ...current,
                                  [unit.id]: {
                                    ...current[unit.id],
                                    complement: event.target.value,
                                  },
                                }))
                              }
                              disabled={updatingUnitId === unit.id}
                              placeholder="Complemento"
                            />
                            <Input
                              value={unitProfileDrafts[unit.id]?.neighbourhood ?? ''}
                              onChange={(event) =>
                                setUnitProfileDrafts((current) => ({
                                  ...current,
                                  [unit.id]: {
                                    ...current[unit.id],
                                    neighbourhood: event.target.value,
                                  },
                                }))
                              }
                              disabled={updatingUnitId === unit.id}
                              placeholder="Bairro"
                            />
                            <Input
                              value={unitProfileDrafts[unit.id]?.city ?? ''}
                              onChange={(event) =>
                                setUnitProfileDrafts((current) => ({
                                  ...current,
                                  [unit.id]: {
                                    ...current[unit.id],
                                    city: event.target.value,
                                  },
                                }))
                              }
                              disabled={updatingUnitId === unit.id}
                              placeholder="Cidade"
                            />
                            <Input
                              value={unitProfileDrafts[unit.id]?.state ?? ''}
                              onChange={(event) =>
                                setUnitProfileDrafts((current) => ({
                                  ...current,
                                  [unit.id]: {
                                    ...current[unit.id],
                                    state: event.target.value,
                                  },
                                }))
                              }
                              disabled={updatingUnitId === unit.id}
                              placeholder="UF"
                            />
                            <Input
                              value={unitProfileDrafts[unit.id]?.cep ?? ''}
                              onChange={(event) =>
                                setUnitProfileDrafts((current) => ({
                                  ...current,
                                  [unit.id]: {
                                    ...current[unit.id],
                                    cep: event.target.value,
                                  },
                                }))
                              }
                              disabled={updatingUnitId === unit.id}
                              placeholder="CEP"
                            />
                            <Input
                              value={unitProfileDrafts[unit.id]?.scopeSummary ?? ''}
                              onChange={(event) =>
                                setUnitProfileDrafts((current) => ({
                                  ...current,
                                  [unit.id]: {
                                    ...current[unit.id],
                                    scopeSummary: event.target.value,
                                  },
                                }))
                              }
                              disabled={updatingUnitId === unit.id}
                              placeholder="Resumo do escopo acreditado"
                            />
                          </div>
                          <Input
                            value={unitProfileDrafts[unit.id]?.scopeNotes ?? ''}
                            onChange={(event) =>
                              setUnitProfileDrafts((current) => ({
                                ...current,
                                [unit.id]: {
                                  ...current[unit.id],
                                  scopeNotes: event.target.value,
                                },
                              }))
                            }
                            disabled={updatingUnitId === unit.id}
                            placeholder="Observações complementares sobre escopo e instalação"
                          />
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              disabled={updatingUnitId === unit.id}
                              onClick={() => handleSaveUnitProfile(unit)}
                            >
                              Salvar perfil
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={updatingUnitId === unit.id}
                              onClick={() => {
                                setEditingUnitId(null)
                                setUnitProfileDrafts((current) => ({
                                  ...current,
                                  [unit.id]: createUnitProfileDraft(unit),
                                }))
                              }}
                            >
                              Cancelar
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <p className="font-medium">{unit.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {unit.tradeName || unit.legalName || unit.slug}
                          </p>
                          <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                            {unit.cnpj ? <p>CNPJ: {unit.cnpj}</p> : null}
                            {unit.accreditationNumber ? (
                              <p>
                                Acreditação: {unit.accreditationNumber}
                                {unit.accreditationBody
                                  ? ` · ${unit.accreditationBody}`
                                  : ''}
                              </p>
                            ) : null}
                            {unit.city || unit.state ? (
                              <p>
                                {[unit.city, unit.state].filter(Boolean).join(' / ')}
                              </p>
                            ) : null}
                            {unit.technicalManagerName ? (
                              <p>
                                Responsável técnico: {unit.technicalManagerName}
                                {unit.technicalManagerTitle
                                  ? ` · ${unit.technicalManagerTitle}`
                                  : ''}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {unit.isDefault ? (
                        <Badge variant="secondary">Padrão</Badge>
                      ) : null}
                      <Badge
                        variant={
                          unit.status === 'ACTIVE' ? 'default' : 'secondary'
                        }
                      >
                        {unit.status === 'ACTIVE' ? 'Ativa' : 'Arquivada'}
                      </Badge>
                      {canManageOrganizationUnits && (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={
                              updatingUnitId === unit.id ||
                              updateUnitMutation.isPending
                            }
                            onClick={() => {
                              setEditingUnitId(unit.id)
                              setUnitProfileDrafts((current) => ({
                                ...current,
                                [unit.id]:
                                  current[unit.id] ?? createUnitProfileDraft(unit),
                              }))
                            }}
                          >
                            Editar perfil
                          </Button>
                          {!unit.isDefault && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={
                                updatingUnitId === unit.id ||
                                updateUnitMutation.isPending
                              }
                              onClick={() => handleToggleUnitStatus(unit)}
                            >
                              {unit.status === 'ACTIVE' ? 'Arquivar' : 'Reativar'}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {canManageOrganizationUnits && (
            <>
              <Separator />

              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!newUnitName.trim()) return
                  createUnitMutation.mutate(newUnitName.trim())
                }}
              >
                <Input
                  value={newUnitName}
                  onChange={(e) => setNewUnitName(e.target.value)}
                  placeholder="Nova unidade"
                  disabled={createUnitMutation.isPending}
                />
                <Button
                  type="submit"
                  disabled={createUnitMutation.isPending || !newUnitName.trim()}
                >
                  {createUnitMutation.isPending ? 'Criando...' : 'Criar unidade'}
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>

      {canViewGovernance && (
        <Card>
          <CardHeader>
            <CardTitle>Governança por Unidade</CardTitle>
            <CardDescription>
              Controle quem atua em cada unidade e qual papel operacional cada
              membro assume no seu escopo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {governanceMembersQuery.isPending ? (
              <MembersSkeleton />
            ) : governanceMembersQuery.data?.data.length ? (
              <div className="space-y-4">
                {governanceMembersQuery.data.data.map((member) => {
                  const isGlobalManagerMember =
                    member.role === 'owner' || member.role === 'admin'

                  return (
                    <div
                      key={member.id}
                      className="rounded-lg border p-4 space-y-4"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="font-medium">{member.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {member.email}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">
                            Papel global: {getRoleLabel(member.role)}
                          </Badge>
                          {isGlobalManagerMember ? (
                            <Badge>Papel global com acesso total</Badge>
                          ) : null}
                        </div>
                      </div>

                      {isGlobalManagerMember ? (
                        <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                          Este membro tem acesso global à organização. As
                          atribuições por unidade não restringem owner/admin.
                        </div>
                      ) : (
                        <>
                          <div className="space-y-3">
                            {(unitsQuery.data?.data ?? []).map((unit) => (
                              <div
                                key={`${member.id}-${unit.id}`}
                                className="flex flex-col gap-2 rounded-md border p-3 md:flex-row md:items-center md:justify-between"
                              >
                                <div>
                                  <p className="font-medium">{unit.name}</p>
                                  <p className="text-sm text-muted-foreground">
                                    {unit.slug}
                                  </p>
                                </div>
                                <Select
                                  value={
                                    assignmentDrafts[member.id]?.[unit.id] ?? 'none'
                                  }
                                  onValueChange={(value) =>
                                    updateAssignmentDraft(
                                      member.id,
                                      unit.id,
                                      value as EditableUnitAssignmentRole,
                                    )
                                  }
                                  disabled={
                                    !canManageAssignments ||
                                    savingAssignmentsFor === member.id
                                  }
                                >
                                  <SelectTrigger className="w-full md:w-52">
                                    <SelectValue>
                                      {getUnitRoleLabel(
                                        assignmentDrafts[member.id]?.[unit.id] ?? 'none',
                                      )}
                                    </SelectValue>
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(
                                      [
                                        'none',
                                        'member',
                                        'technician',
                                        'unit_admin',
                                      ] as EditableUnitAssignmentRole[]
                                    ).map((role) => (
                                      <SelectItem key={role} value={role}>
                                        {getUnitRoleLabel(role)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            ))}
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-sm text-muted-foreground">
                              {member.assignments.length > 0
                                ? `Atribuições atuais: ${member.assignments
                                    .map(
                                      (assignment) =>
                                        `${assignment.unitName} (${getUnitRoleLabel(
                                          assignment.role,
                                        )})`,
                                    )
                                    .join(', ')}`
                                : 'Sem atribuições ativas neste escopo.'}
                            </p>
                            <Button
                              type="button"
                              size="sm"
                              disabled={
                                !canManageAssignments ||
                                !hasAssignmentChanges(member) ||
                                savingAssignmentsFor === member.id
                              }
                              onClick={() => handleSaveAssignments(member)}
                            >
                              {savingAssignmentsFor === member.id
                                ? 'Salvando...'
                                : 'Salvar atribuições'}
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhum membro disponível no seu escopo de governança.
              </p>
            )}
          </CardContent>
        </Card>
      )}

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
                          {getRoleLabel(member.role)}
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
                                : getRoleLabel(member.role)}
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
                      onValueChange={(value) => value && setInviteRole(value)}
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
      {canManageOrganizationSettings && (invitations.length > 0 || invitationsLoading) && (
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
                            {getRoleLabel(invitation.role)}
                            {getInviterName(invitation.inviterId) && (
                              <span className="ml-1">
                                · Convidado por{' '}
                                {getInviterName(invitation.inviterId)}
                              </span>
                            )}
                            {isPending && !isExpired && (
                              <span className="ml-1">
                                · Expira em{' '}
                                {formatTimeRemaining(invitation.expiresAt)}
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
                        <Badge variant={getStatusVariant(invitation.status)}>
                          {getStatusLabel(invitation.status)}
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
      {canManageOrganizationSettings && <AlertDialog
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
      </AlertDialog>}

      {/* Danger Zone */}
      {canManageOrganizationSettings && <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">
            Excluir Organização
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
      </Card>}
    </div>
  )
}

function CustomPortalDomainCard() {
  const queryClient = useQueryClient()
  const accessQuery = usePlanAccess()
  const [hostname, setHostname] = useState('')

  const domainQuery = useQuery({
    queryKey: ['portal-domain'],
    queryFn: async () => {
      const res = await api.api['portal-domains'].$get()
      if (!res.ok) {
        throw new Error('Falha ao carregar domínio do portal')
      }
      return res.json() as Promise<{
        portalBaseUrl: string
        domain: {
          id: string
          hostname: string
          verifiedAt: string | null
          activatedAt: string | null
          lastVerifiedAt: string | null
          isActive: boolean
          verification: { type: 'TXT'; host: string; value: string }
        } | null
      }>
    },
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api['portal-domains'].$post({
        json: { hostname },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          data && typeof data === 'object' && 'error' in data
            ? String(data.error)
            : 'Falha ao salvar domínio',
        )
      }
      return res.json()
    },
    onSuccess: async () => {
      toast.success('Domínio salvo. Configure o TXT e verifique.')
      await queryClient.invalidateQueries({ queryKey: ['portal-domain'] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Falha ao salvar domínio')
    },
  })

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api['portal-domains'].verify.$post()
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          data && typeof data === 'object' && 'error' in data
            ? String(data.error)
            : 'Falha ao verificar domínio',
        )
      }
      return res.json()
    },
    onSuccess: async () => {
      toast.success('Domínio verificado')
      await queryClient.invalidateQueries({ queryKey: ['portal-domain'] })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao verificar domínio',
      )
    },
  })

  const activateMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api['portal-domains'].activate.$post()
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          data && typeof data === 'object' && 'error' in data
            ? String(data.error)
            : 'Falha ao ativar domínio',
        )
      }
      return res.json()
    },
    onSuccess: async () => {
      toast.success('Domínio ativado')
      await queryClient.invalidateQueries({ queryKey: ['portal-domain'] })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao ativar domínio',
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api['portal-domains'].$delete()
      if (!res.ok) {
        throw new Error('Falha ao remover domínio')
      }
    },
    onSuccess: async () => {
      toast.success('Domínio removido')
      setHostname('')
      await queryClient.invalidateQueries({ queryKey: ['portal-domain'] })
    },
    onError: () => {
      toast.error('Falha ao remover domínio')
    },
  })

  const hasCustomDomain = accessQuery.data?.hasCustomDomain ?? false
  const domain = domainQuery.data?.domain ?? null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Domínio do Portal</CardTitle>
        <CardDescription>
          Configure um domínio próprio para o portal do cliente. Esta entrega
          cobre o portal; o dashboard continua no domínio principal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasCustomDomain && (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            O domínio personalizado do portal fica disponível a partir do plano
            Professional.
          </div>
        )}

        <div className="rounded-lg border p-4">
          <p className="font-medium">URL atual do portal</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {domainQuery.data?.portalBaseUrl ?? 'https://portal.calibrafacil.com'}
          </p>
        </div>

        <form
          className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-end"
          onSubmit={(event) => {
            event.preventDefault()
            createMutation.mutate()
          }}
        >
          <Field className="flex-1">
            <FieldLabel htmlFor="portal-domain-hostname">Hostname</FieldLabel>
            <Input
              id="portal-domain-hostname"
              value={hostname}
              onChange={(event) => setHostname(event.target.value)}
              placeholder="portal.suaempresa.com.br"
              disabled={!hasCustomDomain || createMutation.isPending}
            />
            <FieldDescription>
              Use apenas o hostname. Exemplo: <code>portal.suaempresa.com.br</code>.
            </FieldDescription>
          </Field>
          <Button
            type="submit"
            disabled={!hasCustomDomain || !hostname.trim() || createMutation.isPending}
          >
            Salvar domínio
          </Button>
        </form>

        {domain && (
          <div className="space-y-4 rounded-lg border p-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant={domain.verifiedAt ? 'default' : 'secondary'}>
                {domain.verifiedAt ? 'Verificado' : 'Aguardando DNS'}
              </Badge>
              <Badge variant={domain.isActive ? 'default' : 'secondary'}>
                {domain.isActive ? 'Ativo' : 'Inativo'}
              </Badge>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">Hostname</p>
                <p className="font-medium">{domain.hostname}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Registro TXT</p>
                <p className="font-mono text-sm">{domain.verification.host}</p>
              </div>
              <div className="md:col-span-2">
                <p className="text-sm text-muted-foreground">Token</p>
                <p className="font-mono text-sm">{domain.verification.value}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => verifyMutation.mutate()}
                disabled={!hasCustomDomain || verifyMutation.isPending}
              >
                Verificar DNS
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => activateMutation.mutate()}
                disabled={!hasCustomDomain || !domain.verifiedAt || activateMutation.isPending}
              >
                Ativar domínio
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
              >
                Remover
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
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

function InvitationsSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2].map((i) => (
        <div
          key={i}
          className="flex items-center justify-between p-4 border rounded-lg"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
          <Skeleton className="h-8 w-8" />
        </div>
      ))}
    </div>
  )
}
