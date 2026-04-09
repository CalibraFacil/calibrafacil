import { Link, useLocation } from '@tanstack/react-router'

import { cn } from '@/lib/utils'

const financeNavItems = [
  {
    label: 'Visão geral',
    href: '/dashboard/finance',
  },
  {
    label: 'Documentos',
    href: '/dashboard/finance/documents',
  },
  {
    label: 'Recebimentos',
    href: '/dashboard/finance/receipts',
  },
  {
    label: 'Contratos',
    href: '/dashboard/finance/contracts',
  },
  {
    label: 'ERP',
    href: '/dashboard/finance/erp',
  },
] as const

export function FinanceNav() {
  const location = useLocation()

  return (
    <nav aria-label="Financeiro" className="overflow-x-auto">
      <div className="flex min-w-max gap-2 rounded-xl border bg-card p-2">
        {financeNavItems.map((item) => {
          const isActive =
            item.href === '/dashboard/finance'
              ? location.pathname === item.href
              : location.pathname.startsWith(item.href)

          return (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {item.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
