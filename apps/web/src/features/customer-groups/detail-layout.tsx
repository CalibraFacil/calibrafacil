import {
  Outlet,
  useLocation,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { motion } from 'motion/react'
import {
  Building03Icon,
  DashboardSquare01Icon,
  UserMultipleIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { useCustomerGroupDetailData } from '@/features/customer-groups/queries'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { useIsMobile } from '@/hooks/use-mobile'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const tabs = [
  {
    value: 'overview',
    label: 'Visão geral',
    href: (groupId: number) => `/dashboard/clients/groups/${groupId}/overview`,
    icon: DashboardSquare01Icon,
  },
  {
    value: 'unidades',
    label: 'Unidades',
    href: (groupId: number) => `/dashboard/clients/groups/${groupId}/unidades`,
    icon: Building03Icon,
  },
  {
    value: 'gestor',
    label: 'Gestor',
    href: (groupId: number) => `/dashboard/clients/groups/${groupId}/gestor`,
    icon: UserMultipleIcon,
  },
]

type CustomerGroupDetailLayoutProps = {
  groupId: number
}

export function CustomerGroupDetailLayout({
  groupId,
}: CustomerGroupDetailLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const router = useRouter()
  const isMobile = useIsMobile()

  const { data: group, isLoading } = useCustomerGroupDetailData(groupId)

  const activeTab =
    tabs.find((t) => location.pathname.startsWith(t.href(groupId)))?.value ??
    'overview'

  const branchCount = group?.branches.length ?? 0

  return (
    <div className="space-y-6">
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-7 w-56" />
        </div>
      ) : group ? (
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
            <h1 className="text-balance text-2xl font-semibold tracking-tight">
              {group.name}
            </h1>
            <Badge variant="secondary" className="font-mono tabular-nums">
              {branchCount} {branchCount === 1 ? 'unidade' : 'unidades'}
            </Badge>
          </div>
        </div>
      ) : (
        <h1 className="text-2xl font-semibold tracking-tight text-destructive">
          Grupo não encontrado
        </h1>
      )}

      {isMobile ? (
        <NativeSelect
          value={activeTab}
          onChange={(e) => {
            const tab = tabs.find((t) => t.value === e.target.value)
            if (tab) navigate({ to: tab.href(groupId) })
          }}
          aria-label="Seção do grupo"
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
            if (tab) navigate({ to: tab.href(groupId) })
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
                  void router
                    .preloadRoute({ to: tab.href(groupId) })
                    .catch(() => {})
                }}
                onFocus={() => {
                  void router
                    .preloadRoute({ to: tab.href(groupId) })
                    .catch(() => {})
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
