import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { prewarmRouteQueries } from '@/lib/route-data'
import { calibraApi } from '@/utils/api'
import type {
  InvitationData,
  PublicCheckoutSnapshotData,
  PublicCheckoutStatusData,
} from './types'

type CheckoutStatusPolling = (query: {
  state: {
    data: PublicCheckoutStatusData | { state: 'INVALID' } | undefined
  }
}) => number | false | undefined

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

export function publicCheckoutSnapshotQueryOptions(token: string) {
  return queryOptions({
    queryKey: ['public-commercial-checkout', token, 'snapshot'],
    queryFn: () =>
      calibraApi.publicCheckout.getSnapshot<PublicCheckoutSnapshotData>(token),
  })
}

export function publicCheckoutStatusQueryOptions(token: string) {
  return queryOptions({
    queryKey: ['public-commercial-checkout', token, 'status'],
    queryFn: () =>
      calibraApi.publicCheckout.getStatus<
        PublicCheckoutStatusData | { state: 'INVALID' }
      >(token),
  })
}

export async function prewarmInvitation(queryClient: QueryClient, id: string) {
  await prewarmRouteQueries(queryClient, [invitationQueryOptions(id)])
}

export async function prewarmPublicCheckout(
  queryClient: QueryClient,
  token: string,
) {
  await prewarmRouteQueries(queryClient, [
    publicCheckoutSnapshotQueryOptions(token),
    publicCheckoutStatusQueryOptions(token),
  ])
}

export function useInvitationData(id: string) {
  return useQuery(invitationQueryOptions(id))
}

export function usePublicCheckoutSnapshotData(token: string) {
  return useQuery(publicCheckoutSnapshotQueryOptions(token))
}

export function usePublicCheckoutStatusData({
  enabled,
  refetchInterval,
  token,
}: {
  enabled: boolean
  refetchInterval?: CheckoutStatusPolling
  token: string
}) {
  return useQuery({
    ...publicCheckoutStatusQueryOptions(token),
    enabled,
    refetchInterval,
  })
}
