import { useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import { translateAuthErrorMessage } from '@calibra-facil/auth/error-messages'
import {
  ACCREDITATION_NUMBER_PREFIX,
  getAccreditationStatus,
  normalizeAccreditationNumber,
} from '@calibra-facil/shared'
import { usePlanAccess } from '@/hooks/use-plan-access'
import { calibraApi } from '@/utils/api'
import {
  useDashboardUnitsData,
  useOrganizationGovernanceActivityData,
  useOrganizationGovernanceMembersData,
  useOrganizationInvitationsData,
  useOrganizationMembersData,
  useOrganizationUnitsData,
} from '@/features/settings/queries'
import type {
  GovernanceMember,
  OrganizationMember,
  OrganizationUnit,
  UnitAssignmentRole,
} from '@/features/settings/types'
import {
  buildOrganizationIdentityPayload,
  buildOrganizationIsoPayload,
  buildDraftAssignmentsForMember,
  canManageOrganizationSettings as canManageOrganizationSettingsForRole,
  createAssignmentDrafts,
  createOrganizationIdentityDraft,
  createOrganizationIsoDraft,
  createUnitNameDrafts,
  EDITABLE_UNIT_ASSIGNMENT_ROLES,
  formatGovernanceActivityTime,
  formatInvitationTimeRemaining,
  getGovernanceActivityDescription,
  getGovernanceActivityLabel,
  getInvitationStatusLabel,
  getInvitationStatusVariant,
  getInviterName,
  getCurrentOrganizationRole,
  getOrganizationRoleLabel,
  getUnitAssignmentRoleLabel,
  hasAssignmentChanges,
  isEditableUnitAssignmentRole,
  isGlobalMemberRole,
  mergeUnitNameDrafts,
  ORGANIZATION_AVAILABLE_ROLES,
  organizationAssignmentQueryKeys,
  organizationInvitationsQueryKey,
  organizationMembersQueryKey,
  organizationRoleGovernanceQueryKeys,
  organizationUnitGovernanceQueryKeys,
  updateAssignmentDraftOverride,
  type AssignmentDrafts,
  type GlobalMemberRole,
} from '@/features/settings/organization-model'
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group'
import { MaskedInput } from '@/components/ui/masked-input'
import { Switch } from '@/components/ui/switch'
import { AccreditationSealPreview } from '@/features/settings/accreditation-seal-preview'
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
import { brazilPhoneMask, cepMask, cnpjMask } from '@/lib/input-masks'

type ActiveOrganization = NonNullable<
  ReturnType<typeof useActiveOrganization>['data']
> & {
  cnpj?: string | null
  accreditationNumber?: string | null
  accreditationBody?: string | null
  accreditationActive?: boolean | null
  street?: string | null
  number?: string | null
  complement?: string | null
  neighbourhood?: string | null
  city?: string | null
  state?: string | null
  cep?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  logo?: string | null
  technicalManagerName?: string | null
  technicalManagerTitle?: string | null
}

export type OrganizationSection = 'profile' | 'units' | 'members'

export function OrganizationSettingsRoute({
  section = 'profile',
}: {
  section?: OrganizationSection
} = {}) {
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

  return (
    <OrganizationSettingsPage
      key={activeOrg.id}
      activeOrg={activeOrg}
      section={section}
    />
  )
}

function OrganizationSettingsPage({
  activeOrg,
  section,
}: {
  activeOrg: ActiveOrganization
  section: OrganizationSection
}) {
  const queryClient = useQueryClient()
  const currentOrgRole = getCurrentOrganizationRole(activeOrg)
  const canManageOrganizationSettings =
    canManageOrganizationSettingsForRole(currentOrgRole)
  const identityDraft = createOrganizationIdentityDraft(activeOrg)
  const isoDraft = createOrganizationIsoDraft(activeOrg)
  const [name, setName] = useState(identityDraft.name)
  const [slug, setSlug] = useState(identityDraft.slug)
  const [isUpdating, setIsUpdating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [organizationLogo, setOrganizationLogo] = useState(
    activeOrg.logo ?? null,
  )

  // ISO 17025 / RBC compliance fields
  const [cnpj, setCnpj] = useState(isoDraft.cnpj)
  const [accreditationNumber, setAccreditationNumber] = useState(
    isoDraft.accreditationNumber,
  )
  const [accreditationBody, setAccreditationBody] = useState(
    isoDraft.accreditationBody,
  )
  const [accreditationActive, setAccreditationActive] = useState(
    isoDraft.accreditationActive,
  )
  const [street, setStreet] = useState(isoDraft.street)
  const [number, setNumber] = useState(isoDraft.number)
  const [complement, setComplement] = useState(isoDraft.complement)
  const [neighbourhood, setNeighbourhood] = useState(isoDraft.neighbourhood)
  const [city, setCity] = useState(isoDraft.city)
  const [state, setState] = useState(isoDraft.state)
  const [cep, setCep] = useState(isoDraft.cep)
  const [phone, setPhone] = useState(isoDraft.phone)
  const [email, setEmail] = useState(isoDraft.email)
  const [website, setWebsite] = useState(isoDraft.website)
  const [technicalManagerName, setTechnicalManagerName] = useState(
    isoDraft.technicalManagerName,
  )
  const [technicalManagerTitle, setTechnicalManagerTitle] = useState(
    isoDraft.technicalManagerTitle,
  )
  const [isUpdatingIso, setIsUpdatingIso] = useState(false)

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
  const [savingAssignmentsFor, setSavingAssignmentsFor] = useState<
    string | null
  >(null)
  const [assignmentDraftOverrides, setAssignmentDraftOverrides] =
    useState<AssignmentDrafts>({})
  const [editingUnitId, setEditingUnitId] = useState<number | null>(null)
  const [unitNameDraftOverrides, setUnitNameDraftOverrides] = useState<
    Record<number, string>
  >({})
  const [updatingUnitId, setUpdatingUnitId] = useState<number | null>(null)

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [newUnitName, setNewUnitName] = useState('')

  const availableRoles = ORGANIZATION_AVAILABLE_ROLES
  const accessQuery = usePlanAccess()
  const hasMultiUnit =
    accessQuery.data?.entitlements.includes('multi_unit') ?? false

  const unitsQuery = useOrganizationUnitsData({
    organizationId: activeOrg.id,
    enabled: hasMultiUnit,
  })

  const unitContextQuery = useDashboardUnitsData({
    organizationId: activeOrg.id,
    enabled: hasMultiUnit,
  })

  const governanceMembersQuery = useOrganizationGovernanceMembersData({
    organizationId: activeOrg.id,
    enabled: hasMultiUnit,
  })

  const governanceActivityQuery = useOrganizationGovernanceActivityData({
    organizationId: activeOrg.id,
    enabled: hasMultiUnit,
  })

  const governanceViewer =
    governanceMembersQuery.data?.viewer ?? unitsQuery.data?.viewer ?? null
  const canManageOrganizationUnits =
    governanceViewer?.canManageOrganizationUnits ??
    canManageOrganizationSettings
  const canManageAssignments = governanceViewer?.canManageAssignments ?? false
  const canManageGlobalRoles =
    governanceViewer?.canManageGlobalRoles ?? canManageOrganizationSettings
  const canViewGovernance = governanceViewer?.canViewGovernance ?? false
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
  const baseUnitNameDrafts = useMemo<Record<number, string>>(
    () => createUnitNameDrafts(unitsQuery.data?.data ?? []),
    [unitsQuery.data],
  )
  const unitNameDrafts = useMemo<Record<number, string>>(
    () => mergeUnitNameDrafts(baseUnitNameDrafts, unitNameDraftOverrides),
    [baseUnitNameDrafts, unitNameDraftOverrides],
  )
  const baseAssignmentDrafts = useMemo<AssignmentDrafts>(
    () =>
      createAssignmentDrafts(
        governanceMembersQuery.data?.data ?? [],
        unitsQuery.data?.data ?? [],
      ),
    [governanceMembersQuery.data, unitsQuery.data],
  )
  const invalidateQueryKeys = (queryKeys: ReadonlyArray<readonly unknown[]>) =>
    Promise.all(
      queryKeys.map((queryKey) =>
        queryClient.invalidateQueries({ queryKey: [...queryKey] }),
      ),
    )

  const createUnitMutation = useMutation({
    mutationFn: async (name: string) => {
      return calibraApi.units.createAdminUnit<OrganizationUnit>(name)
    },
    onSuccess: async () => {
      setNewUnitName('')
      await invalidateQueryKeys(
        organizationUnitGovernanceQueryKeys(activeOrg.id),
      )
      toast.success('Unidade criada com sucesso')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao criar unidade',
      )
    },
  })

  const updateUnitMutation = useMutation({
    mutationFn: async ({
      unitId,
      payload,
    }: {
      unitId: number
      payload: { name?: string; status?: 'ACTIVE' | 'ARCHIVED' }
    }) => {
      return calibraApi.units.updateAdminUnit<OrganizationUnit>(unitId, payload)
    },
    onSuccess: async () => {
      setEditingUnitId(null)
      setUpdatingUnitId(null)
      await invalidateQueryKeys(
        organizationUnitGovernanceQueryKeys(activeOrg.id),
      )
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
      return calibraApi.units.updateMemberAssignments(memberId, assignments)
    },
    onSuccess: async () => {
      setSavingAssignmentsFor(null)
      await invalidateQueryKeys(organizationAssignmentQueryKeys(activeOrg.id))
      toast.success('Atribuições atualizadas com sucesso')
    },
    onError: (error) => {
      setSavingAssignmentsFor(null)
      toast.error(
        error instanceof Error
          ? error.message
          : 'Erro ao atualizar atribuições',
      )
    },
  })

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
      await invalidateQueryKeys(
        organizationRoleGovernanceQueryKeys(activeOrg.id),
      )
      toast.success('Função atualizada com sucesso')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao atualizar função',
      )
    },
  })

  const logoUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      return calibraApi.organizationMedia.uploadLogo(file, {
        fileName: file.name,
      })
    },
    onSuccess: async (data) => {
      setOrganizationLogo(data.logoUrl)
      toast.success('Logo da organização atualizado')
      await queryClient.invalidateQueries()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao enviar logo',
      )
    },
  })

  const logoDeleteMutation = useMutation({
    mutationFn: () => calibraApi.organizationMedia.deleteLogo(),
    onSuccess: async () => {
      setOrganizationLogo(null)
      toast.success('Logo da organização removido')
      await queryClient.invalidateQueries()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao remover logo',
      )
    },
  })

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
        data: buildOrganizationIdentityPayload({ name, slug }),
      })
      if (result.error) {
        throw new Error(
          translateAuthErrorMessage(
            result.error.message,
            'Falha ao atualizar organização',
          ),
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

  const handleUpdateIso17025 = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsUpdatingIso(true)
    try {
      const result = await authClient.organization.update({
        data: buildOrganizationIsoPayload({
          cnpj,
          accreditationNumber,
          accreditationBody,
          accreditationActive,
          street,
          number,
          complement,
          neighbourhood,
          city,
          state,
          cep,
          phone,
          email,
          website,
          technicalManagerName,
          technicalManagerTitle,
        }),
      })
      if (result.error) {
        throw new Error(
          translateAuthErrorMessage(
            result.error.message,
            'Falha ao atualizar informações',
          ),
        )
      }
      toast.success('Informações ISO 17025 atualizadas com sucesso!')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Falha ao atualizar informações'
      toast.error(message)
    } finally {
      setIsUpdatingIso(false)
    }
  }

  const handleLogoFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    logoUploadMutation.mutate(file)
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
        throw new Error(
          translateAuthErrorMessage(
            result.error.message,
            'Falha ao excluir organização',
          ),
        )
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

  const updateAssignmentDraft = (
    memberId: string,
    unitId: number,
    role: UnitAssignmentRole | 'none',
  ) => {
    setAssignmentDraftOverrides((current) =>
      updateAssignmentDraftOverride({ current, memberId, unitId, role }),
    )
  }

  const getDraftAssignmentsForMember = (memberId: string) =>
    buildDraftAssignmentsForMember({
      memberId,
      units: unitsQuery.data?.data ?? [],
      baseDrafts: baseAssignmentDrafts,
      overrides: assignmentDraftOverrides,
    })

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

  const handleRenameUnit = async (unit: OrganizationUnit) => {
    const nextName = unitNameDrafts[unit.id]?.trim()
    if (!nextName || nextName === unit.name) {
      setEditingUnitId(null)
      return
    }

    setUpdatingUnitId(unit.id)
    try {
      await updateUnitMutation.mutateAsync({
        unitId: unit.id,
        payload: { name: nextName },
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

  const sectionDescription =
    section === 'units'
      ? 'Unidades operacionais e governança por unidade.'
      : section === 'members'
        ? 'Membros da organização e convites pendentes.'
        : 'Identidade do laboratório: postura multiunidade, detalhes, logotipo e informações ISO 17025.'

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-pretty text-sm text-muted-foreground">
        {sectionDescription}
      </p>

      {section === 'profile' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Postura Multiunidade</CardTitle>
              <CardDescription>
                Torne explícito o escopo operacional ativo, quem você consegue
                governar e quando a visão consolidada está em uso.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!hasMultiUnit ? (
                <div className="rounded-xl border bg-muted/30 p-4">
                  <Badge variant="secondary">Unidade única</Badge>
                  <p className="mt-3 text-sm text-muted-foreground">
                    Sua organização opera em uma única unidade — toda a operação
                    usa o mesmo escopo. A governança multiunidade (escopos por
                    unidade e visão consolidada) fica disponível no plano
                    Enterprise.
                  </p>
                </div>
              ) : unitContextQuery.isPending ? (
                <div className="grid gap-4 md:grid-cols-3">
                  <Skeleton className="h-28 w-full" />
                  <Skeleton className="h-28 w-full" />
                  <Skeleton className="h-28 w-full" />
                </div>
              ) : (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)_minmax(0,0.85fr)]">
                  <div className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">
                        {unitContextQuery.data?.scopeSummary.label ??
                          'Escopo ativo'}
                      </Badge>
                      <Badge variant="outline">
                        {unitContextQuery.data?.scopeSummary
                          .effectiveRoleLabel ?? 'Sem papel operacional'}
                      </Badge>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">
                      {unitContextQuery.data?.scopeSummary.description ??
                        'O escopo operacional aparece aqui conforme a unidade selecionada.'}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Badge variant="outline">
                        {unitContextQuery.data?.scopeSummary
                          .accessibleUnitsCount ?? 0}{' '}
                        unidade(s) acessível(eis)
                      </Badge>
                      {governanceViewer?.canAccessConsolidatedView ? (
                        <Badge variant="outline">
                          Pode abrir consolidado global
                        </Badge>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-xl border p-4">
                    <p className="text-sm font-medium">Governança efetiva</p>
                    <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                      <p>
                        {governanceViewer?.isGlobalManager
                          ? 'Você opera como administrador global da organização.'
                          : governanceViewer?.canManageAssignments
                            ? 'Você governa apenas as unidades sob sua responsabilidade.'
                            : 'Você está em um escopo operacional sem poderes de governança.'}
                      </p>
                      <p>
                        {governanceViewer?.managedUnitIds.length ?? 0}{' '}
                        unidade(s) sob gestão
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border p-4">
                    <p className="text-sm font-medium">Fila e visibilidade</p>
                    <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                      <p>
                        {unitContextQuery.data?.selectedUnitScope === 'all'
                          ? 'Listas e métricas operacionais estão em visão consolidada.'
                          : 'Listas e aprovações devem respeitar apenas a unidade ativa.'}
                      </p>
                      <p>
                        {governanceViewer?.canAccessConsolidatedView
                          ? 'Relatórios consolidados ficam disponíveis neste contexto.'
                          : 'Relatórios consolidados ficam reservados aos administradores globais.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {canManageOrganizationSettings && (
            <>
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

              <Card>
                <CardHeader>
                  <CardTitle>Logotipo da Organização</CardTitle>
                  <CardDescription>
                    Usado na identificação do laboratório, portal e
                    certificados.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-4">
                      <div className="flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
                        {organizationLogo ? (
                          <img
                            src={organizationLogo}
                            alt={`Logo de ${activeOrg.name}`}
                            className="max-h-full max-w-full object-contain"
                          />
                        ) : (
                          <HugeiconsIcon
                            icon={Building06Icon}
                            className="size-8 text-muted-foreground"
                          />
                        )}
                      </div>
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium">
                          {organizationLogo ? 'Logo configurado' : 'Sem logo'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          PNG, JPG, WebP ou SVG até 2MB.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        className="hidden"
                        onChange={handleLogoFileChange}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={
                          logoUploadMutation.isPending ||
                          logoDeleteMutation.isPending
                        }
                        onClick={() => logoInputRef.current?.click()}
                      >
                        {logoUploadMutation.isPending
                          ? 'Enviando...'
                          : 'Enviar'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={
                          !organizationLogo ||
                          logoUploadMutation.isPending ||
                          logoDeleteMutation.isPending
                        }
                        onClick={() => logoDeleteMutation.mutate()}
                      >
                        {logoDeleteMutation.isPending
                          ? 'Removendo...'
                          : 'Remover'}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* ISO 17025 / RBC Compliance Card */}
              <Card>
                <CardHeader>
                  <CardTitle>Informações ISO 17025</CardTitle>
                  <CardDescription>
                    Dados do laboratório para certificados de calibração
                    conforme ISO/IEC 17025 e RBC/Inmetro.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleUpdateIso17025}>
                    <FieldGroup>
                      {/* Identification */}
                      <Field>
                        <FieldLabel htmlFor="org-cnpj">CNPJ</FieldLabel>
                        <MaskedInput
                          id="org-cnpj"
                          maskOptions={cnpjMask}
                          value={cnpj}
                          onInput={(e) => setCnpj(e.currentTarget.value)}
                          disabled={isUpdatingIso}
                          placeholder="00.000.000/0000-00"
                        />
                      </Field>

                      {/* Accreditation */}
                      <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
                        <FieldGroup>
                          <Field orientation="horizontal">
                            <Switch
                              id="org-accreditation-active"
                              checked={accreditationActive}
                              onCheckedChange={setAccreditationActive}
                              disabled={isUpdatingIso}
                            />
                            <FieldLabel htmlFor="org-accreditation-active">
                              Acreditação ativa
                            </FieldLabel>
                          </Field>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <Field>
                              <FieldLabel htmlFor="org-accreditation-number">
                                Número de Acreditação
                              </FieldLabel>
                              <InputGroup>
                                <InputGroupAddon>
                                  <InputGroupText className="font-semibold">
                                    {ACCREDITATION_NUMBER_PREFIX}
                                  </InputGroupText>
                                </InputGroupAddon>
                                <InputGroupInput
                                  id="org-accreditation-number"
                                  inputMode="numeric"
                                  value={accreditationNumber}
                                  onChange={(e) =>
                                    setAccreditationNumber(
                                      normalizeAccreditationNumber(
                                        e.target.value,
                                      ),
                                    )
                                  }
                                  disabled={isUpdatingIso}
                                  placeholder="0123"
                                />
                              </InputGroup>
                              <FieldDescription>
                                Apenas o número. O prefixo CAL é fixo no selo.
                              </FieldDescription>
                            </Field>
                            <Field>
                              <FieldLabel htmlFor="org-accreditation-body">
                                Órgão Acreditador
                              </FieldLabel>
                              <Input
                                id="org-accreditation-body"
                                value={accreditationBody}
                                onChange={(e) =>
                                  setAccreditationBody(e.target.value)
                                }
                                disabled={isUpdatingIso}
                                placeholder="CGCRE/Inmetro"
                              />
                            </Field>
                          </div>
                        </FieldGroup>
                        <AccreditationSealPreview
                          status={getAccreditationStatus({
                            accreditationActive,
                            accreditationNumber,
                          })}
                          accreditationNumber={accreditationNumber}
                        />
                      </div>

                      <Separator />

                      {/* Address */}
                      <div className="grid gap-4 sm:grid-cols-3">
                        <Field className="sm:col-span-2">
                          <FieldLabel htmlFor="org-street">Rua</FieldLabel>
                          <Input
                            id="org-street"
                            value={street}
                            onChange={(e) => setStreet(e.target.value)}
                            disabled={isUpdatingIso}
                            placeholder="Rua das Calibrações"
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="org-number">Número</FieldLabel>
                          <Input
                            id="org-number"
                            value={number}
                            onChange={(e) => setNumber(e.target.value)}
                            disabled={isUpdatingIso}
                            placeholder="123"
                          />
                        </Field>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field>
                          <FieldLabel htmlFor="org-complement">
                            Complemento
                          </FieldLabel>
                          <Input
                            id="org-complement"
                            value={complement}
                            onChange={(e) => setComplement(e.target.value)}
                            disabled={isUpdatingIso}
                            placeholder="Sala 101"
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="org-neighbourhood">
                            Bairro
                          </FieldLabel>
                          <Input
                            id="org-neighbourhood"
                            value={neighbourhood}
                            onChange={(e) => setNeighbourhood(e.target.value)}
                            disabled={isUpdatingIso}
                            placeholder="Centro"
                          />
                        </Field>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-3">
                        <Field>
                          <FieldLabel htmlFor="org-city">Cidade</FieldLabel>
                          <Input
                            id="org-city"
                            value={city}
                            onChange={(e) => setCity(e.target.value)}
                            disabled={isUpdatingIso}
                            placeholder="São Paulo"
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="org-state">Estado</FieldLabel>
                          <Input
                            id="org-state"
                            value={state}
                            onChange={(e) => setState(e.target.value)}
                            disabled={isUpdatingIso}
                            placeholder="SP"
                            maxLength={2}
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="org-cep">CEP</FieldLabel>
                          <MaskedInput
                            id="org-cep"
                            maskOptions={cepMask}
                            value={cep}
                            onInput={(e) => setCep(e.currentTarget.value)}
                            disabled={isUpdatingIso}
                            placeholder="00000-000"
                          />
                        </Field>
                      </div>

                      <Separator />

                      {/* Contact */}
                      <div className="grid gap-4 sm:grid-cols-3">
                        <Field>
                          <FieldLabel htmlFor="org-phone">Telefone</FieldLabel>
                          <MaskedInput
                            id="org-phone"
                            type="tel"
                            inputMode="tel"
                            maskOptions={brazilPhoneMask}
                            value={phone}
                            onInput={(e) => setPhone(e.currentTarget.value)}
                            disabled={isUpdatingIso}
                            placeholder="(11) 99999-9999"
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="org-email">Email</FieldLabel>
                          <Input
                            id="org-email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={isUpdatingIso}
                            placeholder="contato@lab.com.br"
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="org-website">Website</FieldLabel>
                          <Input
                            id="org-website"
                            value={website}
                            onChange={(e) => setWebsite(e.target.value)}
                            disabled={isUpdatingIso}
                            placeholder="https://lab.com.br"
                          />
                        </Field>
                      </div>

                      <Separator />

                      {/* Technical Manager */}
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field>
                          <FieldLabel htmlFor="org-technical-manager-name">
                            Responsável Técnico
                          </FieldLabel>
                          <Input
                            id="org-technical-manager-name"
                            value={technicalManagerName}
                            onChange={(e) =>
                              setTechnicalManagerName(e.target.value)
                            }
                            disabled={isUpdatingIso}
                            placeholder="Dr. João Silva"
                          />
                          <FieldDescription>
                            Nome que aparecerá nos certificados de calibração.
                          </FieldDescription>
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="org-technical-manager-title">
                            Cargo/Título
                          </FieldLabel>
                          <Input
                            id="org-technical-manager-title"
                            value={technicalManagerTitle}
                            onChange={(e) =>
                              setTechnicalManagerTitle(e.target.value)
                            }
                            disabled={isUpdatingIso}
                            placeholder="Responsável Técnico"
                          />
                        </Field>
                      </div>

                      <div className="flex justify-end">
                        <Button type="submit" disabled={isUpdatingIso}>
                          {isUpdatingIso ? 'Salvando...' : 'Salvar informações'}
                        </Button>
                      </div>
                    </FieldGroup>
                  </form>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {section === 'units' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Unidades</CardTitle>
              <CardDescription>
                Estruture a operação do laboratório por unidade operacional.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!hasMultiUnit ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  A operação multi-unidade fica disponível no plano Enterprise.
                </div>
              ) : !canManageOrganizationUnits ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  Você pode consultar as unidades e gerenciar atribuições dentro
                  do seu escopo, mas a criação, edição estrutural e arquivamento
                  de unidades ficam disponíveis apenas para administradores
                  globais.
                </div>
              ) : null}

              {hasMultiUnit && unitsQuery.isPending ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : (
                <div className="space-y-3">
                  {(unitsQuery.data?.data ?? []).map((unit) => (
                    <div key={unit.id} className="rounded-lg border p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-2">
                          {editingUnitId === unit.id ? (
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                              <Input
                                value={unitNameDrafts[unit.id] ?? unit.name}
                                onChange={(event) =>
                                  setUnitNameDraftOverrides((current) => ({
                                    ...current,
                                    [unit.id]: event.target.value,
                                  }))
                                }
                                disabled={updatingUnitId === unit.id}
                                className="sm:w-72"
                              />
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={updatingUnitId === unit.id}
                                  onClick={() => handleRenameUnit(unit)}
                                >
                                  Salvar
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  disabled={updatingUnitId === unit.id}
                                  onClick={() => {
                                    setEditingUnitId(null)
                                    setUnitNameDraftOverrides((current) => ({
                                      ...current,
                                      [unit.id]: unit.name,
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
                                {unit.slug}
                              </p>
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
                                  setUnitNameDraftOverrides((current) => ({
                                    ...current,
                                    [unit.id]: current[unit.id] ?? unit.name,
                                  }))
                                }}
                              >
                                Renomear
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
                                  {unit.status === 'ACTIVE'
                                    ? 'Arquivar'
                                    : 'Reativar'}
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

              {hasMultiUnit ? <Separator /> : null}

              {hasMultiUnit && canManageOrganizationUnits ? (
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
                    disabled={
                      createUnitMutation.isPending || !newUnitName.trim()
                    }
                  >
                    {createUnitMutation.isPending
                      ? 'Criando...'
                      : 'Criar unidade'}
                  </Button>
                </form>
              ) : null}
            </CardContent>
          </Card>

          {canViewGovernance && (
            <Card>
              <CardHeader>
                <CardTitle>Governança por Unidade</CardTitle>
                <CardDescription>
                  Controle quem atua em cada unidade e qual papel operacional
                  cada membro assume no seu escopo.
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
                                Papel global:{' '}
                                {getOrganizationRoleLabel(member.role)}
                              </Badge>
                              {isGlobalManagerMember ? (
                                <Badge>Papel global com acesso total</Badge>
                              ) : null}
                            </div>
                          </div>

                          {isGlobalManagerMember ? (
                            <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                              Este membro tem acesso global à organização. As
                              atribuições por unidade não restringem
                              owner/admin.
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
                                        assignmentDraftOverrides[member.id]?.[
                                          unit.id
                                        ] ??
                                        baseAssignmentDrafts[member.id]?.[
                                          unit.id
                                        ] ??
                                        'none'
                                      }
                                      onValueChange={(value) => {
                                        if (
                                          typeof value !== 'string' ||
                                          !isEditableUnitAssignmentRole(value)
                                        ) {
                                          return
                                        }
                                        updateAssignmentDraft(
                                          member.id,
                                          unit.id,
                                          value,
                                        )
                                      }}
                                      disabled={
                                        !canManageAssignments ||
                                        savingAssignmentsFor === member.id
                                      }
                                    >
                                      <SelectTrigger className="w-full md:w-52">
                                        <SelectValue>
                                          {getUnitAssignmentRoleLabel(
                                            assignmentDraftOverrides[
                                              member.id
                                            ]?.[unit.id] ??
                                              baseAssignmentDrafts[member.id]?.[
                                                unit.id
                                              ] ??
                                              'none',
                                          )}
                                        </SelectValue>
                                      </SelectTrigger>
                                      <SelectContent>
                                        {EDITABLE_UNIT_ASSIGNMENT_ROLES.map(
                                          (role) => (
                                            <SelectItem key={role} value={role}>
                                              {getUnitAssignmentRoleLabel(role)}
                                            </SelectItem>
                                          ),
                                        )}
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
                                            `${assignment.unitName} (${getUnitAssignmentRoleLabel(
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
                                    !hasAssignmentChanges(
                                      member,
                                      getDraftAssignmentsForMember(member.id),
                                    ) ||
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

          {canViewGovernance && (
            <Card>
              <CardHeader>
                <CardTitle>Atividade de Governança</CardTitle>
                <CardDescription>
                  Histórico recente de mudanças sensíveis em unidades, papéis e
                  atribuições dentro do seu escopo.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {governanceActivityQuery.isPending ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((item) => (
                      <Skeleton key={item} className="h-16 w-full" />
                    ))}
                  </div>
                ) : governanceActivityQuery.data?.data.length ? (
                  <div className="space-y-3">
                    {governanceActivityQuery.data.data.map((event) => (
                      <div
                        key={event.id}
                        className="rounded-lg border p-4 transition-colors hover:bg-muted/30"
                      >
                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="secondary">
                                {getGovernanceActivityLabel(event)}
                              </Badge>
                              {event.unit ? (
                                <Badge variant="outline">
                                  {event.unit.name}
                                </Badge>
                              ) : (
                                <Badge variant="outline">Escopo global</Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {getGovernanceActivityDescription(event)}
                            </p>
                          </div>
                          <div className="text-sm text-muted-foreground md:text-right">
                            <p>
                              {formatGovernanceActivityTime(event.createdAt)}
                            </p>
                            <p>
                              {event.actorUser?.name ?? 'Sistema'}
                              {event.actorUser?.email
                                ? ` · ${event.actorUser.email}`
                                : ''}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Ainda não há atividade recente de governança no seu escopo.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {section === 'members' && (
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
                              <HugeiconsIcon
                                icon={UserIcon}
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
                            {member.role === 'owner' ? (
                              <Badge variant="secondary">
                                {getOrganizationRoleLabel(member.role)}
                              </Badge>
                            ) : (
                              <Select
                                value={member.role}
                                onValueChange={(value) =>
                                  value &&
                                  handleUpdateMemberRole(member.id, value)
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
                                    <SelectItem
                                      key={role.value}
                                      value={role.value}
                                    >
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
                                {availableRoles.find(
                                  (r) => r.value === inviteRole,
                                )?.label || 'Membro'}
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
                                <p className="font-medium">
                                  {invitation.email}
                                </p>
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
                                  disabled={
                                    cancellingInvitation === invitation.id
                                  }
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
                    {memberToRemove?.user.email}) da organização. Esta ação pode
                    ser desfeita convidando o membro novamente.
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
      )}

      {/* Danger Zone — shown within the Organização tab */}
      {section === 'profile' && canManageOrganizationSettings && (
        <Card className="border-destructive/50">
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
                    Esta ação é irreversível. Todos os dados da organização
                    serão excluídos permanentemente, incluindo membros,
                    calibrações e certificados.
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
                    disabled={
                      isDeleting || deleteConfirmName !== activeOrg.name
                    }
                    variant="destructive"
                  >
                    {isDeleting ? 'Excluindo...' : 'Excluir permanentemente'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
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
