import {
  Outlet,
  useLocation,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { motion } from 'motion/react'
import {
  Certificate01Icon,
  CheckmarkBadge01Icon,
  DashboardSquare01Icon,
  InformationCircleIcon,
  ToolsIcon,
  UserMultipleIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { useCustomerDetailData } from '@/features/customers/queries'
import type { CustomerCompliance } from '@/features/customers/types'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { useIsMobile } from '@/hooks/use-mobile'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const tabs = [
  {
    value: 'overview',
    label: 'Visão geral',
    href: (id: string) => `/dashboard/clients/${id}/overview`,
    icon: DashboardSquare01Icon,
  },
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

type QualificationStatus = NonNullable<
  CustomerCompliance['qualificationStatus']
>

const QUALIFICATION: Record<
  QualificationStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' }
> = {
  qualified: { label: 'Qualificado', variant: 'default' },
  pending: { label: 'Pendente', variant: 'secondary' },
  suspended: { label: 'Suspenso', variant: 'destructive' },
  expired: { label: 'Expirado', variant: 'destructive' },
}

type ClientDetailLayoutProps = {
  id: string
}

export function ClientDetailLayout({ id }: ClientDetailLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const router = useRouter()
  const isMobile = useIsMobile()

  const { data: customer, isLoading } = useCustomerDetailData(id)

  const activeTab =
    tabs.find((t) => location.pathname.startsWith(t.href(id)))?.value ??
    'overview'

  const qualification = customer?.compliance?.qualificationStatus
    ? QUALIFICATION[customer.compliance.qualificationStatus]
    : null

  return (
    <div className="space-y-6">
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-7 w-56" />
        </div>
      ) : customer ? (
        <div className="min-w-0 space-y-1.5">
          {customer.taxId ? (
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] tabular-nums text-muted-foreground">
              {customer.taxId}
            </p>
          ) : (
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Cliente
            </p>
          )}
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
            <h1 className="text-balance text-2xl font-semibold tracking-tight">
              {customer.name}
            </h1>
            {qualification && (
              <Badge variant={qualification.variant}>
                {qualification.label}
              </Badge>
            )}
          </div>
        </div>
      ) : (
        <h1 className="text-2xl font-semibold tracking-tight text-destructive">
          Cliente não encontrado
        </h1>
      )}

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
                onMouseEnter={() => {
                  void router.preloadRoute({ to: tab.href(id) }).catch(() => {})
                }}
                onFocus={() => {
                  void router.preloadRoute({ to: tab.href(id) }).catch(() => {})
                }}
                className="rounded-lg px-3 text-muted-foreground transition-[background-color,color,box-shadow,transform] hover:text-foreground data-active:bg-background data-active:text-foreground data-active:shadow-sm active:scale-[0.97]"
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

      <motion.div
        key={activeTab}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="min-w-0"
      >
        <Outlet />
      </motion.div>
    </div>
  )
}
