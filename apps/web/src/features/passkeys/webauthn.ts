// Shared WebAuthn capability check used by the settings page and the dashboard
// nudge banner. Mirrors the guard in features/auth/claim-account-page.tsx.
export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'PublicKeyCredential' in window
  )
}
