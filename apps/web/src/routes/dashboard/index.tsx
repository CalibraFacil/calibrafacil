import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Notebook01Icon,
  RefreshIcon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import { useMountEffect } from '@/hooks/use-mount-effect'
import { SectionCards } from './-components/section-cards'
import { ChartCalibrations } from './-components/chart-calibrations'
import { RecentJobsTable } from './-components/recent-jobs-table'

const DASHBOARD_INDEX_MOUNT_MARK = 'dashboard:index:mount'
const DASHBOARD_INDEX_FETCH_START_MARK = 'dashboard:index:fetch:start'
const DASHBOARD_INDEX_FETCH_END_MARK = 'dashboard:index:fetch:end'
const DASHBOARD_INDEX_DATA_READY_MARK = 'dashboard:index:data:ready'
const DASHBOARD_INDEX_FIRST_CONTENT_MARK = 'dashboard:index:first-content'

function mark(name: string) {
  if (typeof window === 'undefined' || !window.performance) return
  window.performance.mark(name)
}

function measure(name: string, startMark: string, endMark: string) {
  if (typeof window === 'undefined' || !window.performance) return

  try {
    window.performance.measure(name, startMark, endMark)
  } catch {
    // no-op: marks may not exist if navigation interrupted
  }
}

export const Route = createFileRoute('/dashboard/')({
  head: () => ({
    meta: [
      {
        title: 'Dashboard | CalibraFácil',
        name: 'description',
        content: 'Painel de Controle - Visão geral do laboratório',
      },
    ],
  }),
  component: DashboardIndex,
})

function DashboardIndex() {
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()

  const { data, isPending, isFetching, refetch, isRefetching } = useQuery({
    queryKey: ['dashboard', 'stats', activeOrganizationId ?? 'no-org'],
    enabled: Boolean(activeOrganizationId) && !isContextSwitching,
    queryFn: async () => {
      mark(DASHBOARD_INDEX_FETCH_START_MARK)
      const res = await api.api.dashboard.stats.$get()
      if (!res.ok) {
        throw new Error('Falha ao carregar estatísticas')
      }
      const payload = await res.json()
      mark(DASHBOARD_INDEX_FETCH_END_MARK)
      measure(
        'dashboard:index:stats-fetch',
        DASHBOARD_INDEX_FETCH_START_MARK,
        DASHBOARD_INDEX_FETCH_END_MARK,
      )
      return payload
    },
    refetchInterval: 60000, // Auto-refresh every minute
    staleTime: 30000,
  })

  const isLoading = !data && (isPending || isFetching)

  return (
    <div className="space-y-6 @container">
      <DashboardIndexMountMarker />
      {!isLoading ? (
        <>
          <DashboardIndexDataReadyMarker />
          <DashboardIndexFirstContentMarker />
        </>
      ) : null}
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Painel de Controle
          </h1>
          <p className="text-muted-foreground">
            Visão geral das operações do laboratório
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              className={cn('size-4', isRefetching && 'animate-spin')}
            />
            <span className="hidden sm:inline">Atualizar</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label="Solicitações"
            render={<Link to="/dashboard/requests" />}
          >
            <HugeiconsIcon
              icon={Notebook01Icon}
              className="size-4"
              aria-hidden="true"
            />
            <span className="sr-only sm:not-sr-only">Solicitações</span>
          </Button>
          <Button size="sm" render={<Link to="/dashboard/jobs/new" />}>
            <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
            <span className="hidden sm:inline">Nova Calibração</span>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <SectionCards
        pendingCalibrations={data?.pendingCalibrations ?? 0}
        approvedThisMonth={data?.approvedThisMonth ?? 0}
        expiringStandards={data?.expiringStandards ?? 0}
        approvalRate={data?.approvalRate ?? 100}
        overdueJobs={data?.overdueJobs ?? 0}
        isLoading={isLoading}
      />

      {/* Chart and Table Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCalibrations
          data={data?.calibrationTrend ?? []}
          isLoading={isLoading}
        />
        <RecentJobsTable jobs={data?.recentJobs ?? []} isLoading={isLoading} />
      </div>
    </div>
  )
}

function DashboardIndexMountMarker() {
  useMountEffect(() => {
    mark(DASHBOARD_INDEX_MOUNT_MARK)
  })

  return null
}

function DashboardIndexDataReadyMarker() {
  useMountEffect(() => {
    mark(DASHBOARD_INDEX_DATA_READY_MARK)
    measure(
      'dashboard:index:data-ready',
      DASHBOARD_INDEX_MOUNT_MARK,
      DASHBOARD_INDEX_DATA_READY_MARK,
    )
  })

  return null
}

function DashboardIndexFirstContentMarker() {
  useMountEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      mark(DASHBOARD_INDEX_FIRST_CONTENT_MARK)
      measure(
        'dashboard:index:first-content',
        DASHBOARD_INDEX_MOUNT_MARK,
        DASHBOARD_INDEX_FIRST_CONTENT_MARK,
      )
    })

    return () => {
      window.cancelAnimationFrame(rafId)
    }
  })

  return null
}
