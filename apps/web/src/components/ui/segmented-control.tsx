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
        // p-1 + inner rounded-lg (8px) → outer rounded-xl (12px) stays concentric.
        // w-fit so it hugs its segments even inside a stretching flex column.
        'inline-flex w-fit items-center gap-1 rounded-xl border border-border/60 bg-muted/50 p-1',
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
              'relative flex min-w-[6rem] cursor-pointer select-none items-center justify-center rounded-lg px-4 py-1.5 text-sm font-medium',
              'transition-[color,background-color,box-shadow,transform] duration-150 ease-out active:scale-[0.97]',
              'has-focus-visible:ring-2 has-focus-visible:ring-ring/60',
              checked
                ? 'bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_0.5px_rgba(0,0,0,0.04)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.4)]'
                : 'text-muted-foreground hover:text-foreground',
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
