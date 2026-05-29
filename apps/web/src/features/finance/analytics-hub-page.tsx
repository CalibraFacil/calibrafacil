import { parseAsString, useQueryState } from 'nuqs'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CashForecastPage } from '@/features/finance/cash-forecast-page'
import { OperationsToCashPage } from '@/features/finance/operations-to-cash-page'
import { MarginDashboardsPage } from '@/features/finance/margin-dashboards-page'
import { RevenueLeakagePage } from '@/features/finance/revenue-leakage-page'

const VIEWS = [
  {
    key: 'previsao',
    label: 'Previsão de caixa',
    Component: CashForecastPage,
  },
  {
    key: 'operacao',
    label: 'Operação ao caixa',
    Component: OperationsToCashPage,
  },
  {
    key: 'margens',
    label: 'Margens',
    Component: MarginDashboardsPage,
  },
  {
    key: 'alertas',
    label: 'Alertas de receita',
    Component: RevenueLeakagePage,
  },
] as const

/**
 * Análises hub — gives the four operational-finance analyses (cash forecast,
 * operations-to-cash, margins, revenue leakage) a single discoverable home.
 * They were fully built but had no navigation entry. Only the active view's
 * component mounts, so we don't fire four analytics queries at once.
 *
 * No stagger motion here: each hosted page has its own StaggerGroup, and
 * nesting motion variants left the inner content stuck hidden until a tab
 * toggle re-triggered it.
 */
export function FinanceAnalyticsHubPage() {
  const [view, setView] = useQueryState(
    'view',
    parseAsString.withDefault(VIEWS[0].key),
  )
  const active = VIEWS.find((entry) => entry.key === view) ?? VIEWS[0]
  const ActiveComponent = active.Component

  return (
    <div className="space-y-6">
      <Tabs
        value={active.key}
        onValueChange={(value) => {
          if (typeof value === 'string') void setView(value)
        }}
      >
        <TabsList>
          {VIEWS.map((entry) => (
            <TabsTrigger key={entry.key} value={entry.key}>
              {entry.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <ActiveComponent />
    </div>
  )
}
