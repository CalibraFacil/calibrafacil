import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'

import type { PortalManageableMemberRole } from '@calibra-facil/auth/access'
import { calibraApi } from '@/utils/api'
import { ensureRouteQueries } from '@/lib/route-data'
import type {
  CreateCustomerGroupInput,
  CustomerGroupDetailData,
  CustomerGroupsListData,
} from '@calibra-facil/client-runtime'
import { customerGroupKeys } from '@/features/customer-groups/keys'
import { customerKeys } from '@/features/customers/keys'

function customerGroupsListQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: customerGroupKeys.list(organizationId),
    queryFn: (): Promise<CustomerGroupsListData> =>
      calibraApi.customerGroups.list(),
  })
}

export function useCustomerGroupsList(
  activeOrganizationId: string | null,
  enabled = true,
) {
  return useQuery({
    ...customerGroupsListQueryOptions(activeOrganizationId ?? 'no-org'),
    enabled: Boolean(activeOrganizationId) && enabled,
  })
}

// Detail keyed on groupId only so route loaders can prefetch without the
// dashboard org in context. Invalidating ['customer-group'] matches any group.
function customerGroupDetailQueryOptions(groupId: number) {
  return queryOptions({
    queryKey: customerGroupKeys.detail(groupId),
    queryFn: (): Promise<CustomerGroupDetailData> =>
      calibraApi.customerGroups.get({ params: { id: groupId } }),
  })
}

export async function loadCustomerGroupDetailData(
  queryClient: QueryClient,
  groupId: number,
) {
  await ensureRouteQueries(queryClient, [
    customerGroupDetailQueryOptions(groupId),
  ])
}

export function useCustomerGroupDetailData(groupId: number) {
  return useQuery(customerGroupDetailQueryOptions(groupId))
}

function customerGroupMembersQueryOptions(groupId: number) {
  return queryOptions({
    queryKey: customerGroupKeys.members(groupId),
    queryFn: () =>
      calibraApi.customerGroups.listMembers({ params: { id: groupId } }),
  })
}

function customerGroupInvitationsQueryOptions(groupId: number) {
  return queryOptions({
    queryKey: customerGroupKeys.invitations(groupId),
    queryFn: () =>
      calibraApi.customerGroups.listInvitations({ params: { id: groupId } }),
  })
}

export async function loadCustomerGroupGestorData(
  queryClient: QueryClient,
  groupId: number,
) {
  await ensureRouteQueries(queryClient, [
    customerGroupDetailQueryOptions(groupId),
    customerGroupMembersQueryOptions(groupId),
    customerGroupInvitationsQueryOptions(groupId),
  ])
}

export function useCustomerGroupMembersData(groupId: number) {
  return useQuery(customerGroupMembersQueryOptions(groupId))
}

export function useCustomerGroupInvitationsData(groupId: number) {
  return useQuery(customerGroupInvitationsQueryOptions(groupId))
}

export function useCreateCustomerGroupMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCustomerGroupInput) =>
      calibraApi.customerGroups.create({ body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customerGroupKeys.all })
    },
  })
}

// Branch assign/remove changes both the group rollups and the customer's own
// "Grupo" field — invalidate both sides so counts and columns refresh.
function invalidateGroupAndCustomerCaches(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: customerGroupKeys.details })
  void queryClient.invalidateQueries({ queryKey: customerGroupKeys.all })
  void queryClient.invalidateQueries({ queryKey: customerKeys.details })
  void queryClient.invalidateQueries({ queryKey: customerKeys.all })
}

export function useAssignBranchMutation(groupId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (customerId: number) =>
      calibraApi.customerGroups.addBranch({
        params: { id: groupId },
        body: { customerId },
      }),
    onSuccess: () => invalidateGroupAndCustomerCaches(queryClient),
  })
}

export function useRemoveBranchMutation(groupId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (customerId: number) =>
      calibraApi.customerGroups.removeBranch({
        params: { id: groupId, customerId },
      }),
    onSuccess: () => invalidateGroupAndCustomerCaches(queryClient),
  })
}

export function useInviteGroupManagerMutation(
  groupId: number,
  role: PortalManageableMemberRole,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (email: string) =>
      calibraApi.customerGroups.createInvitation({
        params: { id: groupId },
        body: { email, role },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: customerGroupKeys.invitations(groupId),
      })
    },
  })
}

export function useResendGroupInvitationMutation(groupId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (invitationId: string) =>
      calibraApi.customerGroups.resendInvitation({
        params: { id: groupId, invId: invitationId },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: customerGroupKeys.invitations(groupId),
      })
    },
  })
}

export function useCancelGroupInvitationMutation(groupId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (invitationId: string) =>
      calibraApi.customerGroups.cancelInvitation({
        params: { id: groupId, invId: invitationId },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: customerGroupKeys.invitations(groupId),
      })
    },
  })
}

export function useRemoveGroupMemberMutation(groupId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (memberId: string) =>
      calibraApi.customerGroups.removeMember({
        params: { id: groupId, memberId },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: customerGroupKeys.members(groupId),
      })
    },
  })
}
