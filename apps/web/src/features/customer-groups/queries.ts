import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import type {
  CreateCustomerGroupInput,
  CustomerGroupDetailData,
  CustomerGroupsListData,
} from '@calibra-facil/client-runtime'

export function customerGroupsListQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: ['customer-groups', organizationId],
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

export function useCustomerGroupDetail(
  activeOrganizationId: string | null,
  groupId: number | null,
) {
  return useQuery({
    queryKey: ['customer-group', activeOrganizationId ?? 'no-org', groupId],
    queryFn: (): Promise<CustomerGroupDetailData> => {
      if (groupId === null) {
        throw new Error('Grupo não selecionado')
      }
      return calibraApi.customerGroups.get(groupId)
    },
    enabled: Boolean(activeOrganizationId) && groupId !== null,
  })
}

export function useCreateCustomerGroupMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCustomerGroupInput) =>
      calibraApi.customerGroups.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customer-groups'] })
    },
  })
}

export function useAssignBranchMutation(groupId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (customerId: number) =>
      calibraApi.customerGroups.addBranch(groupId, customerId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customer-group'] })
      void queryClient.invalidateQueries({ queryKey: ['customer-groups'] })
    },
  })
}

export function useRemoveBranchMutation(groupId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (customerId: number) =>
      calibraApi.customerGroups.removeBranch(groupId, customerId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customer-group'] })
      void queryClient.invalidateQueries({ queryKey: ['customer-groups'] })
    },
  })
}
