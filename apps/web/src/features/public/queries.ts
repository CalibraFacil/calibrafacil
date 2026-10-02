import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { prewarmRouteQueries } from '@/lib/route-data'
import { calibraApi } from '@/utils/api'
import type { InvitationData } from './types'

type PublicInvitationResponse = {
  id: string
  email: string
  role: string
  status: string
  expiresAt: string
  organizationId: string
  organizationName: string
  organizationSlug: string
  inviterEmail: string
}

export function invitationQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['accept-invitation', id],
    queryFn: async (): Promise<InvitationData> => {
      // Use the PUBLIC invitation endpoint, not authClient.organization
      // .getInvitation: the latter requires an authenticated session whose
      // email matches the invite, so a not-yet-signed-up invitee would only
      // ever get "Not authenticated" and never reach the access-setup flow.
      const data =
        await calibraApi.publicInvitations.get<PublicInvitationResponse>(id)

      return {
        id: data.id,
        email: data.email,
        role: data.role,
        status: data.status,
        expiresAt: new Date(data.expiresAt),
        organizationId: data.organizationId,
        organizationName: data.organizationName,
        organizationSlug: data.organizationSlug,
        inviterEmail: data.inviterEmail,
      }
    },
  })
}

export async function prewarmInvitation(queryClient: QueryClient, id: string) {
  await prewarmRouteQueries(queryClient, [invitationQueryOptions(id)])
}

export function useInvitationData(id: string) {
  return useQuery(invitationQueryOptions(id))
}
