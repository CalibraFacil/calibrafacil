import { Link } from '@tanstack/react-router'
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  CreditCardIcon,
  Invoice02Icon,
  SentIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { formatFinanceMoney } from '@/lib/finance-formatters'
import { SignalTile, type SignalTone } from '@/components/instrument-panel'
import { cn } from '@/lib/utils'
import type { FinanceOverviewResponse } from '@/features/finance/types'
import type { ReceivablesSearch } from '@/features/finance/receivables/receivables-search'

const TILE_LINK_CLASS =
  'group block rounded-xl transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

/**
 * Tiles are launchpads: each navigates into the Recebíveis workspace with the
 * matching filter already applied (e.g. "Vencido" → overdue installments), so
 * the operator lands on exactly the queue that resolves the number.
 */
function ReceivablesTile({
  search,
  children,
}: {
  search: ReceivablesSearch
  children: React.ReactNode
}) {
  return (
    <Link
      to="/dashboard/finance/receivables"
      search={search}
      className={TILE_LINK_CLASS}
    >
      {children}
    </Link>
  )
}

export function ConsoleVitals({ data }: { data?: FinanceOverviewResponse }) {
  const totals = data?.totals
  const overdueTone: SignalTone =
    (totals?.overdueCents ?? 0) > 0 ? 'critical' : 'neutral'
  const counts = data?.counts
  const pendingExports = data?.pendingExports ?? 0

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ReceivablesTile search={{ tab: 'documentos', status: 'ISSUED' }}>
          <SignalTile
            icon={Invoice02Icon}
            tone="info"
            label="Emitido"
            value={formatFinanceMoney(totals?.issuedCents ?? 0)}
            hint="no ciclo"
          />
        </ReceivablesTile>
        <ReceivablesTile search={{ tab: 'recebimentos', parcela: 'OPEN' }}>
          <SignalTile
            icon={CreditCardIcon}
            tone="neutral"
            label="Em aberto"
            value={formatFinanceMoney(totals?.openCents ?? 0)}
            hint="a receber"
          />
        </ReceivablesTile>
        <ReceivablesTile search={{ tab: 'recebimentos', parcela: 'OVERDUE' }}>
          <SignalTile
            icon={AlertCircleIcon}
            tone={overdueTone}
            label="Vencido"
            value={formatFinanceMoney(totals?.overdueCents ?? 0)}
            hint="em atraso"
          />
        </ReceivablesTile>
        <ReceivablesTile search={{ tab: 'recebimentos', parcela: 'PAID' }}>
          <SignalTile
            icon={CheckmarkCircle02Icon}
            tone="ok"
            label="Recebido"
            value={formatFinanceMoney(totals?.receivedCents ?? 0)}
            hint="baixas"
          />
        </ReceivablesTile>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ReceivablesTile search={{ tab: 'documentos', status: 'DRAFT' }}>
          <PipelineCount
            label="Rascunhos"
            value={counts?.draftDocuments ?? 0}
          />
        </ReceivablesTile>
        <ReceivablesTile search={{ tab: 'documentos', status: 'ISSUED' }}>
          <PipelineCount
            label="Emitidos"
            value={counts?.issuedDocuments ?? 0}
          />
        </ReceivablesTile>
        <ReceivablesTile search={{ tab: 'documentos', status: 'OVERDUE' }}>
          <PipelineCount
            label="Vencidos"
            value={counts?.overdueDocuments ?? 0}
            tone={(counts?.overdueDocuments ?? 0) > 0 ? 'critical' : 'neutral'}
          />
        </ReceivablesTile>
        <Link to="/dashboard/finance/erp" className={TILE_LINK_CLASS}>
          <PipelineCount
            label="Pendentes de exportação"
            value={pendingExports}
            tone={pendingExports > 0 ? 'warning' : 'neutral'}
            icon={SentIcon}
          />
        </Link>
      </div>
    </div>
  )
}

const COUNT_TONE_CLASS: Record<SignalTone, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  critical: 'text-destructive',
  warning: 'text-amber-700 dark:text-amber-400',
  info: 'text-primary',
  neutral: 'text-foreground',
}

function PipelineCount({
  label,
  value,
  tone = 'neutral',
  icon,
}: {
  label: string
  value: number
  tone?: SignalTone
  icon?: Parameters<typeof HugeiconsIcon>[0]['icon']
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-background p-3.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] transition-colors group-hover:bg-muted/40 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
      <div className="flex items-center gap-2">
        {icon ? (
          <HugeiconsIcon icon={icon} className="size-4 text-muted-foreground" />
        ) : null}
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <span
        className={cn(
          'font-mono text-lg font-semibold tabular-nums',
          COUNT_TONE_CLASS[tone],
        )}
      >
        {value}
      </span>
    </div>
  )
}
