import { cn } from '@calibra-facil/ui/utils'
import { JOB_STATUS, type JobStatus } from '@calibra-facil/schemas'
import { StatusBadge } from '@calibra-facil/ui/status-badge'

function LoadingDots() {
  return (
    <span className="inline-flex" aria-hidden="true">
      <span
        className="animate-[bounce_1s_ease-in-out_infinite]"
        style={{ animationDelay: '0ms' }}
      >
        .
      </span>
      <span
        className="animate-[bounce_1s_ease-in-out_infinite]"
        style={{ animationDelay: '150ms' }}
      >
        .
      </span>
      <span
        className="animate-[bounce_1s_ease-in-out_infinite]"
        style={{ animationDelay: '300ms' }}
      >
        .
      </span>
    </span>
  )
}

/** A job's status pill; a certificate being rendered pulses with animated dots. */
export function JobStatusBadge({
  status,
  className,
}: {
  status: JobStatus
  className?: string
}) {
  if (status !== 'GENERATING_PDF') {
    return (
      <StatusBadge tone={JOB_STATUS.tone(status)} className={className}>
        {JOB_STATUS.label(status)}
      </StatusBadge>
    )
  }
  return (
    <StatusBadge
      tone={JOB_STATUS.tone(status)}
      className={cn('animate-pulse', className)}
    >
      <span className="inline-flex">
        <span className="animate-[ellipsis_1.5s_infinite]">
          {JOB_STATUS.label(status)}
        </span>
        <span className="w-4 text-left">
          <LoadingDots />
        </span>
      </span>
    </StatusBadge>
  )
}
