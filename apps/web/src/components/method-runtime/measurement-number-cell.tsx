import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'

import { convertUnitValue, unitKind } from '@calibra-facil/shared/units'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

export interface MeasurementPickerOption {
  label: string
  value: number
  uncertainty: number
  unit: string
  standardName: string
}

interface MeasurementNumberCellProps {
  /** Stored value in the column's canonical unit (e.g. grams). */
  value: unknown
  /** Commits the value back in the canonical unit. */
  onCommit: (value: number | null) => void
  /** The column's canonical/storage unit (e.g. "g"). */
  columnUnit?: string | null
  /** The asset's display unit for entry/view (e.g. "kg"). */
  displayUnit?: string | null
  /** Max fractional digits allowed in the display unit (from the resolution). */
  maxDecimals?: number | null
  disabled?: boolean
  className?: string
  title?: string
  /** When provided, renders a certified-value picker beside the input. */
  certifiedValueOptions?: MeasurementPickerOption[]
}

function parseCanonical(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function trimNumber(value: number, maxDecimals: number | null): string {
  if (maxDecimals != null) {
    return String(Number(value.toFixed(maxDecimals)))
  }
  return String(Number(value.toPrecision(12)))
}

function fractionalDigits(text: string): number {
  const fractional = text.split('.')[1]
  return fractional ? fractional.length : 0
}

export function MeasurementNumberCell({
  value,
  onCommit,
  columnUnit,
  displayUnit,
  maxDecimals = null,
  disabled = false,
  className,
  title,
  certifiedValueOptions,
}: MeasurementNumberCellProps) {
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)

  const conversionActive =
    unitKind(displayUnit) != null &&
    unitKind(columnUnit) === unitKind(displayUnit) &&
    displayUnit !== columnUnit

  const toDisplay = (canonical: number): number => {
    if (!conversionActive) return canonical
    return convertUnitValue(canonical, columnUnit, displayUnit) ?? canonical
  }

  const toCanonical = (display: number, fromUnit?: string | null): number => {
    const sourceUnit = fromUnit ?? displayUnit
    const sourceKind = unitKind(sourceUnit)
    if (sourceKind == null || unitKind(columnUnit) !== sourceKind) return display
    if (sourceUnit === columnUnit) return display
    const converted = convertUnitValue(display, sourceUnit, columnUnit)
    if (converted == null) return display
    // Strip floating-point noise introduced by the unit conversion so stored
    // execution values stay clean for downstream certificates.
    return Number(converted.toPrecision(12))
  }

  const formatCanonicalForDisplay = (canonical: number | null): string => {
    if (canonical == null) return ''
    return trimNumber(toDisplay(canonical), maxDecimals)
  }

  const canonicalValue = parseCanonical(value)
  const inputValue = focused ? draft : formatCanonicalForDisplay(canonicalValue)

  const handleChange = (raw: string) => {
    if (raw !== '' && !/^-?\d*[.,]?\d*$/.test(raw)) return

    const normalized = raw.replace(',', '.')
    if (maxDecimals != null && fractionalDigits(normalized) > maxDecimals) {
      return
    }

    setDraft(normalized)

    if (normalized === '' || normalized === '-' || normalized === '.') {
      onCommit(null)
      return
    }

    const parsed = Number.parseFloat(normalized)
    if (Number.isFinite(parsed)) {
      onCommit(toCanonical(parsed))
    }
  }

  const handleBlur = () => {
    setFocused(false)
    const normalized = draft.replace(',', '.')
    if (normalized === '' || normalized === '-' || normalized === '.') {
      onCommit(null)
      return
    }
    const parsed = Number.parseFloat(normalized)
    if (Number.isFinite(parsed)) {
      const display =
        maxDecimals != null ? Number(parsed.toFixed(maxDecimals)) : parsed
      onCommit(toCanonical(display))
    }
  }

  const handlePick = (option: MeasurementPickerOption) => {
    onCommit(toCanonical(option.value, option.unit))
    setOpen(false)
  }

  const renderInput = (inputClassName: string) => (
    <Input
      type="text"
      inputMode="decimal"
      value={inputValue}
      onFocus={() => {
        setDraft(formatCanonicalForDisplay(canonicalValue))
        setFocused(true)
      }}
      onChange={(event) => handleChange(event.target.value)}
      onBlur={handleBlur}
      disabled={disabled}
      className={inputClassName}
      title={title}
    />
  )

  if (!certifiedValueOptions || certifiedValueOptions.length === 0) {
    return renderInput(className ?? 'h-8 w-full')
  }

  const groupedOptions = certifiedValueOptions.reduce<
    Record<string, MeasurementPickerOption[]>
  >((acc, option) => {
    if (!acc[option.standardName]) acc[option.standardName] = []
    acc[option.standardName].push(option)
    return acc
  }, {})

  return (
    <div className="flex gap-1">
      {renderInput('h-8 flex-1')}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={(props) => (
            <Button
              {...props}
              variant="ghost"
              size="icon"
              disabled={disabled}
              className="h-8 w-8 shrink-0"
              title="Inserir valor certificado"
            >
              <HugeiconsIcon icon={ArrowDown01Icon} className="h-4 w-4" />
            </Button>
          )}
        />
        <PopoverContent align="end" className="w-64 p-2">
          <div className="max-h-48 space-y-2 overflow-auto">
            {Object.entries(groupedOptions).map(([standardName, options]) => (
              <div key={standardName}>
                <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  {standardName}
                </p>
                {options.map((option) => (
                  <button
                    key={`${option.label}:${option.value}`}
                    type="button"
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => handlePick(option)}
                  >
                    <span>{option.label}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {option.value.toFixed(5)} {option.unit}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
