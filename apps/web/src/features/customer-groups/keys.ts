/** Query keys of the customer-groups feature. See `assets/keys.ts`. */
export const customerGroupKeys = {
  all: ['customer-groups'] as const,
  details: ['customer-group'] as const,
  list: (organizationId: string) =>
    ['customer-groups', organizationId] as const,
  detail: (groupId: string | number) => ['customer-group', groupId] as const,
  members: (groupId: string | number) =>
    ['customer-group-members', groupId] as const,
  invitations: (groupId: string | number) =>
    ['customer-group-invitations', groupId] as const,
}
