import { parseAsString, useQueryState } from 'nuqs'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CertificateReleasePolicyPage } from '@/features/settings/certificate-release-page'
import { AutomaticSendSettingsPage } from '@/features/settings/automatic-send-page'

const VIEWS = [
  {
    key: 'liberacao',
    label: 'Liberação de certificados',
    Component: CertificateReleasePolicyPage,
  },
  {
    key: 'envio',
    label: 'Envio automático',
    Component: AutomaticSendSettingsPage,
  },
] as const

/**
 * Automação hub — gives the certificate-release policies and automatic-send
 * rules a first-class home inside Finance. Both surfaces already existed under
 * Settings; this makes the automation that drives billing discoverable from the
 * module that owns it, without duplicating their logic.
 *
 * The hub deliberately does NOT wrap the active page in stagger motion: each
 * hosted page has its own StaggerGroup, and nesting motion variants left the
 * inner content stuck at opacity 0 until a tab toggle re-triggered it.
 */
export function FinanceAutomationHubPage() {
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
