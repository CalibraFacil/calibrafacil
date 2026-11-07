import { roleNameFromUnknown, type RoleName } from '@calibra-facil/auth/access'
import { useActiveOrganization, useSession } from '@calibra-facil/auth/client'

type MembersSource = {
  members?: Array<{ userId?: string | null; role?: string | null }> | null
}

/**
 * The signed-in user's role in an organization. The organization lists every
 * member, so the user's own entry is found by id; without one the role is
 * `member`.
 */
export function currentMemberRole(
  organization: MembersSource | null | undefined,
  userId: string | null | undefined,
): RoleName {
  const member = userId
    ? organization?.members?.find((entry) => entry.userId === userId)
    : undefined
  return roleNameFromUnknown(member?.role)
}

/** The signed-in user's role in the active organization. */
export function useCurrentRole(): RoleName {
  const { data: activeOrg } = useActiveOrganization()
  const { data: session } = useSession()
  return currentMemberRole(activeOrg, session?.user.id)
}
