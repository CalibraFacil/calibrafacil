import { differenceInCalendarDays, formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Calendar03Icon,
  Certificate01Icon,
  InboxIcon,
  PulseIcon,
} from '@hugeicons/core-free-icons'

import { Skeleton } from '@/components/ui/skeleton'
import { SignalTile, type SignalTone } from '@/components/instrument-panel'
import { SectionPanel, StatusChip } from '@/features/backoffice/console'
import { useBackofficeOrganizationActivityData } from '@/features/backoffice/queries'
import type { BackofficeActivitySection } from '@/features/backoffice/types'

/** Calendar days since an ISO timestamp, or null when never. */
function daysSince(value: string | null): number | null {
  if (!value) return null
  return differenceInCalendarDays(new Date(), new Date(value))
}

function lastSeenLabel(value: string | null): string {
  if (!value) return 'nunca'
  return formatDistanceToNow(new Date(value), { addSuffix: true, locale: ptBR })
}

/** active < 7d · em risco 7–30d · dormente > 30d / nunca. */
function activityTone(value: string | null): SignalTone {
  const days = daysSince(value)
  if (days === null) return 'critical'
  if (days <= 7) return 'ok'
  if (days <= 30) return 'warning'
  return 'critical'
}

function sectionTone(section: BackofficeActivitySection): SignalTone {
  if (section.last30d > 0) return 'ok'
  if (section.total > 0) return 'warning'
  return 'neutral'
}

/**
 * Derived product-usage evidence for an account (gap #1 core). Answers "is this
 * lab actually producing work?" from live domain data — jobs, certificate
 * releases and portal requests — instead of operator opinion.
 */
export function AccountActivityCard({
  organizationId,
}: {
  organizationId: string
}) {
  const query = useBackofficeOrganizationActivityData(organizationId)
  const activity = query.data

  const headerTone = activity
    ? activityTone(activity.lastActiveAt)
    : 'neutral'
  const headerLabel = activity
    ? activity.lastActiveAt
      ? `Ativa ${lastSeenLabel(activity.lastActiveAt)}`
      : 'Sem atividade'
    : null

  return (
    <SectionPanel
      eyebrow="Evidência"
      title="Atividade do produto"
      description="Sinais reais de uso nos últimos 30 dias — não opinião."
      action={
        headerLabel ? (
          <StatusChip tone={headerTone} icon={PulseIcon}>
            {headerLabel}
          </StatusChip>
        ) : null
      }
    >
      {query.isPending ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-[5.5rem] rounded-xl" />
          ))}
        </div>
      ) : activity ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <SignalTile
            icon={Calendar03Icon}
            label="Calibrações (30d)"
            value={activity.jobs.last30d}
            hint={`${lastSeenLabel(activity.jobs.lastAt)} · ${activity.jobs.total} no total`}
            tone={sectionTone(activity.jobs)}
          />
          <SignalTile
            icon={Certificate01Icon}
            label="Certificados (30d)"
            value={activity.certificates.last30d}
            hint={`${lastSeenLabel(activity.certificates.lastAt)} · ${activity.certificates.total} no total`}
            tone={sectionTone(activity.certificates)}
          />
          <SignalTile
            icon={InboxIcon}
            label="Solicitações (30d)"
            value={activity.requests.last30d}
            hint={`${lastSeenLabel(activity.requests.lastAt)} · ${activity.requests.total} no total`}
            tone={sectionTone(activity.requests)}
          />
        </div>
      ) : null}
    </SectionPanel>
  )
}
