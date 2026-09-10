import type { ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { RefreshIcon } from '@hugeicons/core-free-icons'
import type { OperationAvailability } from '@calibra-facil/client-runtime'
import type { SyncStatusContextValue } from '@/runtime/sync-status'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  useDesktopManualSyncAction,
  useOptionalSyncStatus,
} from '@/runtime/sync-status'

/**
 * Wraps a product action with the reason it is currently unavailable.
 *
 * The point is not the tooltip; it is that the *same* boolean drives the
 * control's disabled state and the explanation. Before this existed, desktop
 * hid or silently no-op'd actions with no reason and no way forward, which is
 * how "approve" became a button that threw an error telling the user to go
 * open the web app.
 *
 * This is availability only. Permission and entitlement gating stays with the
 * server and with the existing plan/role hooks — never fold them in here.
 */
export function ActionAvailabilityGate({
  availability,
  children,
  className,
}: {
  availability: OperationAvailability
  children: (state: { disabled: boolean }) => ReactNode
  className?: string
}) {
  if (availability.available) {
    return <>{children({ disabled: false })}</>
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className={cn('inline-flex cursor-not-allowed', className)} />
        }
      >
        {children({ disabled: true })}
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        <div className="max-w-72 space-y-2 text-sm">
          <p>{availability.message}</p>
          <ManualSyncAffordance availability={availability} />
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Only offered when a sync could actually clear the blocker *and* there is a
 * sync surface to drive. Outside the dashboard shell the hint would be a
 * button that does nothing.
 */
function ManualSyncAffordance({
  availability,
}: {
  availability: OperationAvailability
}) {
  const sync = useOptionalSyncStatus()

  if (availability.available || !availability.resolvableBySync) return null
  if (!sync) return null

  return <ManualSyncHint sync={sync} />
}

function ManualSyncHint({ sync }: { sync: SyncStatusContextValue }) {
  const syncAction = useDesktopManualSyncAction(sync)

  if (!syncAction.canSync) return null

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={syncAction.disabled}
      onClick={syncAction.run}
    >
      <HugeiconsIcon
        icon={RefreshIcon}
        className={cn('size-4', syncAction.disabled && 'animate-spin')}
      />
      Sincronizar agora
    </Button>
  )
}

/**
 * Block-level counterpart for a section whose whole purpose is unavailable —
 * a panel body, an empty list, a dialog that cannot be filled in yet.
 */
export function OperationUnavailableNotice({
  availability,
  className,
}: {
  availability: OperationAvailability
  className?: string
}) {
  if (availability.available) return null

  return (
    <div
      className={cn(
        'flex flex-col items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200',
        className,
      )}
    >
      <p className="text-pretty">{availability.message}</p>
      <ManualSyncAffordance availability={availability} />
    </div>
  )
}
