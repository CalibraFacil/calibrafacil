/** Query keys of the command palette search. See `assets/keys.ts`. */
export const commandSearchKeys = {
  assets: (query: string) => ['command-search', 'assets', query] as const,
  clients: (query: string) => ['command-search', 'clients', query] as const,
  standards: (query: string) => ['command-search', 'standards', query] as const,
  jobs: (query: string) => ['command-search', 'jobs', query] as const,
}
