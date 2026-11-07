/** Query keys of the dashboard feature. See `assets/keys.ts`. */
export const dashboardKeys = {
  all: ['dashboard'] as const,
  stats: (organizationId: string) =>
    ['dashboard', 'stats', organizationId] as const,
}
