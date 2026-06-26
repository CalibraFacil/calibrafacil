// AAGUID → display name for the passkey providers Calibra Fácil officially
// supports. Canonical values come from the community registry
// (passkeydeveloper/passkey-authenticator-aaguids). Apple and Google ship more
// than one AAGUID, so several keys collapse to one brand. Anything unmapped —
// including Apple's all-zero AAGUID under attestation:"none", and any other
// authenticator — falls back to the generic "Passkey" label.
const SUPPORTED_AUTHENTICATORS: Record<string, string> = {
  // Apple iCloud Keychain
  'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'Apple iCloud Keychain',
  'dd4ec289-e01d-41c9-bb89-70fa845d4bf2': 'Apple iCloud Keychain',
  // Google Password Manager
  'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google Password Manager',
  'adce0002-35bc-c60a-648b-0b25f1f05503': 'Google Password Manager',
  // 1Password
  'bada5566-a7aa-401f-bd96-45619a55120d': '1Password',
  // Bitwarden
  'd548826e-79b4-db40-a3d8-11116f7e8349': 'Bitwarden',
}

export const GENERIC_PASSKEY_LABEL = 'Passkey'

export function passkeyProviderLabel(
  aaguid: string | null | undefined,
): string {
  if (!aaguid) return GENERIC_PASSKEY_LABEL
  return SUPPORTED_AUTHENTICATORS[aaguid.toLowerCase()] ?? GENERIC_PASSKEY_LABEL
}
