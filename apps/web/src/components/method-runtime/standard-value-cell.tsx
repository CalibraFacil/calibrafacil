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
import type { StandardCertifiedValueOption } from './standard-value-utils'

interface StandardValueCellProps {
  /** Stored value in the column's canonical unit. */
  value: unknown
  /** Commits a manually-typed value back in the canonical unit (fallback). */
  onCommit: (value: number | null) => void
  /**
   * Fired when the operator picks a certified value. The renderer fills the
   * configured target columns (value / U / k / drift) from this option.
   */
  onPick: (option: StandardCertifiedValueOption) => void
  options: StandardCertifiedValueOption[]
  /** The column's canonical/storage unit. */
  columnUnit?: string | null
  /** The asset's display unit for entry/view. */
  displayUnit?: string | null
  disabled?: boolean
  className?: string
  title?: string
}

function parseCanonical(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function StandardValueCell({
  value,
  onCommit,
  onPick,
  options,
  columnUnit,
  displayUnit,
  disabled = false,
  className,
  title,
}: StandardValueCellProps) {
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

  const toCanonical = (display: number): number => {
    if (!conversionActive) return display
    const converted = convertUnitValue(display, displayUnit, columnUnit)
    if (converted == null) return display
    return Number(converted.toPrecision(12))
  }

  const formatForDisplay = (canonical: number | null): string => {
    if (canonical == null) return ''
    return String(Number(toDisplay(canonical).toPrecision(12)))
  }

  const canonicalValue = parseCanonical(value)
  const inputValue = focused ? draft : formatForDisplay(canonicalValue)

  const handleChange = (raw: string) => {
    if (raw !== '' && !/^-?\d*[.,]?\d*$/.test(raw)) return
    const normalized = raw.replace(',', '.')
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
      onCommit(toCanonical(parsed))
    }
  }

  const handlePick = (option: StandardCertifiedValueOption) => {
    onPick(option)
    setOpen(false)
  }

  const renderInput = (inputClassName: string) => (
    <Input
      type="text"
      inputMode="decimal"
      value={inputValue}
      onFocus={() => {
        setDraft(formatForDisplay(canonicalValue))
        setFocused(true)
      }}
      onChange={(event) => handleChange(event.target.value)}
      onBlur={handleBlur}
      disabled={disabled}
      className={inputClassName}
      title={title}
    />
  )

  if (disabled || options.length === 0) {
    return renderInput(className ?? 'h-8 w-full')
  }

  const groupedOptions = options.reduce<
    Record<string, StandardCertifiedValueOption[]>
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
              title="Preencher a partir do padrão"
            >
              <HugeiconsIcon icon={ArrowDown01Icon} className="h-4 w-4" />
            </Button>
          )}
        />
        <PopoverContent align="end" className="w-72 p-2">
          <div className="max-h-56 space-y-2 overflow-auto">
            {Object.entries(groupedOptions).map(([standardName, group]) => (
              <div key={standardName}>
                <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  {standardName}
                </p>
                {group.map((option) => (
                  <button
                    key={`${option.standardId}:${option.certifiedValueIndex}`}
                    type="button"
                    className="flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => handlePick(option)}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">
                        {option.nominal}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                        {Number(option.value.toPrecision(8))} {option.unit}
                      </span>
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                      U {Number(option.uncertainty.toPrecision(6))}{' '}
                      {option.unit} · k {option.coverageFactor}
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
