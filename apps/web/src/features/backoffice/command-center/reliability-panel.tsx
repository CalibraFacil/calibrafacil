import { CheckmarkCircle01Icon } from '@hugeicons/core-free-icons'

import { Skeleton } from '@/components/ui/skeleton'
import { SignalTile, type SignalTone } from '@/components/instrument-panel'
import { SectionPanel, StatusChip } from '@/features/backoffice/console'
import { useBackofficeVitalsData } from '@/features/backoffice/queries'

export function ReliabilityPanel() {
  const query = useBackofficeVitalsData()
  const queue = query.data?.queue
  const degraded = queue ? queue.failed > 0 || queue.stuck > 0 : false

  return (
    <SectionPanel
      eyebrow="Confiabilidade"
      title="Fila de processamento"
      description="Saúde dos jobs de background (certificados, etiquetas, integrações, notificações)."
      action={
        query.isPending ? null : degraded ? (
          <StatusChip tone="critical">Degradada</StatusChip>
        ) : (
          <StatusChip tone="ok" icon={CheckmarkCircle01Icon}>
            Saudável
          </StatusChip>
        )
      }
    >
      {query.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-[5.5rem] rounded-xl" />
          ))}
        </div>
      ) : queue ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QueueTile
            label="Pendentes"
            value={queue.pending}
            tone={queue.pending > 0 ? 'info' : 'neutral'}
          />
          <QueueTile
            label="Processando"
            value={queue.processing}
            tone={queue.processing > 0 ? 'info' : 'neutral'}
          />
          <QueueTile
            label="Travados (15m+)"
            value={queue.stuck}
            tone={queue.stuck > 0 ? 'critical' : 'ok'}
          />
          <QueueTile
            label="Falhas"
            value={queue.failed}
            tone={queue.failed > 0 ? 'critical' : 'ok'}
          />
        </div>
      ) : null}
    </SectionPanel>
  )
}

function QueueTile({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: SignalTone
}) {
  return <SignalTile label={label} value={value} tone={tone} />
}
