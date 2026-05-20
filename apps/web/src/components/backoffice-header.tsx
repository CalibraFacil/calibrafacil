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
  '/backoffice': 'Backoffice',
  '/backoffice/': 'Visão Geral',
  '/backoffice/organizations': 'Organizações',
  '/backoffice/organizations/$id': 'Organização',
  '/backoffice/commercial-checkouts': 'Comercial',
  '/backoffice/customer-success': 'Customer Success',
  '/backoffice/support': 'Suporte',
  '/backoffice/users': 'Usuários',
}

function normalizePath(pathname: string) {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1)
  }

  return pathname
}

export function BackofficeHeader() {
  const matches = useMatches()
  const breadcrumbs = useMemo(() => {
    const seen = new Set<string>()

    return matches
      .filter((match) => match.routeId.startsWith('/backoffice'))
      .map((match) => {
        const path = normalizePath(match.pathname)
        const fallbackLabel =
          path.replace('/backoffice', '').trim() || 'Backoffice'
        const label =
          routeLabels[match.routeId] ?? routeLabels[path] ?? fallbackLabel

        return {
          key: `${match.routeId}:${path}`,
          path,
          label,
        }
      })
      .filter((crumb) => {
        const dedupeKey = `${crumb.path}:${crumb.label}`
        if (seen.has(dedupeKey)) {
          return false
        }

        seen.add(dedupeKey)
        return true
      })
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
                <Fragment key={crumb.key}>
                  <BreadcrumbItem>
                    {isLast ? (
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink render={<Link to={crumb.path} />}>
                        {crumb.label}
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {!isLast ? <BreadcrumbSeparator /> : null}
                </Fragment>
              )
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="flex items-center gap-2" />
    </header>
  )
}
