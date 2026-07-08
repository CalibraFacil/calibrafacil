import {
  getStoredConsent,
  setStoredConsent,
  type ConsentChoice,
} from './consent-storage'

type ConsentGrants = Pick<ConsentChoice, 'analytics' | 'ads'>

// Translate our two consent toggles into a Consent Mode v2 update. Everything
// defaults to "denied" in the index.html stub; this only ever *grants* what the
// visitor accepted.
function updateGtagConsent({ analytics, ads }: ConsentGrants) {
  window.gtag?.('consent', 'update', {
    analytics_storage: analytics ? 'granted' : 'denied',
    ad_storage: ads ? 'granted' : 'denied',
    ad_user_data: ads ? 'granted' : 'denied',
    ad_personalization: ads ? 'granted' : 'denied',
  })
}

// Re-apply a previously stored choice on load, before any tag fires. No-op for
// first-time visitors (defaults stay denied until they choose).
export function applyStoredConsent() {
  const stored = getStoredConsent()
  if (!stored) return

  updateGtagConsent(stored)
}

function persistAndApply(grants: ConsentGrants) {
  const record: ConsentChoice = { ...grants, at: new Date().toISOString() }
  setStoredConsent(record)
  updateGtagConsent(record)
  window.dataLayer?.push({
    event: 'consent_update',
    consent_analytics: grants.analytics,
    consent_ads: grants.ads,
  })
}

export function grantConsent() {
  persistAndApply({ analytics: true, ads: true })
}

export function denyConsent() {
  persistAndApply({ analytics: false, ads: false })
}

export { hasStoredConsent } from './consent-storage'
