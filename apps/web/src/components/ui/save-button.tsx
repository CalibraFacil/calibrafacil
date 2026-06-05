'use client'

import { useRef, useState } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { cn } from '@/lib/utils'

type SaveButtonStatus = 'idle' | 'loading' | 'success' | 'saved'
type SaveButtonSize = 'sm' | 'md' | 'lg'

type SizeConfig = {
  height: number
  circleWidth: number
  idleWidth: number
  savedWidth: number
  text: string
  icon: string
  spinner: string
  gap: string
  padding: string
}

const SIZE_CONFIG: Record<SaveButtonSize, SizeConfig> = {
  sm: {
    height: 40,
    circleWidth: 40,
    idleWidth: 176,
    savedWidth: 132,
    text: 'text-sm',
    icon: 'size-5',
    spinner: 'h-5 w-5',
    gap: 'gap-2',
    padding: 'px-4',
  },
  md: {
    height: 48,
    circleWidth: 48,
    idleWidth: 192,
    savedWidth: 148,
    text: 'text-[15px]',
    icon: 'size-6',
    spinner: 'h-6 w-6',
    gap: 'gap-2.5',
    padding: 'px-5',
  },
  lg: {
    height: 56,
    circleWidth: 56,
    idleWidth: 208,
    savedWidth: 164,
    text: 'text-base',
    icon: 'size-7',
    spinner: 'h-7 w-7',
    gap: 'gap-3',
    padding: 'px-5',
  },
}

interface SaveButtonProps {
  /** The async save action. Its rejection resets the button to idle. */
  onSave: () => Promise<unknown>
  disabled?: boolean
  size?: SaveButtonSize
  idleText?: string
  savedText?: string
  /** How long the success check pulses before expanding to the "saved" pill. */
  successDuration?: number
  className?: string
  onStatusChange?: (status: SaveButtonStatus) => void
}

/**
 * Animated save button: idle → loading (collapses to a spinner circle) →
 * success (check pulse) → saved (pill with check + label). Driven by the
 * promise returned from `onSave`, so it mirrors the real mutation state.
 */
function SaveButton({
  onSave,
  disabled = false,
  size = 'sm',
  idleText = 'Salvar',
  savedText = 'Salvo',
  successDuration = 900,
  className,
  onStatusChange,
}: SaveButtonProps) {
  const [status, setStatus] = useState<SaveButtonStatus>('idle')
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )

  const cfg = SIZE_CONFIG[size]
  // idle and saved share a width so the label swap never reflows the layout.
  const stableWidth = Math.max(cfg.idleWidth, cfg.savedWidth)
  const isCircle = status === 'loading' || status === 'success'
  const isBusy = status === 'loading' || status === 'success'

  function transition(next: SaveButtonStatus) {
    setStatus(next)
    onStatusChange?.(next)
  }

  function clearSavedTimer() {
    if (savedTimer.current !== undefined) {
      clearTimeout(savedTimer.current)
      savedTimer.current = undefined
    }
  }

  async function handleClick() {
    // Ignore clicks mid-cycle; allow re-saving from both idle and saved.
    if (isBusy) return
    clearSavedTimer()
    transition('loading')
    try {
      await onSave()
      transition('success')
      savedTimer.current = setTimeout(
        () => transition('saved'),
        successDuration,
      )
    } catch {
      // The caller's mutation surfaces the error (toast); just reset here.
      transition('idle')
    }
  }

  const accessibleLabel =
    status === 'loading'
      ? 'Salvando'
      : status === 'saved'
        ? savedText
        : idleText

  return (
    <MotionConfig
      transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 1 }}
    >
      <motion.button
        type="button"
        onClick={handleClick}
        disabled={disabled || isBusy}
        aria-label={accessibleLabel}
        aria-busy={status === 'loading'}
        initial={false}
        animate={{ width: isCircle ? cfg.circleWidth : stableWidth }}
        style={{
          height: cfg.height,
          borderWidth: status === 'saved' ? 2 : 1,
        }}
        transition={{
          type: 'spring',
          stiffness: 200,
          damping: 15,
          mass: 1.2,
          backgroundColor: { duration: 0.2 },
        }}
        className={cn(
          'relative z-0 flex select-none items-center justify-center overflow-hidden rounded-lg border outline-none transition-colors',
          'focus-visible:ring-[3px] focus-visible:ring-ring/50',
          'disabled:cursor-not-allowed disabled:opacity-60',
          'not-disabled:cursor-pointer not-disabled:active:scale-[0.97]',
          status === 'idle' && 'border-transparent bg-primary',
          isCircle && 'border-border bg-secondary',
          status === 'saved' && 'border-muted bg-card',
          className,
        )}
      >
        <AnimatePresence mode="popLayout">
          {status === 'idle' && (
            <motion.span
              key="idle"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15, x: -20 }}
              className={cn(
                'absolute inset-0 flex items-center justify-center font-semibold tracking-tight text-primary-foreground',
                cfg.text,
              )}
            >
              {idleText}
            </motion.span>
          )}

          {status === 'loading' && (
            <motion.div
              key="loading"
              initial={{ opacity: 0, scale: 0.8, filter: 'blur(4px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 0.8, filter: 'blur(4px)' }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <motion.svg
                viewBox="0 0 26 26"
                className={cfg.spinner}
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 0.7, ease: 'linear' }}
              >
                <circle
                  cx="13"
                  cy="13"
                  r="10"
                  className="stroke-muted"
                  strokeWidth="3"
                  fill="none"
                />
                <path
                  d="M13 3 A10 10 0 0 1 23 13"
                  className="stroke-primary"
                  strokeWidth="3"
                  strokeLinecap="round"
                  fill="none"
                />
              </motion.svg>
            </motion.div>
          )}

          {(status === 'success' || status === 'saved') && (
            <motion.div
              key="check-state"
              layout
              initial={
                status === 'success'
                  ? { opacity: 0, scale: 0.5, filter: 'blur(4px)' }
                  : { opacity: 1 }
              }
              animate={
                status === 'success'
                  ? { opacity: 1, scale: 1.15, filter: 'blur(0px)' }
                  : { opacity: 1, scale: 1, y: 0 }
              }
              exit={{ opacity: 0, y: 15, filter: 'blur(4px)' }}
              className={cn(
                'absolute inset-0 flex items-center justify-center',
                status === 'saved' && `${cfg.gap} ${cfg.padding}`,
              )}
            >
              <motion.span
                layout
                className={cn(
                  'z-20 flex items-center justify-center',
                  status === 'success'
                    ? 'text-primary'
                    : 'text-muted-foreground',
                )}
              >
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  className={cfg.icon}
                  strokeWidth={2.5}
                />
              </motion.span>

              <AnimatePresence mode="popLayout">
                {status === 'saved' && (
                  <motion.span
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: 0.1 }}
                    className={cn(
                      'z-20 whitespace-nowrap font-semibold tracking-tight text-muted-foreground',
                      cfg.text,
                    )}
                  >
                    {savedText}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    </MotionConfig>
  )
}

export { SaveButton }
export type { SaveButtonProps, SaveButtonStatus }
