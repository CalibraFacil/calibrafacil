import { createFileRoute } from '@tanstack/react-router'

import { BackofficeOrganizationsPage } from '@/features/backoffice/organizations-page'
import { loadBackofficeOrganizationsData } from '@/features/backoffice/queries'

export const Route = createFileRoute('/backoffice/organizations/')({
  loader: ({ context }) => loadBackofficeOrganizationsData(context.queryClient),
  component: BackofficeOrganizationsPage,
})
