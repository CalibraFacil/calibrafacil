import type { ReactNode } from 'react'
import {
  Link,
  Outlet,
  createFileRoute,
  useLocation,
} from '@tanstack/react-router'

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useCustomerSuccessAccess } from '@/features/backoffice/customer-success/hooks'

export const Route = createFileRoute('/backoffice/customer-success')({
  head: () => ({
    meta: [{ title: 'Backoffice | Customer Success | CalibraFácil' }],
  }),
  component: CustomerSuccessLayout,
})

function CustomerSuccessLayout() {
  const location = useLocation()
  const accessQuery = useCustomerSuccessAccess()

  if (accessQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-[520px] w-full" />
      </div>
    )
  }

  if (accessQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Backoffice</CardTitle>
          <CardDescription>
            {accessQuery.error instanceof Error
              ? accessQuery.error.message
              : 'Acesso ao backoffice negado'}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Backoffice
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Customer Success
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Contas, tickets e SLA separados por fluxo para reduzir varredura e
            manter a operação em foco.
          </p>
        </div>

        <nav className="flex flex-wrap gap-2">
          <SectionLink
            active={location.pathname === '/backoffice/customer-success'}
            to="/backoffice/customer-success"
          >
            Contas
          </SectionLink>
          <SectionLink
            active={location.pathname.startsWith(
              '/backoffice/customer-success/tickets',
            )}
            to="/backoffice/customer-success/tickets"
          >
            Tickets
          </SectionLink>
        </nav>
      </div>

      <Outlet />
    </div>
  )
}

function SectionLink(props: {
  active: boolean
  children: ReactNode
  to: '/backoffice/customer-success' | '/backoffice/customer-success/tickets'
}) {
  return (
    <Link
      className={cn(
        'rounded-full border px-3 py-1.5 text-sm transition-colors',
        props.active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border text-muted-foreground hover:text-foreground',
      )}
      to={props.to}
    >
      {props.children}
    </Link>
  )
}
