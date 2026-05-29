import { cn } from '@/lib/utils'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { ContaAzulCatalogItem } from '@/features/settings/types'
import { formatCatalogItemLabel } from './conta-azul-catalogs'

export function ContaAzulOptionSelect<TValue extends string>({
  disabled,
  hint,
  label,
  onChange,
  options,
  value,
}: {
  disabled: boolean
  hint?: string
  label: string
  onChange: (value: TValue) => void
  options: ReadonlyArray<{ value: TValue; label: string }>
  value: TValue
}) {
  const selectedLabel =
    options.find((item) => item.value === value)?.label ?? value

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select
        value={value}
        onValueChange={(nextValue) => {
          const option = options.find((item) => item.value === nextValue)
          if (option) onChange(option.value)
        }}
        disabled={disabled}
      >
        <SelectTrigger className="w-full">
          <SelectValue>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
    </Field>
  )
}

export function ContaAzulCatalogSelect({
  disabled,
  isLoading,
  items,
  label,
  onChange,
  placeholder,
  value,
}: {
  disabled: boolean
  isLoading: boolean
  items: ContaAzulCatalogItem[]
  label: string
  onChange: (value: string | null) => void
  placeholder: string
  value: string | null
}) {
  const selectedItem =
    value == null ? null : items.find((item) => item.id === value)
  const selectedLabel =
    value == null
      ? 'Não configurado'
      : selectedItem
        ? formatCatalogItemLabel(selectedItem)
        : isLoading
          ? 'Carregando…'
          : value

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select
        value={value ?? 'not_configured'}
        onValueChange={(nextValue) =>
          onChange(nextValue === 'not_configured' ? null : nextValue)
        }
        disabled={disabled || isLoading}
      >
        <SelectTrigger className="w-full">
          <SelectValue>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="not_configured">
            {isLoading ? 'Carregando…' : 'Não configurado'}
          </SelectItem>
          {items.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {formatCatalogItemLabel(item)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>{placeholder}</FieldDescription>
    </Field>
  )
}

export function ContaAzulTextSetting({
  disabled,
  label,
  onChange,
  placeholder,
  value,
}: {
  disabled: boolean
  label: string
  onChange: (value: string | null) => void
  placeholder: string
  value: string | null
}) {
  const inputValue = value ?? ''

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        key={inputValue}
        defaultValue={inputValue}
        disabled={disabled}
        placeholder={placeholder}
        onBlur={(event) => {
          const nextValue = event.currentTarget.value.trim()
          if (nextValue !== inputValue) {
            onChange(nextValue ? nextValue : null)
          }
        }}
      />
      <FieldDescription>{placeholder}</FieldDescription>
    </Field>
  )
}

/** A single sync-domain toggle rendered as a switch row. */
export function DomainSwitchRow({
  checked,
  description,
  disabled,
  label,
  onCheckedChange,
}: {
  checked: boolean
  description: string
  disabled: boolean
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label
      className={cn(
        'flex items-start justify-between gap-3 rounded-lg bg-card px-3 py-2.5 ring-1 ring-inset ring-border/70 transition-colors',
        !disabled &&
          'hover:ring-border has-[button[data-checked]]:bg-primary/[0.03]',
        disabled && 'opacity-60',
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-none">{label}</span>
        <span className="mt-1 block text-xs text-pretty text-muted-foreground">
          {description}
        </span>
      </span>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={(nextChecked) => onCheckedChange(nextChecked === true)}
        className="mt-0.5"
      />
    </label>
  )
}
