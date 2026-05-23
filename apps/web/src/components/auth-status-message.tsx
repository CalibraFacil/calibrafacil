import { HugeiconsIcon } from '@hugeicons/react'
import {
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  MultiplicationSignCircleIcon,
} from '@hugeicons/core-free-icons'

import { cn } from '@/lib/utils'

type AuthStatusTone = 'error' | 'info' | 'success'

export type AuthStatus = {
  tone: AuthStatusTone
  title: string
  description?: string
}

type AuthStatusMessageProps = {
  status: AuthStatus
  className?: string
}

const toneClassName: Record<AuthStatusTone, string> = {
  error: 'border-destructive/30 bg-destructive/10 text-destructive',
  info: 'border-sky-500/25 bg-sky-500/10 text-sky-800 dark:text-sky-200',
  success:
    'border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
}

const toneIcon = {
  error: MultiplicationSignCircleIcon,
  info: InformationCircleIcon,
  success: CheckmarkCircle02Icon,
}

export function AuthStatusMessage({
  status,
  className,
}: AuthStatusMessageProps) {
  return (
    <div
      role={status.tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex gap-3 rounded-md border p-3 text-sm',
        toneClassName[status.tone],
        className,
      )}
    >
      <HugeiconsIcon
        icon={toneIcon[status.tone]}
        strokeWidth={2}
        className="mt-0.5 size-4 shrink-0"
      />
      <div className="space-y-1">
        <p className="font-medium leading-none">{status.title}</p>
        {status.description ? (
          <p className="text-current/80 leading-relaxed">
            {status.description}
          </p>
        ) : null}
      </div>
    </div>
  )
}
