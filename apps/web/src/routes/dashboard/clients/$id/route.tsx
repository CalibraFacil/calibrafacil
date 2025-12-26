import {
  Link,
  Outlet,
  createFileRoute,
  useLocation,
  useNavigate,
  useParams,
} from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft02Icon,
  Certificate01Icon,
  CheckmarkBadge01Icon,
  InformationCircleIcon,
  ToolsIcon,
  UserMultipleIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { api } from '@/utils/api'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

export const Route = createFileRoute('/dashboard/clients/$id')({
  component: ClientDetailLayout,
})

const navItems = [
  {
    value: 'info',
    label: 'Informações',
    href: (id: string) => `/dashboard/clients/${id}/info`,
    icon: InformationCircleIcon,
  },
  {
    value: 'users',
    label: 'Portal',
    href: (id: string) => `/dashboard/clients/${id}/users`,
    icon: UserMultipleIcon,
  },
  {
    value: 'equipment',
    label: 'Ativos',
    href: (id: string) => `/dashboard/clients/${id}/assets`,
    icon: ToolsIcon,
  },
  {
    value: 'calibrations',
    label: 'Calibrações',
    href: (id: string) => `/dashboard/clients/${id}/calibrations`,
    icon: Certificate01Icon,
  },
  {
    value: 'compliance',
    label: 'Conformidade',
    href: (id: string) => `/dashboard/clients/${id}/compliance`,
    icon: CheckmarkBadge01Icon,
  },
]

function ClientDetailLayout() {
  const { id } = useParams({ from: '/dashboard/clients/$id' })
  const location = useLocation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()

  const { data: customer, isLoading } = useQuery({
    queryKey: ['customer', id],
    queryFn: async () => {
      const res = await api.api.customers[':id'].$get({
        param: { id },
      })
      if (!res.ok) {
        throw new Error('Falha ao carregar cliente')
      }
      return res.json()
    },
  })

  // Find current tab from URL
  const currentTab =
    navItems.find((item) => location.pathname.startsWith(item.href(id)))
      ?.value ?? 'info'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button
          variant="ghost"
          size="icon"
          render={<Link to="/dashboard/clients" />}
          className="mt-0.5"
        >
          <HugeiconsIcon icon={ArrowLeft02Icon} className="size-5" />
        </Button>
        <div className="flex-1 min-w-0">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : customer ? (
            <div>
              <h1 className="text-2xl font-semibold tracking-tight truncate">
                {customer.name}
              </h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {customer.taxId && <span>{customer.taxId}</span>}
                {customer.compliance?.qualificationStatus && (
                  <Badge
                    variant={
                      customer.compliance.qualificationStatus === 'qualified'
                        ? 'default'
                        : customer.compliance.qualificationStatus === 'pending'
                          ? 'secondary'
                          : 'destructive'
                    }
                  >
                    {customer.compliance.qualificationStatus === 'qualified'
                      ? 'Qualificado'
                      : customer.compliance.qualificationStatus === 'pending'
                        ? 'Pendente'
                        : customer.compliance.qualificationStatus ===
                            'suspended'
                          ? 'Suspenso'
                          : 'Expirado'}
                  </Badge>
                )}
              </div>
            </div>
          ) : (
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-destructive">
                Cliente nao encontrado
              </h1>
            </div>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      {isMobile ? (
        <NativeSelect
          value={currentTab}
          onChange={(e) => {
            const item = navItems.find((i) => i.value === e.target.value)
            if (item) {
              navigate({ to: item.href(id) })
            }
          }}
          className="w-full"
        >
          {navItems.map((item) => (
            <NativeSelectOption key={item.value} value={item.value}>
              {item.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ) : (
        <nav className="border-b" aria-label="Tabs">
          <ul className="-mb-px flex gap-1">
            {navItems.map((item) => {
              const isActive = location.pathname.startsWith(item.href(id))
              return (
                <li key={item.value}>
                  <Link
                    to={item.href(id)}
                    className={cn(
                      'inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                      isActive
                        ? 'border-foreground text-foreground'
                        : 'border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground',
                    )}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <HugeiconsIcon icon={item.icon} className="size-4" />
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      )}

      {/* Tab Content */}
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
