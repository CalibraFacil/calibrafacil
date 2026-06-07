'use client'

import { ComponentProps, useState } from 'react'
import { AnimatePresence, motion, type Transition } from 'motion/react'
import {
  Certificate01Icon,
  CheckmarkBadge02Icon,
  CheckmarkCircle02Icon,
  File02Icon,
  SentIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { cn } from '@/lib/utils'
import { useMountEffect } from '@/hooks/use-mount-effect'

type ProgressStatus = 'idle' | 'running' | 'done'
type IconSvg = ComponentProps<typeof HugeiconsIcon>['icon']
type ProgressStep = { label: string; icon: IconSvg }

const spring: Transition = {
  type: 'spring',
  stiffness: 260,
  damping: 22,
  mass: 0.8,
}

/**
 * Cosmetic stages shown while the certificate renders. The backend exposes no
 * sub-progress (status goes straight GENERATING_PDF → APPROVED), so these only
 * reassure the user; real completion is driven by the `status` prop.
 */
const DEFAULT_STEPS: ProgressStep[] = [
  { label: 'Aprovando', icon: CheckmarkCircle02Icon },
  { label: 'Gerando certificado', icon: Certificate01Icon },
  { label: 'Renderizando PDF', icon: File02Icon },
  { label: 'Finalizando', icon: SentIcon },
]

/** Per-character spring reveal, used for the rotating step labels. */
function AnimatedText({
  text,
  className,
  delayStep = 0.014,
}: {
  text: string
  className?: string
  delayStep?: number
}) {
  return (
    <span className={cn('inline-flex', className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={text} className="inline-flex [will-change:transform]">
          {text.split('').map((char, i) => (
            <motion.span
              key={`${i}-${char}`}
              initial={{ y: 10, opacity: 0, scale: 0.5, filter: 'blur(2px)' }}
              animate={{ y: 0, opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ y: -10, opacity: 0, scale: 0.5, filter: 'blur(2px)' }}
              transition={{
                type: 'spring',
                stiffness: 240,
                damping: 16,
                mass: 1.2,
                delay: i * delayStep,
              }}
              className="inline-block"
              style={{ whiteSpace: char === ' ' ? 'pre' : undefined }}
            >
              {char}
            </motion.span>
          ))}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

/**
 * Rotates through the cosmetic steps while mounted. Lives in its own component
 * so the interval starts when the running view appears and is cleared when it
 * unmounts (via useMountEffect's cleanup) — no useEffect, no leaked timer.
 */
function RunningSteps({
  steps,
  intervalMs,
}: {
  steps: ProgressStep[]
  intervalMs: number
}) {
  const [index, setIndex] = useState(0)

  useMountEffect(() => {
    const id = setInterval(() => {
      // Clamp at the last step; real completion ends the running state.
      setIndex((prev) => Math.min(prev + 1, steps.length - 1))
    }, intervalMs)
    return () => clearInterval(id)
  })

  const step = steps[Math.min(index, steps.length - 1)]

  return (
    <div className="flex flex-1 items-center justify-center gap-2 whitespace-nowrap px-4">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={step.label}
          initial={{ opacity: 0, scale: 0, filter: 'blur(4px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 0, filter: 'blur(4px)' }}
          transition={spring}
          className="flex shrink-0"
        >
          <HugeiconsIcon icon={step.icon} className="size-5 text-foreground" />
        </motion.span>
      </AnimatePresence>
      <AnimatedText
        text={step.label}
        className="text-sm font-semibold text-foreground"
      />
    </div>
  )
}

interface CertificateProgressButtonProps {
  /** idle → click approves; running → certificate generating; done → ready. */
  status: ProgressStatus
  /** Fired by the idle button (e.g. open the approval dialog). */
  onApprove?: () => void
  disabled?: boolean
  idleLabel?: string
  doneLabel?: string
  steps?: ProgressStep[]
  stepIntervalMs?: number
  className?: string
}

/**
 * Animated approve → generating → ready control for a calibration certificate.
 * Presentational: the parent maps job status (REVIEW / GENERATING_PDF /
 * APPROVED) onto `status`; this only animates between those states.
 */
function CertificateProgressButton({
  status,
  onApprove,
  disabled = false,
  idleLabel = 'Aprovar certificado',
  doneLabel = 'Certificado pronto',
  steps = DEFAULT_STEPS,
  stepIntervalMs = 1500,
  className,
}: CertificateProgressButtonProps) {
  const widths: Record<ProgressStatus, number> = {
    idle: 208,
    running: 268,
    done: 216,
  }

  return (
    <motion.div
      initial={false}
      animate={{ width: widths[status] }}
      transition={spring}
      className={cn(
        'relative flex h-10 items-center justify-center overflow-hidden rounded-lg',
        status === 'running'
          ? 'border-2 border-dashed border-border bg-card'
          : 'border-2 border-transparent',
        className,
      )}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {status === 'idle' && (
          <motion.button
            key="idle"
            type="button"
            onClick={onApprove}
            disabled={disabled}
            initial={{ opacity: 0, scale: 0.8, filter: 'blur(4px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.8, filter: 'blur(4px)' }}
            transition={spring}
            className="flex h-full flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-emerald-600 px-4 text-white transition-[filter] outline-none hover:brightness-105 focus-visible:ring-[3px] focus-visible:ring-emerald-600/40 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-5" />
            <AnimatedText text={idleLabel} className="text-sm font-semibold" />
          </motion.button>
        )}

        {status === 'running' && (
          <motion.div
            key="running"
            initial={{ opacity: 0, scale: 0.8, filter: 'blur(4px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.8, filter: 'blur(4px)' }}
            transition={spring}
            className="flex h-full flex-1 items-center justify-center"
            aria-live="polite"
            aria-busy="true"
          >
            <RunningSteps steps={steps} intervalMs={stepIntervalMs} />
          </motion.div>
        )}

        {status === 'done' && (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.8, filter: 'blur(4px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.8, filter: 'blur(4px)' }}
            transition={spring}
            className="flex h-full flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-emerald-600 px-4 text-white"
          >
            <HugeiconsIcon icon={CheckmarkBadge02Icon} className="size-5" />
            <AnimatedText text={doneLabel} className="text-sm font-semibold" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export { CertificateProgressButton }
export type { CertificateProgressButtonProps, ProgressStep }
