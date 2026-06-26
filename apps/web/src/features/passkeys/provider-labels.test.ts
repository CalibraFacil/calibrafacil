import { describe, expect, it } from 'vitest'

import { GENERIC_PASSKEY_LABEL, passkeyProviderLabel } from './provider-labels'

describe('passkeyProviderLabel', () => {
  it('labels the four supported providers from their canonical AAGUIDs', () => {
    expect(passkeyProviderLabel('fbfc3007-154e-4ecc-8c0b-6e020557d7bd')).toBe(
      'Apple iCloud Keychain',
    )
    expect(passkeyProviderLabel('dd4ec289-e01d-41c9-bb89-70fa845d4bf2')).toBe(
      'Apple iCloud Keychain',
    )
    expect(passkeyProviderLabel('ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4')).toBe(
      'Google Password Manager',
    )
    expect(passkeyProviderLabel('adce0002-35bc-c60a-648b-0b25f1f05503')).toBe(
      'Google Password Manager',
    )
    expect(passkeyProviderLabel('bada5566-a7aa-401f-bd96-45619a55120d')).toBe(
      '1Password',
    )
    expect(passkeyProviderLabel('d548826e-79b4-db40-a3d8-11116f7e8349')).toBe(
      'Bitwarden',
    )
  })

  it('matches AAGUIDs case-insensitively', () => {
    expect(passkeyProviderLabel('BADA5566-A7AA-401F-BD96-45619A55120D')).toBe(
      '1Password',
    )
  })

  it('falls back to the generic label for Apple all-zero AAGUID', () => {
    // Apple reports an all-zero AAGUID under attestation:"none" — not
    // distinguishable, so it must read as a generic passkey, not "Apple".
    expect(passkeyProviderLabel('00000000-0000-0000-0000-000000000000')).toBe(
      GENERIC_PASSKEY_LABEL,
    )
  })

  it('falls back to the generic label for unknown / missing AAGUIDs', () => {
    expect(passkeyProviderLabel('11111111-2222-3333-4444-555555555555')).toBe(
      GENERIC_PASSKEY_LABEL,
    )
    expect(passkeyProviderLabel(null)).toBe(GENERIC_PASSKEY_LABEL)
    expect(passkeyProviderLabel(undefined)).toBe(GENERIC_PASSKEY_LABEL)
    expect(passkeyProviderLabel('')).toBe(GENERIC_PASSKEY_LABEL)
  })
})
