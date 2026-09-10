import { ComponentProps, useContext } from 'react'
import { OTPInput, OTPInputContext } from 'input-otp'

import { cn } from '@/lib/utils'

function InputOTP({
  className,
  containerClassName,
  ...props
}: ComponentProps<typeof OTPInput>) {
  return (
    <OTPInput
      data-slot="input-otp"
      containerClassName={cn(
        'flex items-center gap-2 has-disabled:opacity-50',
        containerClassName,
      )}
      className={cn('disabled:cursor-not-allowed', className)}
      {...props}
    />
  )
}

function InputOTPGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="input-otp-group"
      className={cn('flex items-center gap-2', className)}
      {...props}
    />
  )
}

function InputOTPSlot({
  index,
  className,
  ...props
}: ComponentProps<'div'> & {
  index: number
}) {
  const inputOTPContext = useContext(OTPInputContext)
  const slot = inputOTPContext.slots[index]

  return (
    // Each digit gets its own box with an even gap: a joined bar (or a dash
    // separator between groups) reads as punctuation and makes people wonder
    // whether the emailed code contains one. It does not — it is six digits.
    <div
      data-slot="input-otp-slot"
      data-active={slot?.isActive}
      data-filled={slot?.char ? true : undefined}
      className={cn(
        'border-input text-foreground dark:bg-input/30 relative flex h-12 w-11 items-center justify-center rounded-md border text-lg font-semibold tabular-nums shadow-xs outline-none sm:w-12',
        'transition-[border-color,box-shadow,background-color] duration-150 ease-out',
        'data-[filled=true]:border-foreground/30',
        'data-[success=true]:border-emerald-500/60 data-[success=true]:text-emerald-700 dark:data-[success=true]:text-emerald-400',
        'data-[success=true]:data-[active=true]:border-emerald-500/60 data-[success=true]:data-[active=true]:ring-emerald-500/25',
        'data-[active=true]:border-ring data-[active=true]:ring-ring/50 data-[active=true]:z-10 data-[active=true]:ring-[3px]',
        'aria-invalid:border-destructive aria-invalid:text-destructive data-[active=true]:aria-invalid:border-destructive data-[active=true]:aria-invalid:ring-destructive/20 dark:data-[active=true]:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    >
      {slot?.char ? (
        // Keyed on the character so a fresh digit remounts and replays the pop:
        // it lands rather than blinks into place.
        <span
          key={slot.char}
          className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-150"
        >
          {slot.char}
        </span>
      ) : null}
      {slot?.hasFakeCaret ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="bg-foreground h-5 w-px animate-caret-blink duration-1000" />
        </div>
      ) : null}
    </div>
  )
}

export { InputOTP, InputOTPGroup, InputOTPSlot }
