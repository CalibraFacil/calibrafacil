import { createFileRoute, redirect } from '@tanstack/react-router'

// The tickets kanban now lives as the board view of the Support inbox.
export const Route = createFileRoute('/backoffice/customer-success/tickets')({
  beforeLoad: () => {
    throw redirect({
      to: '/backoffice/support',
      search: { filter: 'all', view: 'board' },
    })
  },
})
