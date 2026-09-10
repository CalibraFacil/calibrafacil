import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { PlusSignIcon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Panel, PanelHeader } from '@/components/instrument-panel'
import { useDesktopCloudOnlyUnavailable } from '@/runtime/sync-status'
import { useSpcStandardChartsData } from '@/features/spc/queries'
import { SPC_CHART_TYPE_LABELS } from '@/features/spc/types'
import { SpcStatusBadge } from '@/features/spc/components/spc-status-badge'

/**
 * §7.7.1 tie-in on the standard detail page: this standard's control charts
 * (check-standard monitoring) with a shortcut to open a new chart pre-filled.
 */
export function StandardSpcPanel({ standardId }: { standardId: string }) {
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()
  const numericStandardId = Number(standardId)
  const canLoad =
    !cloudOnlyUnavailable &&
    Number.isInteger(numericStandardId) &&
    numericStandardId > 0

  const { data, isLoading } = useSpcStandardChartsData({
    standardId: numericStandardId,
    enabled: canLoad,
  })

  if (cloudOnlyUnavailable) return null

  const charts = data?.data ?? []

  return (
    <Panel className="p-4 sm:p-5">
      <PanelHeader
        title="CEP — Cartas de controle"
        description="Monitoramento estatístico das leituras de verificação intermediária deste padrão."
        action={
          <Button
            variant="outline"
            size="sm"
            render={
              <Link to="/dashboard/spc" search={{ standardId: standardId }} />
            }
          >
            <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
            Nova carta
          </Button>
        }
      />
      <div className="mt-4">
        {isLoading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Carregando...
          </p>
        ) : charts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
            Nenhuma carta de controle para este padrão ainda.
          </div>
        ) : (
          <div className="space-y-2">
            {charts.map((chart) => (
              <Link
                key={chart.id}
                to="/dashboard/spc/$id"
                params={{ id: String(chart.id) }}
                className="flex min-h-12 items-center justify-between gap-3 rounded-xl px-3 py-2 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.07)] transition-colors hover:bg-muted/60 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {chart.parameter}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {SPC_CHART_TYPE_LABELS[chart.chartType]} ·{' '}
                    {chart.lastEvaluation?.sampleSize ?? 0} leituras
                  </span>
                </span>
                <SpcStatusBadge status={chart.status} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </Panel>
  )
}
