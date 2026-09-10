import type { Ref } from 'react'
import { REGEXP_ONLY_DIGITS } from 'input-otp'

import { cn } from '@/lib/utils'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp'

/** Every one-time code this product emails is six digits (Better Auth default). */
export const OTP_CODE_LENGTH = 6

const SLOT_INDEXES = Array.from(
  { length: OTP_CODE_LENGTH },
  (_, index) => index,
)

interface OtpCodeFieldProps {
  id?: string
  value: string
  onChange: (value: string) => void
  /** Fires once, on the keystroke (or paste) that fills the last slot. */
  onComplete?: (value: string) => void
  disabled?: boolean
  invalid?: boolean
  /** Accepted code: recolours the slots instead of leaving them looking disabled. */
  success?: boolean
  autoFocus?: boolean
  className?: string
  ref?: Ref<HTMLInputElement>
  'aria-label'?: string
  'aria-describedby'?: string
}

/**
 * The six-digit code entry used by every "we emailed you a code" step.
 *
 * `input-otp` renders a single real `<input>` under the painted slots, so paste,
 * select, cut, Tab and screen-reader navigation all behave natively — there is
 * no per-slot focus juggling to get wrong.
 */
export function OtpCodeField({
  id,
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  success,
  autoFocus,
  className,
  ref,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: OtpCodeFieldProps) {
  return (
    <InputOTP
      ref={ref}
      id={id}
      maxLength={OTP_CODE_LENGTH}
      pattern={REGEXP_ONLY_DIGITS}
      // Codes arrive pasted with stray spaces, a trailing newline, or the whole
      // surrounding sentence. Keep the digits instead of rejecting the paste.
      pasteTransformer={(pasted) =>
        pasted.replace(/\D/g, '').slice(0, OTP_CODE_LENGTH)
      }
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      disabled={disabled}
      autoFocus={autoFocus}
      inputMode="numeric"
      // Lets iOS/macOS Security Code AutoFill offer the code straight from Mail.
      autoComplete="one-time-code"
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-invalid={invalid ? true : undefined}
      containerClassName={cn(
        'justify-center',
        // A verified code is locked, not disabled — keep it at full strength.
        success && 'has-disabled:opacity-100',
        className,
      )}
      required
    >
      <InputOTPGroup>
        {SLOT_INDEXES.map((index) => (
          <InputOTPSlot
            key={index}
            index={index}
            aria-invalid={invalid ? true : undefined}
            data-success={success ? true : undefined}
          />
        ))}
      </InputOTPGroup>
    </InputOTP>
  )
}
