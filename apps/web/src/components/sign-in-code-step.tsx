import type { Ref } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  RefreshIcon,
} from '@hugeicons/core-free-icons'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { OTP_CODE_LENGTH, OtpCodeField } from '@/components/otp-code-field'

export type SignInCodeStatus = 'idle' | 'validating' | 'verified'

interface SignInCodeStepProps {
  code: string
  onCodeChange: (code: string) => void
  /** Fires on the sixth digit and on the fallback button — verification is automatic. */
  onSubmit: () => void
  onResend: () => void
  onChangeEmail: () => void
  status: SignInCodeStatus
  error: string | null
  /** Bumped on every rejection so the shake replays even for the same message. */
  errorNonce: number
  resendSecondsLeft: number
  isResending: boolean
  inputRef: Ref<HTMLInputElement>
}

const STEP_ITEM = {
  hidden: { opacity: 0, transform: 'translateY(8px)', filter: 'blur(4px)' },
  visible: { opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' },
}

const STEP_ITEM_REDUCED = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
}

export function SignInCodeStep({
  code,
  onCodeChange,
  onSubmit,
  onResend,
  onChangeEmail,
  status,
  error,
  errorNonce,
  resendSecondsLeft,
  isResending,
  inputRef,
}: SignInCodeStepProps) {
  const prefersReducedMotion = useReducedMotion()
  const item = prefersReducedMotion ? STEP_ITEM_REDUCED : STEP_ITEM

  const isValidating = status === 'validating'
  const isVerified = status === 'verified'
  const isLocked = isValidating || isVerified
  const canResend = resendSecondsLeft === 0 && !isResending && !isLocked

  return (
    <motion.div
      className="flex flex-col gap-5"
      variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
      initial="hidden"
      animate="visible"
      exit="hidden"
      transition={{ type: 'spring', duration: 0.45, bounce: 0 }}
    >
      <motion.div variants={item}>
        <Field data-invalid={error ? true : undefined}>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="sign-in-otp">Código recebido</FieldLabel>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!canResend}
              onClick={onResend}
              // Opt out of the invalid Field's destructive text colour: resending
              // is the way out of the error, not part of it.
              className="text-muted-foreground hover:text-foreground -my-1 h-8 px-2 text-xs"
            >
              {isResending ? (
                <Spinner className="size-3.5" />
              ) : (
                <HugeiconsIcon
                  icon={RefreshIcon}
                  strokeWidth={2}
                  className="size-3.5"
                />
              )}
              {resendSecondsLeft > 0 ? (
                <span className="tabular-nums">
                  Reenviar em {resendSecondsLeft}s
                </span>
              ) : (
                'Reenviar código'
              )}
            </Button>
          </div>

          {/* Keyed on the rejection count so a wrong code remounts this wrapper
              and replays the one-shot shake. */}
          <div key={errorNonce} className={cn(error && 'otp-shake')}>
            <OtpCodeField
              ref={inputRef}
              id="sign-in-otp"
              value={code}
              onChange={onCodeChange}
              onComplete={onSubmit}
              disabled={isLocked}
              invalid={error ? true : undefined}
              success={isVerified}
              autoFocus
              aria-label="Código recebido"
            />
          </div>

          {/* Mounted from the first render (even while empty) so assistive tech
              picks up the rejection the moment it lands — a live region added to
              the DOM together with its message is frequently missed. */}
          <div
            aria-live="assertive"
            aria-atomic="true"
            className={cn(
              'min-h-5 text-center text-sm',
              error ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {error ??
              (isVerified
                ? 'Código verificado. Entrando...'
                : isValidating
                  ? 'Validando código...'
                  : null)}
          </div>

          <FieldDescription className="text-center">
            O código tem {OTP_CODE_LENGTH} dígitos e expira em 10 minutos.
          </FieldDescription>
        </Field>
      </motion.div>

      {/* Verification is automatic on the sixth digit; this stays as the
          keyboard-explicit path and as the retry after a rejection. */}
      <motion.div variants={item} className="flex flex-col gap-2">
        <Button
          type="button"
          disabled={isLocked || code.length < OTP_CODE_LENGTH}
          onClick={onSubmit}
        >
          {isValidating ? (
            <>
              <Spinner className="mr-2" />
              Validando...
            </>
          ) : isVerified ? (
            <>
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                strokeWidth={2}
                className="mr-2 size-4"
              />
              Código verificado
            </>
          ) : (
            'Entrar com código'
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={isLocked}
          onClick={onChangeEmail}
        >
          <HugeiconsIcon
            icon={ArrowLeft01Icon}
            strokeWidth={2}
            className="size-4"
          />
          Usar outro email
        </Button>
      </motion.div>
    </motion.div>
  )
}
