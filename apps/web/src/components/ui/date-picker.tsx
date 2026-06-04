import { ComponentProps, useState } from 'react'
import { Calendar01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

/** A quick-select shortcut shown beside the calendar (e.g. periodicity intervals). */
interface DatePickerPreset {
  label: string
  /** Resolves the date this preset selects, computed at click time. */
  getDate: () => Date
}

interface DatePickerProps {
  id?: string
  name?: string
  value?: Date
  onChange?: (date: Date | undefined) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  /** Format function for displaying the date */
  formatDate?: (date: Date) => string
  /** Quick-select shortcuts rendered in a sidebar beside the calendar */
  presets?: readonly DatePickerPreset[]
  /** Calendar props to pass through */
  calendarProps?: Omit<
    ComponentProps<typeof Calendar>,
    'mode' | 'selected' | 'onSelect'
  >
}

function defaultFormatDate(date: Date): string {
  return date.toLocaleDateString('pt-BR')
}

function DatePicker({
  id,
  name,
  value,
  onChange,
  placeholder = 'Selecione uma data',
  disabled = false,
  className,
  formatDate = defaultFormatDate,
  presets,
  calendarProps,
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  // Controlled so presets can move the visible month onto the chosen date.
  const [month, setMonth] = useState<Date>(() => value ?? new Date())
  const hasPresets = Boolean(presets && presets.length > 0)

  function handleOpenChange(next: boolean) {
    if (next && value) {
      setMonth(value)
    }
    setOpen(next)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            id={id}
            name={name}
            variant="outline"
            disabled={disabled}
            data-empty={!value}
            className={cn(
              'w-full justify-start text-left font-normal data-[empty=true]:text-muted-foreground',
              className,
            )}
          />
        }
      >
        <HugeiconsIcon icon={Calendar01Icon} className="mr-2 size-4" />
        {value ? formatDate(value) : <span>{placeholder}</span>}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className={cn('flex', hasPresets && 'max-sm:flex-col')}>
          {hasPresets ? (
            <div className="flex flex-col gap-1 p-2 max-sm:order-1 max-sm:border-t sm:border-e">
              {presets?.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start font-normal"
                  onClick={() => {
                    const date = preset.getDate()
                    onChange?.(date)
                    setMonth(date)
                  }}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          ) : null}
          <Calendar
            mode="single"
            selected={value}
            month={month}
            onMonthChange={setMonth}
            onSelect={(date) => {
              onChange?.(date)
              setOpen(false)
            }}
            captionLayout="dropdown"
            {...calendarProps}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
export type { DatePickerPreset, DatePickerProps }
