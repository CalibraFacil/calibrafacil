import { describe, expect, it } from 'vitest'

import {
  apiKeysQueryOptions,
  billingPaymentsQueryOptions,
  billingSubscriptionQueryOptions,
  certificateNumberingProfileQueryOptions,
  environmentalLimitsQueryOptions,
  integrationsQueryOptions,
  mySignatureQueryOptions,
  notificationPreferencesQueryOptions,
  dashboardUnitsQueryOptions,
  organizationGovernanceActivityQueryOptions,
  organizationGovernanceMembersQueryOptions,
  organizationInvitationsQueryOptions,
  organizationMembersQueryOptions,
  organizationUnitsQueryOptions,
  portalDomainQueryOptions,
  signingCertificatesQueryOptions,
  ssoSettingsQueryOptions,
  settingsAssetTypesQueryOptions,
} from './queries'

describe('settings feature queries', () => {
  it('uses stable authentication setting keys', () => {
    expect(apiKeysQueryOptions().queryKey).toEqual(['api-keys'])
    expect(ssoSettingsQueryOptions('org-1').queryKey).toEqual([
      'sso-settings',
      'org-1',
    ])
    expect(ssoSettingsQueryOptions(null).queryKey).toEqual([
      'sso-settings',
      'no-org',
    ])
  })

  it('uses stable certificate setting keys', () => {
    expect(certificateNumberingProfileQueryOptions().queryKey).toEqual([
      'certificate-numbering-profile',
    ])
    expect(signingCertificatesQueryOptions(7).queryKey).toEqual([
      'signing-certificates',
      7,
    ])
    expect(signingCertificatesQueryOptions(null).queryKey).toEqual([
      'signing-certificates',
      'no-unit',
    ])
  })

  it('uses stable operational setting keys', () => {
    expect(mySignatureQueryOptions().queryKey).toEqual(['my-signature'])
    expect(portalDomainQueryOptions().queryKey).toEqual(['portal-domain'])
    expect(environmentalLimitsQueryOptions(12).queryKey).toEqual([
      'environmental-limits',
      12,
    ])
    expect(environmentalLimitsQueryOptions(null).queryKey).toEqual([
      'environmental-limits',
      'no-unit',
    ])
    expect(settingsAssetTypesQueryOptions().queryKey).toEqual(['asset-types'])
    expect(notificationPreferencesQueryOptions().queryKey).toEqual([
      'notification-preferences',
    ])
  })

  it('uses stable billing and integration setting keys', () => {
    expect(billingSubscriptionQueryOptions().queryKey).toEqual([
      'billing',
      'subscription',
    ])
    expect(billingPaymentsQueryOptions().queryKey).toEqual([
      'billing',
      'payments',
    ])
    expect(integrationsQueryOptions().queryKey).toEqual(['integrations'])
  })

  it('uses stable organization governance setting keys', () => {
    expect(organizationUnitsQueryOptions('org-1').queryKey).toEqual([
      'organization-units',
      'org-1',
    ])
    expect(dashboardUnitsQueryOptions('org-1').queryKey).toEqual([
      'dashboard-units',
      'org-1',
    ])
    expect(organizationGovernanceMembersQueryOptions('org-1').queryKey).toEqual(
      ['organization-governance-members', 'org-1'],
    )
    expect(
      organizationGovernanceActivityQueryOptions('org-1').queryKey,
    ).toEqual(['organization-governance-activity', 'org-1'])
    expect(organizationMembersQueryOptions('org-1').queryKey).toEqual([
      'organization-members',
      'org-1',
    ])
    expect(organizationInvitationsQueryOptions('org-1').queryKey).toEqual([
      'organization-invitations',
      'org-1',
    ])
  })
})
