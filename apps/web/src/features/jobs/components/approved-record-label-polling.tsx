import { toast } from 'sonner'
import { useMountEffect } from '@calibra-facil/ui/use-mount-effect'

export function LabelReadyNotifier({ onReady }: { onReady: () => void }) {
  useMountEffect(() => {
    onReady()
  })

  return null
}

/** How long the page polls for a requested label before it stops asking. */
const LABEL_POLL_LIMIT_MS = 120_000

export function PendingLabelPoller({
  onRefresh,
  onGiveUp,
}: {
  onRefresh: () => void
  onGiveUp: () => void
}) {
  useMountEffect(() => {
    const interval = window.setInterval(onRefresh, 2000)
    const warningTimeout = window.setTimeout(() => {
      toast.warning('A geração está demorando mais que o esperado...')
    }, 30000)
    const giveUpTimeout = window.setTimeout(() => {
      toast.info(
        'A etiqueta continua sendo gerada. Atualize a página em instantes para baixá-la.',
      )
      onGiveUp()
    }, LABEL_POLL_LIMIT_MS)

    return () => {
      window.clearInterval(interval)
      window.clearTimeout(warningTimeout)
      window.clearTimeout(giveUpTimeout)
    }
  })

  return null
}
