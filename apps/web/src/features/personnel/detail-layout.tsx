import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import {
  InformationCircleIcon,
  Certificate01Icon,
  TimeQuarterPassIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { useCompetenceDetailData } from '@/features/personnel/queries'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { BlueprintOverlay, Panel } from '@/components/instrument-panel'
import { useIsMobile } from '@/hooks/use-mobile'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getStatusBadge } from '@/features/personnel/components/columns'

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

type CompetenceDetailLayoutProps = {
  id: string
}

export function CompetenceDetailLayout({ id }: CompetenceDetailLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()

  const { data: competence, isLoading } = useCompetenceDetailData(id)

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
      <Panel className="relative overflow-hidden p-6">
        <BlueprintOverlay />
        <div className="relative min-w-0">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : competence ? (
            <>
              <div className="mt-0.5 flex flex-wrap items-center gap-3">
                <h1 className="text-balance text-2xl font-semibold tracking-tight">
                  {competence.userName ?? 'Técnico'}
                </h1>
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
              <p className="mt-0.5 text-sm text-muted-foreground">
                {competence.assetTypeName ?? 'Escopo geral'}
              </p>
            </>
          ) : (
            <h1 className="text-2xl font-semibold text-destructive">
              Competência não encontrada
            </h1>
          )}
        </div>
      </Panel>

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
