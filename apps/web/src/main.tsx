import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { getRouter } from './router'
import { registerPwa } from './runtime/register-pwa'
import { isDesktopRuntime } from './runtime/desktop'
import { applyStoredConsent } from './features/analytics/consent'
import { loadGtm } from './features/analytics/gtm'
import { track } from './features/analytics/track'
import './styles.css'

registerPwa()

const router = getRouter()

// Marketing analytics are cloud-only: never initialize GTM inside the Electron
// desktop shell (mirrors the Sentry/Vercel-Analytics gating).
if (!isDesktopRuntime()) {
  applyStoredConsent()
  loadGtm()
  // SPA navigations don't reload the page, so push an explicit page_view for
  // each resolved route rather than relying on GA4 History-change detection.
  router.subscribe('onResolved', ({ toLocation }) => {
    track('page_view', { page_path: toLocation.pathname })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
