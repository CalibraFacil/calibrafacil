import { getGtmId } from '@/app/config/runtime'

let injected = false

// Inject the Google Tag Manager container. GTM loads regardless of consent —
// Consent Mode (denied by default, see index.html) keeps every analytics/ad
// tag from setting cookies until the visitor opts in. No-op when no container
// id is configured (dev) or the document is unavailable. Callers must skip this
// on desktop, where browser tracking is not initialized.
export function loadGtm() {
  if (injected) return

  const id = getGtmId()
  if (!id || typeof document === 'undefined') return

  injected = true

  window.dataLayer = window.dataLayer ?? []
  window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' })

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`
  document.head.appendChild(script)
}
