import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { calibraApi } from '@/utils/api'
import { useOrganizationGovernanceActivityData } from '@/features/settings/queries'
import type {
  GovernanceMember,
  OrganizationUnit,
  UnitAssignmentRole,
} from '@/features/settings/types'
import {
  buildDraftAssignmentsForMember,
  createAssignmentDrafts,
  createUnitNameDrafts,
  EDITABLE_UNIT_ASSIGNMENT_ROLES,
  formatGovernanceActivityTime,
  getGovernanceActivityDescription,
  getGovernanceActivityLabel,
  getOrganizationRoleLabel,
  getUnitAssignmentRoleLabel,
  hasAssignmentChanges,
  isEditableUnitAssignmentRole,
  mergeUnitNameDrafts,
  organizationAssignmentQueryKeys,
  organizationUnitGovernanceQueryKeys,
  updateAssignmentDraftOverride,
  type AssignmentDrafts,
} from '@/features/settings/organization-model'
import type { ActiveOrganization } from '@/features/settings/organization/shared'
import { MembersSkeleton } from '@/features/settings/organization/skeletons'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export function OrganizationUnitsSection({
  activeOrg,
  canManageOrganizationUnits,
  canManageAssignments,
  canViewGovernance,
  units,
  unitsLoading,
  governanceMembers,
  governanceMembersLoading,
}: {
  activeOrg: ActiveOrganization
  canManageOrganizationUnits: boolean
  canManageAssignments: boolean
  canViewGovernance: boolean
  units: OrganizationUnit[]
  unitsLoading: boolean
  governanceMembers: GovernanceMember[]
  governanceMembersLoading: boolean
}) {
  const queryClient = useQueryClient()
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
  const [newUnitName, setNewUnitName] = useState('')

  const governanceActivityQuery = useOrganizationGovernanceActivityData({
    organizationId: activeOrg.id,
    enabled: true,
  })

  const baseUnitNameDrafts = useMemo<Record<number, string>>(
    () => createUnitNameDrafts(units),
    [units],
  )
  const unitNameDrafts = useMemo<Record<number, string>>(
    () => mergeUnitNameDrafts(baseUnitNameDrafts, unitNameDraftOverrides),
    [baseUnitNameDrafts, unitNameDraftOverrides],
  )
  const baseAssignmentDrafts = useMemo<AssignmentDrafts>(
    () => createAssignmentDrafts(governanceMembers, units),
    [governanceMembers, units],
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
      units,
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Unidades</CardTitle>
          <CardDescription>
            Estruture a operação do laboratório por unidade operacional.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canManageOrganizationUnits ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Você pode consultar as unidades e gerenciar atribuições dentro do
              seu escopo, mas a criação, edição estrutural e arquivamento de
              unidades ficam disponíveis apenas para administradores globais.
            </div>
          ) : null}

          {unitsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <div className="space-y-3">
              {units.map((unit) => (
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

          <Separator />

          {canManageOrganizationUnits ? (
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
          ) : null}
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
            {governanceMembersLoading ? (
              <MembersSkeleton />
            ) : governanceMembers.length ? (
              <div className="space-y-4">
                {governanceMembers.map((member) => {
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
                          atribuições por unidade não restringem owner/admin.
                        </div>
                      ) : (
                        <>
                          <div className="space-y-3">
                            {units.map((unit) => (
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
                                        assignmentDraftOverrides[member.id]?.[
                                          unit.id
                                        ] ??
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
                            <Badge variant="outline">{event.unit.name}</Badge>
                          ) : (
                            <Badge variant="outline">Escopo global</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {getGovernanceActivityDescription(event)}
                        </p>
                      </div>
                      <div className="text-sm text-muted-foreground md:text-right">
                        <p>{formatGovernanceActivityTime(event.createdAt)}</p>
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
  )
}
