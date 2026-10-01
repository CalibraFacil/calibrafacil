import { createFileRoute } from '@tanstack/react-router'

import { getBackofficeAppUrl } from '@/app/config/runtime'

// The operations backoffice moved to its own app (VITE_BACKOFFICE_APP_URL). This
// legacy in-app path now forwards there cross-origin.
export const Route = createFileRoute('/dashboard/internal')({
  beforeLoad: () => {
    if (typeof window !== 'undefined') {
      window.location.replace(getBackofficeAppUrl())
    }
  },
  component: () => null,
})
