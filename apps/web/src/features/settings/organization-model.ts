import { normalizeAccreditationNumber } from '@calibra-facil/shared'

import type {
  EditableUnitAssignmentRole,
  GovernanceActivityEntry,
  GovernanceMember,
  OrganizationMember,
  OrganizationUnit,
  UnitAssignmentRole,
} from '@/features/settings/types'

export const GLOBAL_MEMBER_ROLES = [
  'member',
  'operator',
  'technician',
  'admin',
] as const

export type GlobalMemberRole = (typeof GLOBAL_MEMBER_ROLES)[number]

const GLOBAL_MEMBER_ROLE_SET = new Set<string>(GLOBAL_MEMBER_ROLES)

export const ORGANIZATION_AVAILABLE_ROLES = [
  { value: 'member', label: 'Membro' },
  { value: 'operator', label: 'Operador' },
  { value: 'technician', label: 'Técnico' },
  { value: 'admin', label: 'Administrador' },
] as const satisfies ReadonlyArray<{
  value: GlobalMemberRole
  label: string
}>

export const EDITABLE_UNIT_ASSIGNMENT_ROLES = [
  'none',
  'member',
  'technician',
  'unit_admin',
] as const satisfies ReadonlyArray<EditableUnitAssignmentRole>

const EDITABLE_UNIT_ASSIGNMENT_ROLE_SET = new Set<string>(
  EDITABLE_UNIT_ASSIGNMENT_ROLES,
)

export type AssignmentDrafts = Record<
  string,
  Record<number, EditableUnitAssignmentRole>
>

export type DraftUnitAssignment = {
  unitId: number
  role: UnitAssignmentRole
}

export type OrganizationIdentityInput = {
  name?: string | null
  slug?: string | null
}

export type OrganizationIsoInput = {
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
  technicalManagerName?: string | null
  technicalManagerTitle?: string | null
}

export type OrganizationIdentityDraft = {
  name: string
  slug: string
}

export type OrganizationIsoDraft = {
  cnpj: string
  accreditationNumber: string
  accreditationBody: string
  accreditationActive: boolean
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
}

export type OrganizationRoleSource = {
  members?: Array<{ role?: string | null }> | null
}

export function isGlobalMemberRole(value: string): value is GlobalMemberRole {
  return GLOBAL_MEMBER_ROLE_SET.has(value)
}

export function isEditableUnitAssignmentRole(
  value: string,
): value is EditableUnitAssignmentRole {
  return EDITABLE_UNIT_ASSIGNMENT_ROLE_SET.has(value)
}

export function getOrganizationRoleLabel(role: string) {
  const labels: Record<string, string> = {
    owner: 'Proprietário',
    admin: 'Administrador',
    member: 'Membro',
    operator: 'Operador',
    technician: 'Técnico',
    client_user: 'Cliente',
  }
  return labels[role] || role
}

export function getUnitAssignmentRoleLabel(role: EditableUnitAssignmentRole) {
  const labels: Record<EditableUnitAssignmentRole, string> = {
    none: 'Sem acesso',
    member: 'Membro',
    technician: 'Técnico',
    unit_admin: 'Admin. da unidade',
  }
  return labels[role] || role
}

function optionalTrimmed(value: string) {
  const trimmed = value.trim()
  return trimmed || undefined
}

export function getCurrentOrganizationRole(
  organization: OrganizationRoleSource,
) {
  return typeof organization.members?.[0]?.role === 'string'
    ? organization.members[0].role
    : 'member'
}

export function canManageOrganizationSettings(role: string) {
  return role === 'owner' || role === 'admin'
}

export function createOrganizationIdentityDraft(
  organization: OrganizationIdentityInput,
): OrganizationIdentityDraft {
  return {
    name: organization.name ?? '',
    slug: organization.slug ?? '',
  }
}

export function buildOrganizationIdentityPayload(
  draft: OrganizationIdentityDraft,
) {
  return {
    name: draft.name.trim(),
    slug: optionalTrimmed(draft.slug),
  }
}

export function createOrganizationIsoDraft(
  organization: OrganizationIsoInput,
): OrganizationIsoDraft {
  return {
    cnpj: organization.cnpj ?? '',
    // Stored values may predate digits-only normalization ("RBC 0123").
    accreditationNumber: normalizeAccreditationNumber(
      organization.accreditationNumber ?? '',
    ),
    accreditationBody: organization.accreditationBody ?? '',
    accreditationActive: organization.accreditationActive ?? false,
    street: organization.street ?? '',
    number: organization.number ?? '',
    complement: organization.complement ?? '',
    neighbourhood: organization.neighbourhood ?? '',
    city: organization.city ?? '',
    state: organization.state ?? '',
    cep: organization.cep ?? '',
    phone: organization.phone ?? '',
    email: organization.email ?? '',
    website: organization.website ?? '',
    technicalManagerName: organization.technicalManagerName ?? '',
    technicalManagerTitle: organization.technicalManagerTitle ?? '',
  }
}

export function buildOrganizationIsoPayload(draft: OrganizationIsoDraft) {
  return {
    cnpj: optionalTrimmed(draft.cnpj),
    accreditationNumber:
      normalizeAccreditationNumber(draft.accreditationNumber) || undefined,
    accreditationBody: optionalTrimmed(draft.accreditationBody),
    accreditationActive: draft.accreditationActive,
    street: optionalTrimmed(draft.street),
    number: optionalTrimmed(draft.number),
    complement: optionalTrimmed(draft.complement),
    neighbourhood: optionalTrimmed(draft.neighbourhood),
    city: optionalTrimmed(draft.city),
    state: optionalTrimmed(draft.state),
    cep: optionalTrimmed(draft.cep),
    phone: optionalTrimmed(draft.phone),
    email: optionalTrimmed(draft.email),
    website: optionalTrimmed(draft.website),
    technicalManagerName: optionalTrimmed(draft.technicalManagerName),
    technicalManagerTitle: optionalTrimmed(draft.technicalManagerTitle),
  }
}

export function createUnitNameDrafts(units: OrganizationUnit[]) {
  return units.reduce<Record<number, string>>((drafts, unit) => {
    drafts[unit.id] = unit.name
    return drafts
  }, {})
}

export function mergeUnitNameDrafts(
  baseDrafts: Record<number, string>,
  overrides: Record<number, string>,
) {
  return { ...baseDrafts, ...overrides }
}

export function updateAssignmentDraftOverride({
  current,
  memberId,
  unitId,
  role,
}: {
  current: AssignmentDrafts
  memberId: string
  unitId: number
  role: EditableUnitAssignmentRole
}): AssignmentDrafts {
  return {
    ...current,
    [memberId]: {
      ...current[memberId],
      [unitId]: role,
    },
  }
}

export function organizationUnitGovernanceQueryKeys(organizationId: string) {
  return [
    ['organization-units', organizationId],
    ['organization-governance-members', organizationId],
    ['organization-governance-activity', organizationId],
    ['dashboard-units', organizationId],
  ] as const
}

export function organizationAssignmentQueryKeys(organizationId: string) {
  return [
    ['organization-governance-members', organizationId],
    ['organization-governance-activity', organizationId],
    ['dashboard-units', organizationId],
  ] as const
}

export function organizationRoleGovernanceQueryKeys(organizationId: string) {
  return [
    ['organization-members', organizationId],
    ['organization-governance-members', organizationId],
    ['organization-governance-activity', organizationId],
  ] as const
}

export function organizationInvitationsQueryKey(organizationId: string) {
  return ['organization-invitations', organizationId] as const
}

export function organizationMembersQueryKey(organizationId: string) {
  return ['organization-members', organizationId] as const
}

export function getGovernanceActivityLabel(event: GovernanceActivityEntry) {
  const labels: Record<string, string> = {
    'unit.created': 'Unidade criada',
    'unit.updated': 'Perfil de unidade atualizado',
    'unit.archived': 'Unidade arquivada',
    'unit.reactivated': 'Unidade reativada',
    'unit.assignments.updated': 'Atribuições por unidade atualizadas',
    'member.role.updated': 'Papel global atualizado',
  }

  return labels[event.action] || event.action
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null
}

export function getGovernanceActivityDescription(
  event: GovernanceActivityEntry,
) {
  if (event.action === 'unit.assignments.updated') {
    const after = Array.isArray(event.details?.after) ? event.details.after : []
    const scopedUnitIds = Array.isArray(event.details?.scopedUnitIds)
      ? event.details.scopedUnitIds
      : []

    if (after.length === 0) {
      return 'As atribuições operacionais foram removidas neste escopo.'
    }

    return `${after.length} atribuição(ões) ativas em ${scopedUnitIds.length || after.length} unidade(s).`
  }

  if (event.action === 'member.role.updated') {
    const afterDetails = objectRecord(event.details?.after)
    const nextRole =
      typeof afterDetails?.role === 'string' ? afterDetails.role : null

    return nextRole
      ? `Papel global definido como ${getOrganizationRoleLabel(nextRole)}.`
      : 'O papel global do membro foi ajustado.'
  }

  if (event.unit?.name) {
    return `Escopo afetado: ${event.unit.name}.`
  }

  return 'Alteração registrada na governança multiunidade.'
}

const GOVERNANCE_ACTIVITY_TIME_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function formatGovernanceActivityTime(value: string) {
  return GOVERNANCE_ACTIVITY_TIME_FORMAT.format(new Date(value))
}

export function createAssignmentDrafts(
  members: GovernanceMember[],
  units: OrganizationUnit[],
): AssignmentDrafts {
  const drafts: AssignmentDrafts = {}

  for (const member of members) {
    drafts[member.id] = {}
    const rolesByUnitId = new Map(
      member.assignments.map((assignment) => [assignment.unitId, assignment]),
    )
    for (const unit of units) {
      drafts[member.id][unit.id] = rolesByUnitId.get(unit.id)?.role ?? 'none'
    }
  }

  return drafts
}

export function buildDraftAssignmentsForMember({
  memberId,
  units,
  baseDrafts,
  overrides,
}: {
  memberId: string
  units: OrganizationUnit[]
  baseDrafts: AssignmentDrafts
  overrides: AssignmentDrafts
}): DraftUnitAssignment[] {
  const draft = {
    ...baseDrafts[memberId],
    ...overrides[memberId],
  }
  const unitIds = new Set(units.map((unit) => unit.id))
  const assignments: DraftUnitAssignment[] = []

  for (const [unitIdText, role] of Object.entries(draft)) {
    const unitId = Number(unitIdText)
    if (!unitIds.has(unitId) || !role || role === 'none') {
      continue
    }
    assignments.push({ unitId, role })
  }

  return assignments.sort((a, b) => a.unitId - b.unitId)
}

export function getPersistedAssignmentsForMember(
  member: GovernanceMember,
): DraftUnitAssignment[] {
  return [...member.assignments]
    .map((assignment) => ({
      unitId: assignment.unitId,
      role: assignment.role,
    }))
    .sort((a, b) => a.unitId - b.unitId)
}

export function hasAssignmentChanges(
  member: GovernanceMember,
  draftAssignments: DraftUnitAssignment[],
) {
  const draft = JSON.stringify(draftAssignments)
  const persisted = JSON.stringify(getPersistedAssignmentsForMember(member))
  return draft !== persisted
}

export function formatInvitationTimeRemaining(
  expiresAt: Date,
  now = new Date(),
) {
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

export function getInvitationStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: 'Pendente',
    accepted: 'Aceito',
    rejected: 'Rejeitado',
    canceled: 'Cancelado',
  }
  return labels[status] || status
}

export function getInvitationStatusVariant(
  status: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
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

export function getInviterName(
  members: OrganizationMember[],
  inviterId: string,
) {
  const member = members.find((candidate) => candidate.userId === inviterId)
  return member?.user.name
}
