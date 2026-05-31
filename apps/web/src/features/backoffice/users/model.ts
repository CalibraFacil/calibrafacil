import type {
  AssignablePlatformRole,
  BackofficeUser,
  BackofficeUserFilters,
} from '@/features/backoffice/types'

/** Primary segmentation: the internal team vs lab (tenant) users vs everyone. */
export type UsersView = 'team' | 'lab' | 'all'

export const USERS_VIEWS: ReadonlyArray<{ value: UsersView; label: string }> = [
  { value: 'team', label: 'Equipe interna' },
  { value: 'lab', label: 'Usuários de laboratório' },
  { value: 'all', label: 'Todos' },
]

export const USER_VIEW_FILTERS: Record<
  UsersView,
  Pick<BackofficeUserFilters, 'platformRole' | 'membershipScope'>
> = {
  team: { platformRole: 'platform_access', membershipScope: 'all' },
  lab: { platformRole: 'all', membershipScope: 'lab_members' },
  all: { platformRole: 'all', membershipScope: 'all' },
}

export type NewPlatformUserDraft = {
  name: string
  email: string
  role: Extract<AssignablePlatformRole, 'platform_operator' | 'platform_admin'>
}

export function getAssignablePlatformRole(
  role: BackofficeUser['role'],
): AssignablePlatformRole {
  return role === 'platform_admin' || role === 'platform_operator'
    ? role
    : 'user'
}

export function getPlatformRoleLabel(role: BackofficeUser['role']): string {
  switch (getAssignablePlatformRole(role)) {
    case 'platform_admin':
      return 'Admin'
    case 'platform_operator':
      return 'Operador'
    default:
      return 'Sem backoffice'
  }
}

export function getPlatformRoleHint(user: BackofficeUser): string {
  const role = getAssignablePlatformRole(user.role)
  if (role === 'user') {
    return user.memberships.length > 0
      ? 'Opera apenas no LAB'
      : 'Conta sem acesso interno'
  }
  return user.memberships.length > 0
    ? 'Plataforma + LAB'
    : 'Exclusivamente interna'
}

export function getMembershipSummary(user: BackofficeUser): string {
  if (user.memberships.length === 0) return 'Sem vínculo LAB'
  if (user.memberships.length === 1) {
    return user.memberships[0]?.organizationName ?? '1 laboratório'
  }
  return `${user.memberships[0]?.organizationName ?? '1 laboratório'} +${user.memberships.length - 1}`
}

export function toNewPlatformUserRole(value: string): NewPlatformUserDraft['role'] {
  return value === 'platform_admin' ? 'platform_admin' : 'platform_operator'
}

export function toAssignablePlatformRole(value: string): AssignablePlatformRole {
  switch (value) {
    case 'platform_admin':
    case 'platform_operator':
    case 'user':
      return value
    default:
      return 'user'
  }
}

export function formatCreatedAt(value: BackofficeUser['createdAt']): string {
  if (!value) return 'Data indisponível'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 'Data indisponível'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(date)
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value))
}

export function getSessionRole(sessionUser: unknown): string | null {
  const role = toRecord(sessionUser).role
  return typeof role === 'string' ? role : null
}

/** Up to two initials for the avatar fallback. */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase()
}
