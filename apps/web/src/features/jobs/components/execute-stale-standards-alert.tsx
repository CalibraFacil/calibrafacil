import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon } from '@hugeicons/core-free-icons'
import { Button } from '@calibra-facil/ui/button'
import { standardWarningItems } from '@/features/jobs/standard-warnings'
import { STATUS_TONE } from '@calibra-facil/ui/status-tone'

export function ExecuteStaleStandardsAlert({
  items,
  isEditable,
  onRemove,
}: {
  items: ReturnType<typeof standardWarningItems>
  isEditable: boolean
  onRemove: (standardId: number) => void
}) {
  return (
    <div
      role="status"
      className={`space-y-2 rounded-xl border p-3 ${STATUS_TONE.warning.alert}`}
    >
      {items.map((item) => (
        <div key={item.standardId} className="flex items-center gap-2 text-sm">
          <HugeiconsIcon icon={Alert02Icon} className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 text-pretty">{item.message}</span>
          {isEditable && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Remover padrão ${item.name}`}
              onClick={() => onRemove(item.standardId)}
            >
              Remover
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}
