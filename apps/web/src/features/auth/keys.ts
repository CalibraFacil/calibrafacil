/** Query keys of the sign-in and claim-account pages. See `assets/keys.ts`. */
export const authKeys = {
  labSetup: (token: string | undefined) => ['lab-setup', token] as const,
  magicLinkPreview: (token: string | undefined) =>
    ['magic-link-preview', token] as const,
}
