/** The activation query. Its root is kept out of the cache resets below. */
export const localPartitionKeys = {
  root: 'local-partition',
  activation: (
    userId: string | null | undefined,
    organizationId: string | null | undefined,
  ) =>
    [
      'local-partition',
      userId ?? 'no-user',
      organizationId ?? 'no-org',
    ] as const,
}
