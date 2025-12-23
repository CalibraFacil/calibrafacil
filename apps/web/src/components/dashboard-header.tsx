import { Link, useMatches } from '@tanstack/react-router'
import { Fragment, useMemo } from 'react'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

const routeLabels: Record<string, string> = {
  '/dashboard': 'Painel de Controle',
  '/dashboard/settings': 'Configurações',
  '/dashboard/analytics': 'Analytics',
  '/dashboard/orders': 'Pedidos',
  '/dashboard/products': 'Produtos',
  '/dashboard/invoices': 'Faturas',
  '/dashboard/customers': 'Clientes',
}

export function DashboardHeader() {
  const matches = useMatches()

  const breadcrumbs = useMemo(() => {
    const dashboardMatches = matches.filter(
      (match) =>
        match.pathname.startsWith('/dashboard') && match.pathname !== '/',
    )

    return dashboardMatches.map((match) => ({
      path: match.pathname,
      label:
        routeLabels[match.pathname] || match.pathname.split('/').pop() || '',
    }))
  }, [matches])

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b px-4">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-8" />
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1

              return (
                <Fragment key={crumb.path}>
                  <BreadcrumbItem>
                    {isLast ? (
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink render={<Link to={crumb.path} />}>
                        {crumb.label}
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {!isLast && <BreadcrumbSeparator />}
                </Fragment>
              )
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    </header>
  )
}
