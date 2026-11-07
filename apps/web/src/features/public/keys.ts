/** Query keys of the public (signed-out) pages. See `assets/keys.ts`. */
export const publicKeys = {
  acceptInvitation: (id: string) => ['accept-invitation', id] as const,
}
