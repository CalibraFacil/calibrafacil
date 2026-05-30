import { Link, useMatches } from '@tanstack/react-router'
import { Fragment, useMemo } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Search01Icon } from '@hugeicons/core-free-icons'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Kbd } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { useBackofficeCommandPalette } from '@/features/backoffice/command-palette/context'

const routeLabels: Record<string, string> = {
  '/backoffice': 'Backoffice',
  '/backoffice/': 'Comando',
  '/backoffice/accounts': 'Contas',
  '/backoffice/accounts/': 'Contas',
  '/backoffice/accounts/$id': 'Conta',
  '/backoffice/support': 'Suporte',
  '/backoffice/commercial-checkouts': 'Receita',
  '/backoffice/users': 'Equipe',
  '/backoffice/audit': 'Auditoria',
}

function normalizePath(pathname: string) {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1)
  }

  return pathname
}

export function BackofficeHeader() {
  const matches = useMatches()
  const { setOpen } = useBackofficeCommandPalette()
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
      <div className="flex min-w-0 items-center gap-2">
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-2 rounded-lg bg-muted/50 px-3 text-sm text-muted-foreground shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] transition-colors hover:bg-muted hover:text-foreground dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
      >
        <HugeiconsIcon icon={Search01Icon} className="size-4" />
        <span className="hidden sm:inline">Buscar contas, ações…</span>
        <Kbd className="ml-1 hidden sm:inline-flex">⌘K</Kbd>
      </button>
    </header>
  )
}
