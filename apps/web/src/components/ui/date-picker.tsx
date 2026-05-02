import * as React from 'react'
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
  /** Calendar props to pass through */
  calendarProps?: Omit<
    React.ComponentProps<typeof Calendar>,
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
  calendarProps,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
        <Calendar
          mode="single"
          selected={value}
          onSelect={(date) => {
            onChange?.(date)
            setOpen(false)
          }}
          captionLayout="dropdown"
          {...calendarProps}
        />
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
export type { DatePickerProps }
