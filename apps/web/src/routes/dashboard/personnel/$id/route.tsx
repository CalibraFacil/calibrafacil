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
  InformationCircleIcon,
  Certificate01Icon,
  TimeQuarterPassIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { calibraApi } from '@/utils/api'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-mobile'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type CompetenceStatus, getStatusBadge } from '../-components/columns'

export const Route = createFileRoute('/dashboard/personnel/$id')({
  component: CompetenceDetailLayout,
})

const tabs = [
  {
    value: 'detail',
    label: 'Detalhes',
    href: (id: string) => `/dashboard/personnel/${id}`,
    icon: InformationCircleIcon,
  },
  {
    value: 'training',
    label: 'Treinamentos',
    href: (id: string) => `/dashboard/personnel/${id}/training`,
    icon: Certificate01Icon,
  },
  {
    value: 'audit',
    label: 'Histórico',
    href: (id: string) => `/dashboard/personnel/${id}/audit`,
    icon: TimeQuarterPassIcon,
  },
]

function CompetenceDetailLayout() {
  const { id } = useParams({ from: '/dashboard/personnel/$id' })
  const location = useLocation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()

  const { data: competence, isLoading } = useQuery({
    queryKey: ['competence', id],
    queryFn: async () =>
      calibraApi.competences.get<{
        id: number
        userName: string | null
        assetTypeName: string | null
        scopeDescription: string
        status: CompetenceStatus
      }>(id),
  })

  // Determine active tab: exact match for detail, prefix match for others
  const activeTab =
    tabs.find((t) => {
      if (t.value === 'detail') {
        // Detail matches only exact path (no subpath like /training or /audit)
        return (
          location.pathname === `/dashboard/personnel/${id}` ||
          location.pathname === `/dashboard/personnel/${id}/`
        )
      }
      return location.pathname.startsWith(t.href(id))
    })?.value ?? 'detail'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button
          variant="ghost"
          size="icon"
          render={<Link to="/dashboard/personnel" />}
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
          ) : competence ? (
            <>
              <h1 className="text-2xl font-semibold tracking-tight truncate">
                {competence.userName ?? 'Técnico'}
              </h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{competence.assetTypeName ?? 'Escopo geral'}</span>
                {competence.status &&
                  (() => {
                    const badge = getStatusBadge(competence.status)
                    return (
                      <Badge
                        variant={badge.variant}
                        className={badge.className}
                      >
                        {badge.label}
                      </Badge>
                    )
                  })()}
              </div>
            </>
          ) : (
            <h1 className="text-2xl font-semibold text-destructive">
              Competência não encontrada
            </h1>
          )}
        </div>
      </div>

      {/* Tabs */}
      {isMobile ? (
        <NativeSelect
          value={activeTab}
          onChange={(e) => {
            const tab = tabs.find((t) => t.value === e.target.value)
            if (tab) navigate({ to: tab.href(id) })
          }}
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
          <TabsList variant="line">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                <HugeiconsIcon icon={tab.icon} />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {/* Route content */}
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
