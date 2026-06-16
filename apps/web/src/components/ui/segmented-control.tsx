import { cn } from '@/lib/utils'

export type SegmentedControlOption<TValue extends string> = {
  value: TValue
  label: string
}

/**
 * A binary/few-option mode selector ("pick one of N", not on/off). Built on
 * native radio inputs so keyboard navigation (arrow keys), focus, and
 * single-select semantics come for free and accessibly — no effects, no JS state.
 */
function SegmentedControl<TValue extends string>({
  name,
  value,
  onValueChange,
  options,
  disabled,
  className,
}: {
  name: string
  value: TValue
  onValueChange: (value: TValue) => void
  options: ReadonlyArray<SegmentedControlOption<TValue>>
  disabled?: boolean
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      data-slot="segmented-control"
      className={cn(
        'inline-flex w-full max-w-md rounded-lg bg-muted p-0.5 text-sm',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      {options.map((option) => {
        const checked = option.value === value
        return (
          <label
            key={option.value}
            className={cn(
              'group relative flex flex-1 cursor-pointer items-center justify-center rounded-md px-3 py-1.5 font-medium transition-colors',
              'text-muted-foreground hover:text-foreground',
              'has-checked:bg-background has-checked:text-foreground has-checked:shadow-sm',
              'has-focus-visible:ring-ring/50 has-focus-visible:ring-2',
              disabled && 'pointer-events-none',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              disabled={disabled}
              onChange={() => onValueChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        )
      })}
    </div>
  )
}

export { SegmentedControl }
