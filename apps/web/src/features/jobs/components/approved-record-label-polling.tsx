import { toast } from 'sonner'
import { useMountEffect } from '@/hooks/use-mount-effect'

export function LabelReadyNotifier({ onReady }: { onReady: () => void }) {
  useMountEffect(() => {
    onReady()
  })

  return null
}

export function PendingLabelPoller({ onRefresh }: { onRefresh: () => void }) {
  useMountEffect(() => {
    const interval = window.setInterval(onRefresh, 2000)
    const warningTimeout = window.setTimeout(() => {
      toast.warning('A geração está demorando mais que o esperado...')
    }, 30000)

    return () => {
      window.clearInterval(interval)
      window.clearTimeout(warningTimeout)
    }
  })

  return null
}
