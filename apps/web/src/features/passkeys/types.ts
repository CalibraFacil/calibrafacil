// Client-facing shape for a user's registered passkey. Mapped from the Better
// Auth passkey client response in queries.ts so the page/banner/tests don't
// depend on the plugin's exact inferred type.
export interface UserPasskey {
  id: string
  name: string | null
  deviceType: string | null
  backedUp: boolean
  createdAt: string | null
  // Authenticator Attestation GUID — identifies the passkey provider (Apple,
  // Google, 1Password, Bitwarden). Often the all-zero GUID for Apple under
  // attestation:"none"; resolved to a label via provider-labels.ts.
  aaguid: string | null
}
