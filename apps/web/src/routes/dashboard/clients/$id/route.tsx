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

import { calibraApi } from '@/utils/api'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-mobile'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export const Route = createFileRoute('/dashboard/clients/$id')({
  component: ClientDetailLayout,
})

const tabs = [
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
    value: 'assets',
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
      return calibraApi.customers.get(id)
    },
  })

  const activeTab =
    tabs.find((t) => location.pathname.startsWith(t.href(id)))?.value ?? 'info'

  return (
    <div className="space-y-7">
      <section className="space-y-5">
        <div className="px-1">
          <div className="flex items-start gap-4">
            <Button
              variant="ghost"
              size="icon"
              render={<Link to="/dashboard/clients" />}
              className="mt-0.5 active:scale-[0.96] transition-[background-color,color,box-shadow,border-color,transform]"
              aria-label="Voltar para Clientes"
            >
              <HugeiconsIcon
                icon={ArrowLeft02Icon}
                className="size-5"
                aria-hidden="true"
              />
            </Button>

            <div className="min-w-0 flex-1">
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-7 w-48" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ) : customer ? (
                <>
                  <h1 className="truncate text-2xl font-semibold tracking-tight text-balance">
                    {customer.name}
                  </h1>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    {customer.taxId && (
                      <span className="tabular-nums">{customer.taxId}</span>
                    )}
                    {customer.compliance?.qualificationStatus && (
                      <Badge
                        variant={
                          customer.compliance.qualificationStatus ===
                          'qualified'
                            ? 'default'
                            : customer.compliance.qualificationStatus ===
                                'pending'
                              ? 'secondary'
                              : 'destructive'
                        }
                      >
                        {customer.compliance.qualificationStatus === 'qualified'
                          ? 'Qualificado'
                          : customer.compliance.qualificationStatus ===
                              'pending'
                            ? 'Pendente'
                            : customer.compliance.qualificationStatus ===
                                'suspended'
                              ? 'Suspenso'
                              : 'Expirado'}
                      </Badge>
                    )}
                  </div>
                </>
              ) : (
                <h1 className="text-2xl font-semibold text-destructive">
                  Cliente não encontrado
                </h1>
              )}
            </div>
          </div>
        </div>

        <div className="px-1">
          {isMobile ? (
            <NativeSelect
              value={activeTab}
              onChange={(e) => {
                const tab = tabs.find((t) => t.value === e.target.value)
                if (tab) navigate({ to: tab.href(id) })
              }}
              aria-label="Seção do cliente"
            >
              {tabs.map((tab) => (
                <NativeSelectOption key={tab.value} value={tab.value}>
                  {tab.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : (
            <Tabs
              value={activeTab}
              onValueChange={(value) => {
                const tab = tabs.find((t) => t.value === value)
                if (tab) navigate({ to: tab.href(id) })
              }}
            >
              <TabsList
                variant="default"
                className="h-10 max-w-full overflow-x-auto rounded-xl bg-muted/60 p-1 shadow-inner shadow-foreground/5 ring-1 ring-foreground/10"
              >
                {tabs.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="rounded-lg px-3 text-muted-foreground hover:text-foreground data-active:bg-background data-active:text-foreground data-active:shadow-sm active:scale-[0.96]"
                  >
                    <HugeiconsIcon
                      icon={tab.icon}
                      aria-hidden="true"
                      className="size-4"
                    />
                    <span>{tab.label}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
        </div>
      </section>

      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
