import { useState, type ComponentProps } from 'react'
import { Input } from '@calibra-facil/ui/input'
import {
  isPartialMeasurementInput,
  parseMeasurementInput,
  withDecimalComma,
} from '@calibra-facil/shared/calibration-format'

type DecimalInputProps = Omit<
  ComponentProps<typeof Input>,
  'value' | 'onChange' | 'type' | 'inputMode'
> & {
  value: number | null
  /** The parsed number on every keystroke; `null` while the text is empty or incomplete. */
  onValueChange: (value: number | null) => void
}

/**
 * A text field for a number typed with the pt-BR comma or a point. The text
 * stays as typed while the field is being edited (so "23," survives the
 * re-render) and the number reaches the parent through the one shared parser;
 * out of editing it shows the number with the decimal comma.
 */
export function DecimalInput({
  value,
  onValueChange,
  onBlur,
  ...props
}: DecimalInputProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (value === null ? '' : withDecimalComma(String(value)))

  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      value={shown}
      onChange={(event) => {
        const text = event.target.value
        if (!isPartialMeasurementInput(text)) return
        setDraft(text)
        onValueChange(parseMeasurementInput(text))
      }}
      onBlur={(event) => {
        setDraft(null)
        onBlur?.(event)
      }}
    />
  )
}
