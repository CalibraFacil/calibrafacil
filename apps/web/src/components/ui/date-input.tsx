'use client'

import { ComponentProps, useState } from 'react'
import { format, isValid, parse } from 'date-fns'
import { Calendar01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import type { DatePickerPreset } from '@/components/ui/date-picker'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface DateInputProps {
  id?: string
  name?: string
  value?: Date
  onChange?: (date: Date | undefined) => void
  disabled?: boolean
  className?: string
  /** Latest selectable date for the native input, as `yyyy-MM-dd`. */
  max?: string
  /** Quick-select shortcuts rendered in a sidebar beside the calendar. */
  presets?: readonly DatePickerPreset[]
  /** Calendar props to pass through (e.g. a `disabled` matcher). */
  calendarProps?: Omit<
    ComponentProps<typeof Calendar>,
    'mode' | 'selected' | 'onSelect'
  >
}

/**
 * A date field that pairs a typeable native date input with a calendar icon
 * (on the left) that opens a popover calendar with an optional preset sidebar.
 * Controlled by a `Date | undefined`; comes empty when `value` is undefined.
 */
function DateInput({
  id,
  name,
  value,
  onChange,
  disabled = false,
  className,
  max,
  presets,
  calendarProps,
}: DateInputProps) {
  const [open, setOpen] = useState(false)
  // Controlled so presets/typing can move the visible month onto the chosen date.
  const [month, setMonth] = useState<Date>(() => value ?? new Date())
  const hasPresets = Boolean(presets && presets.length > 0)

  // `type="date"` only ever emits '' or a valid yyyy-MM-dd, so the displayed
  // text mirrors `value` directly — no separate input-text state needed.
  const inputValue = value && isValid(value) ? format(value, 'yyyy-MM-dd') : ''

  function handleOpenChange(next: boolean) {
    if (next && value) {
      setMonth(value)
    }
    setOpen(next)
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.value
    if (!next) {
      onChange?.(undefined)
      return
    }
    const parsed = parse(next, 'yyyy-MM-dd', new Date())
    if (isValid(parsed)) {
      onChange?.(parsed)
      setMonth(parsed)
    }
  }

  function handleSelect(date: Date | undefined) {
    onChange?.(date)
    if (date) {
      setMonth(date)
    }
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <InputGroup className={cn(disabled && 'opacity-50', className)}>
        <InputGroupAddon align="inline-start">
          <PopoverTrigger
            disabled={disabled}
            aria-label="Abrir calendário"
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={disabled}
              />
            }
          >
            <HugeiconsIcon icon={Calendar01Icon} className="size-4" />
          </PopoverTrigger>
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          name={name}
          type="date"
          value={inputValue}
          max={max}
          disabled={disabled}
          onChange={handleInputChange}
          aria-label="Data"
          className="[&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
        />
      </InputGroup>
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
            onSelect={handleSelect}
            captionLayout="label"
            {...calendarProps}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { DateInput }
export type { DateInputProps }
