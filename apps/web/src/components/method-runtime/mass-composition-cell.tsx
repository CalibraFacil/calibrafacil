import { useMemo, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  ArrowDown01Icon,
  Delete02Icon,
  MagicWand01Icon,
  MinusSignIcon,
  RepeatIcon,
} from '@hugeicons/core-free-icons'

import {
  buildMassCompositionValue,
  convertMassValue,
  isMassCompositionValue,
  isMassUnit,
  normalizeMassUnit,
  type MassCompositionConfig,
  type MassCompositionItem,
  type MassCompositionOption,
  type MassCompositionValue,
  type MassUnit,
} from './mass-composition-utils'
import {
  describeMassDelta,
  massCompositionItemFromOption,
  normalizeSearchText,
  optionValueIn,
  parseQuickAdd,
  sortMassOptionsDesc,
  suggestMassComposition,
  type MassDeltaStatus,
} from './mass-composition-suggest'
import { parseNumericValue } from './weighing-range-utils'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'

interface MassCompositionCellProps {
  value: unknown
  onChange: (value: MassCompositionValue | null) => void
  options: MassCompositionOption[]
  config?: MassCompositionConfig
  disabled?: boolean
  presentation?: 'cell' | 'field'
  target?: { value: number; unit: MassUnit } | null
  previousComposition?: MassCompositionValue | null
  /** Unit used to present totals/target to match the execution table cells. */
  displayUnit?: string | null
}

function optionKey(option: MassCompositionOption): string {
  return `${option.standardId}:${option.certifiedValueIndex}`
}

function itemKey(item: MassCompositionItem): string {
  return `${item.standardId}:${item.certifiedValueIndex}`
}

function formatNumber(value: number | null, unit: string): string {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${Number(value.toPrecision(10))} ${unit}`
}

function formatCompositionItemLabel(item: MassCompositionItem): string {
  if (!item.compositionProfile) {
    return `${item.nominal} ${item.standardName}`
  }

  const profile = item.profileKey ?? item.nominal
  const profileClass =
    item.profileClass && !profile.includes(item.profileClass)
      ? ` (${item.profileClass})`
      : ''

  return `Perfil ${profile}${profileClass}`
}

function formatCompositionSummary(
  composition: MassCompositionValue | null,
  formatUnit: string,
  toFormatUnit: (valueInTargetUnit: number) => number,
): { equation: string; total: string } | null {
  if (!composition || composition.items.length === 0) return null

  const equation = composition.items
    .map((item) => `${item.quantity} × ${formatCompositionItemLabel(item)}`)
    .join(' + ')

  return {
    equation,
    total: formatNumber(
      toFormatUnit(composition.totals.certifiedValue),
      formatUnit,
    ),
  }
}

function optionSearchText(option: MassCompositionOption): string {
  return normalizeSearchText(
    [
      option.optionLabel,
      option.nominal,
      option.standardName,
      option.certificateNumber,
      option.profileKey,
      option.profileClass,
    ]
      .filter(Boolean)
      .join(' '),
  )
}

const DELTA_TONE: Record<MassDeltaStatus, string> = {
  met: 'text-emerald-600 dark:text-emerald-400',
  short: 'text-amber-600 dark:text-amber-400',
  over: 'text-destructive',
  unknown: 'text-muted-foreground',
}

export function MassCompositionCell({
  value,
  onChange,
  options,
  config,
  disabled = false,
  presentation = 'cell',
  target = null,
  previousComposition = null,
  displayUnit = null,
}: MassCompositionCellProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [manualTarget, setManualTarget] = useState('')
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null)
  const [expandedItemKey, setExpandedItemKey] = useState<string | null>(null)
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>(
    {},
  )
  const [lastSuggestionNote, setLastSuggestionNote] = useState<string | null>(
    null,
  )
  const searchRef = useRef<HTMLInputElement>(null)

  const composition = isMassCompositionValue(value) ? value : null
  const isFieldPresentation = presentation === 'field'
  const targetUnit = config?.targetUnit ?? composition?.targetUnit ?? 'g'
  const normalizedTargetUnit = normalizeMassUnit(targetUnit) ?? 'g'
  const optionSource = config?.optionSource ?? 'certified_values'

  // Present totals/target in the asset's display unit (e.g. kg) to match the
  // execution table cells, while all math stays in the canonical target unit.
  const formatUnit: MassUnit =
    displayUnit != null && isMassUnit(displayUnit)
      ? displayUnit
      : normalizedTargetUnit
  const toFormatUnit = (valueInTargetUnit: number): number =>
    convertMassValue(valueInTargetUnit, normalizedTargetUnit, formatUnit) ??
    valueInTargetUnit
  const formatTargetNumber = (valueInTargetUnit: number | null): string =>
    valueInTargetUnit == null
      ? '-'
      : formatNumber(toFormatUnit(valueInTargetUnit), formatUnit)

  const resolvedTarget = useMemo(() => {
    if (!target) return null
    return convertMassValue(target.value, target.unit, normalizedTargetUnit)
  }, [target, normalizedTargetUnit])

  const visibleOptions = useMemo(
    () =>
      options.filter((option) =>
        optionSource === 'composition_profiles'
          ? option.compositionProfile === true
          : option.compositionProfile !== true,
      ),
    [optionSource, options],
  )

  const sortedOptions = useMemo(
    () => sortMassOptionsDesc(visibleOptions, normalizedTargetUnit),
    [visibleOptions, normalizedTargetUnit],
  )

  const { quantity: quickQuantity, query: quickQuery } = parseQuickAdd(search)

  const filteredOptions = useMemo(() => {
    const needle = normalizeSearchText(quickQuery)
    if (needle === '') return sortedOptions
    return sortedOptions.filter((option) =>
      optionSearchText(option).includes(needle),
    )
  }, [sortedOptions, quickQuery])

  const manualTargetValue = parseNumericValue(manualTarget)
  const effectiveTarget =
    resolvedTarget != null
      ? resolvedTarget
      : manualTargetValue == null
        ? null
        : (convertMassValue(
            manualTargetValue,
            formatUnit,
            normalizedTargetUnit,
          ) ?? manualTargetValue)

  const items = useMemo(() => composition?.items ?? [], [composition])
  const quantityByKey = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of items) map.set(itemKey(item), item.quantity)
    return map
  }, [items])

  const effectiveHighlightKey =
    highlightedKey != null &&
    filteredOptions.some((option) => optionKey(option) === highlightedKey)
      ? highlightedKey
      : (filteredOptions[0] && optionKey(filteredOptions[0])) || null

  const total = composition?.totals.certifiedValue ?? 0
  const delta = describeMassDelta(
    toFormatUnit(total),
    effectiveTarget == null ? null : toFormatUnit(effectiveTarget),
    formatUnit,
  )

  const compositionSummary = formatCompositionSummary(
    composition,
    formatUnit,
    toFormatUnit,
  )
  const canSuggest = effectiveTarget != null && visibleOptions.length > 0

  const commitItems = (nextItems: MassCompositionItem[]) => {
    onChange(
      nextItems.length > 0
        ? buildMassCompositionValue(nextItems, normalizedTargetUnit, config)
        : null,
    )
  }

  const addOrIncrement = (option: MassCompositionOption, quantity: number) => {
    setLastSuggestionNote(null)
    const key = optionKey(option)
    const existingIndex = items.findIndex((item) => itemKey(item) === key)
    if (existingIndex >= 0) {
      commitItems(
        items.map((item, index) =>
          index === existingIndex
            ? { ...item, quantity: item.quantity + quantity }
            : item,
        ),
      )
      return
    }
    commitItems([...items, massCompositionItemFromOption(option, quantity)])
  }

  // Drafts are keyed by item index, so any removal shifts the keys — clear them
  // to avoid a stale draft briefly rendering against the wrong row.
  const removeItemAt = (index: number) => {
    setLastSuggestionNote(null)
    setQuantityDrafts({})
    commitItems(items.filter((_, i) => i !== index))
  }

  const setItemQuantity = (index: number, quantity: number) => {
    setLastSuggestionNote(null)
    if (!Number.isInteger(quantity) || quantity < 1) {
      removeItemAt(index)
      return
    }
    commitItems(
      items.map((item, i) => (i === index ? { ...item, quantity } : item)),
    )
  }

  const applySuggestion = () => {
    if (effectiveTarget == null) return
    const suggestion = suggestMassComposition(
      effectiveTarget,
      normalizedTargetUnit,
      visibleOptions,
    )
    if (!suggestion) return
    setQuantityDrafts({})
    commitItems(suggestion.items)
    setLastSuggestionNote(
      suggestion.exact
        ? null
        : `Sugestão mais próxima: ${
            describeMassDelta(
              toFormatUnit(suggestion.total),
              effectiveTarget == null ? null : toFormatUnit(effectiveTarget),
              formatUnit,
            ).text
          }.`,
    )
  }

  const copyPrevious = () => {
    if (!previousComposition) return
    setLastSuggestionNote(null)
    setQuantityDrafts({})
    commitItems(previousComposition.items.map((item) => ({ ...item })))
  }

  const resetDialogState = () => {
    setSearch('')
    setManualTarget('')
    setHighlightedKey(null)
    setExpandedItemKey(null)
    setQuantityDrafts({})
    setLastSuggestionNote(null)
  }

  const focusSearch = () => {
    searchRef.current?.focus()
  }

  const handleSearchKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === 'Enter') {
      const option = filteredOptions.find(
        (candidate) => optionKey(candidate) === effectiveHighlightKey,
      )
      if (option) {
        addOrIncrement(option, quickQuantity)
        setSearch('')
        setHighlightedKey(null)
      }
      event.preventDefault()
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (filteredOptions.length === 0) return
      const currentIndex = filteredOptions.findIndex(
        (option) => optionKey(option) === effectiveHighlightKey,
      )
      const offset = event.key === 'ArrowDown' ? 1 : -1
      const nextIndex =
        (currentIndex + offset + filteredOptions.length) %
        filteredOptions.length
      setHighlightedKey(optionKey(filteredOptions[nextIndex]))
      return
    }

    if (event.key === 'Escape' && search !== '') {
      event.preventDefault()
      event.stopPropagation()
      setSearch('')
      setHighlightedKey(null)
    }
  }

  const handleTileClick = (option: MassCompositionOption) => {
    addOrIncrement(option, 1)
    focusSearch()
  }

  return (
    <>
      <Button
        type="button"
        variant={composition || isFieldPresentation ? 'outline' : 'ghost'}
        size={isFieldPresentation ? 'default' : 'sm'}
        className={cn(
          'min-w-0 justify-start overflow-hidden text-left active:scale-[0.96]',
          isFieldPresentation
            ? 'h-auto min-h-14 w-full max-w-none whitespace-normal px-3 py-2 font-normal'
            : 'h-8 max-w-64 px-2',
        )}
        disabled={disabled}
        onClick={() => {
          resetDialogState()
          setOpen(true)
        }}
        title={composition?.label || 'Compor pesos'}
      >
        {isFieldPresentation ? (
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs font-medium text-muted-foreground">
              {composition ? 'Composição selecionada' : 'Composição dos pesos'}
            </span>
            <span
              className={cn(
                'min-w-0 text-sm leading-snug [overflow-wrap:anywhere]',
                !composition && 'text-muted-foreground',
              )}
            >
              {compositionSummary
                ? `${compositionSummary.equation} = ${compositionSummary.total}`
                : 'Compor pesos'}
            </span>
          </span>
        ) : (
          <span className="min-w-0 truncate">
            {composition?.label || 'Compor pesos'}
          </span>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="!max-w-[1000px] w-[calc(100vw-2rem)]">
          <DialogHeader>
            <DialogTitle>Composição dos pesos</DialogTitle>
            <DialogDescription>
              Clique nos pesos para compor este ponto. Use a busca para filtrar;
              digite, por exemplo, &ldquo;3x 10 kg&rdquo; para adicionar vários
              de uma vez.
            </DialogDescription>
          </DialogHeader>

          {visibleOptions.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              {optionSource === 'composition_profiles'
                ? 'Nenhum perfil de composição disponível.'
                : 'Nenhum padrão ativo com valores certificados disponível.'}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="space-y-1">
                  {resolvedTarget != null ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        Alvo
                      </span>
                      <Badge
                        variant="outline"
                        className="font-mono text-xs tabular-nums"
                      >
                        {formatTargetNumber(resolvedTarget)}
                      </Badge>
                    </div>
                  ) : (
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        Alvo (opcional)
                      </span>
                      <span className="flex items-center gap-2">
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={manualTarget}
                          onChange={(event) =>
                            setManualTarget(event.target.value)
                          }
                          placeholder="0"
                          className="h-9 w-28"
                        />
                        <span className="text-xs text-muted-foreground">
                          {formatUnit}
                        </span>
                      </span>
                    </label>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {previousComposition ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={copyPrevious}
                    >
                      <HugeiconsIcon icon={RepeatIcon} className="h-4 w-4" />
                      Repetir linha anterior
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={applySuggestion}
                    disabled={!canSuggest}
                    title={
                      canSuggest
                        ? undefined
                        : 'Informe um alvo para sugerir a composição.'
                    }
                  >
                    <HugeiconsIcon icon={MagicWand01Icon} className="h-4 w-4" />
                    Sugerir composição
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-md bg-muted/30 p-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Total
                  </span>
                  <span className="font-mono text-sm tabular-nums">
                    {formatTargetNumber(total)}
                  </span>
                </div>
                {effectiveTarget != null ? (
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Alvo
                    </span>
                    <span className="font-mono text-sm tabular-nums">
                      {formatTargetNumber(effectiveTarget)}
                    </span>
                  </div>
                ) : null}
                <span
                  className={cn(
                    'text-sm font-medium',
                    DELTA_TONE[delta.status],
                  )}
                >
                  {delta.text}
                </span>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    ref={searchRef}
                    type="text"
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value)
                      setHighlightedKey(null)
                    }}
                    onKeyDown={handleSearchKeyDown}
                    placeholder={
                      optionSource === 'composition_profiles'
                        ? 'Buscar perfil — "3x 10 kg" adiciona vários'
                        : 'Buscar peso — "3x 10 kg" adiciona vários'
                    }
                    autoFocus
                    className="h-9"
                  />
                  <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
                    <Kbd>Enter</Kbd> adiciona
                  </span>
                </div>

                {filteredOptions.length === 0 ? (
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    Nenhum peso encontrado.
                  </div>
                ) : (
                  <div className="grid max-h-[38vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 lg:grid-cols-5">
                    {filteredOptions.map((option) => {
                      const key = optionKey(option)
                      const inComposition = quantityByKey.get(key)
                      const convertedValue = optionValueIn(
                        option,
                        normalizedTargetUnit,
                      )
                      return (
                        <Button
                          key={key}
                          type="button"
                          variant="outline"
                          onClick={() => handleTileClick(option)}
                          title={`${formatNumber(option.value, option.unit)} · u ${formatNumber(
                            option.uncertainty,
                            option.unit,
                          )}${
                            option.certificateNumber
                              ? ` · Cert. ${option.certificateNumber}`
                              : ''
                          }`}
                          className={cn(
                            'h-auto flex-col items-start gap-0.5 px-2.5 py-2 text-left',
                            key === effectiveHighlightKey && 'ring-2 ring-ring',
                          )}
                        >
                          <span className="flex w-full min-w-0 items-center gap-1">
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">
                              {option.profileKey ?? option.nominal}
                            </span>
                            {inComposition ? (
                              <Badge className="h-5 shrink-0 px-1.5 text-[10px] tabular-nums">
                                ×{inComposition}
                              </Badge>
                            ) : null}
                            <Badge
                              variant="outline"
                              className="h-5 shrink-0 px-1.5 text-[10px]"
                            >
                              {option.compositionProfile
                                ? 'Perfil'
                                : option.unit}
                            </Badge>
                          </span>
                          <span className="w-full min-w-0 truncate text-[11px] font-normal text-muted-foreground">
                            {option.compositionProfile
                              ? (option.profileClass ?? 'Perfil de composição')
                              : option.standardName}
                            {option.compositionProfile &&
                            typeof option.profileQuantityAvailable === 'number'
                              ? ` · disp. ${option.profileQuantityAvailable}`
                              : ''}
                          </span>
                          <span className="w-full truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                            {formatNumber(
                              convertedValue ?? option.value,
                              normalizedTargetUnit,
                            )}
                          </span>
                        </Button>
                      )
                    })}
                  </div>
                )}
                {lastSuggestionNote ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {lastSuggestionNote}
                  </p>
                ) : null}
              </div>

              {items.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  Nenhum peso adicionado para este ponto.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {items.map((item, index) => {
                    const key = `${itemKey(item)}:${index}`
                    const isExpanded = expandedItemKey === key
                    const subtotal = item.quantity * item.value
                    return (
                      <div key={key} className="rounded-md border">
                        <div className="flex items-center gap-2 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {formatCompositionItemLabel(item)}
                            </p>
                            <p className="font-mono text-xs tabular-nums text-muted-foreground">
                              {item.quantity} × {item.value} {item.unit} ={' '}
                              {formatNumber(subtotal, item.unit)}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() =>
                                setItemQuantity(index, item.quantity - 1)
                              }
                              aria-label="Diminuir quantidade"
                            >
                              <HugeiconsIcon
                                icon={MinusSignIcon}
                                className="h-3.5 w-3.5"
                              />
                            </Button>
                            <Input
                              type="number"
                              inputMode="numeric"
                              min={1}
                              step={1}
                              value={
                                quantityDrafts[key] ?? String(item.quantity)
                              }
                              onChange={(event) => {
                                const next = event.target.value
                                setQuantityDrafts((drafts) => ({
                                  ...drafts,
                                  [key]: next,
                                }))
                                const parsed = Number.parseInt(next, 10)
                                if (Number.isInteger(parsed) && parsed >= 1) {
                                  setItemQuantity(index, parsed)
                                }
                              }}
                              onBlur={() =>
                                setQuantityDrafts((drafts) => {
                                  const { [key]: _omit, ...rest } = drafts
                                  return rest
                                })
                              }
                              className="h-7 w-14 text-center"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() =>
                                setItemQuantity(index, item.quantity + 1)
                              }
                              aria-label="Aumentar quantidade"
                            >
                              <HugeiconsIcon
                                icon={Add01Icon}
                                className="h-3.5 w-3.5"
                              />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() =>
                                setExpandedItemKey(isExpanded ? null : key)
                              }
                              aria-label="Detalhes do padrão"
                              aria-expanded={isExpanded}
                            >
                              <HugeiconsIcon
                                icon={ArrowDown01Icon}
                                className={cn(
                                  'h-4 w-4 transition-transform',
                                  isExpanded && 'rotate-180',
                                )}
                              />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => removeItemAt(index)}
                              aria-label="Remover peso"
                            >
                              <HugeiconsIcon
                                icon={Delete02Icon}
                                className="h-4 w-4"
                              />
                            </Button>
                          </div>
                        </div>
                        {isExpanded ? (
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-b-md bg-muted/30 px-3 py-2 text-xs sm:grid-cols-3">
                            <p>
                              <span className="text-muted-foreground">
                                Certificado:{' '}
                              </span>
                              {item.certificateNumber}
                            </p>
                            <p>
                              <span className="text-muted-foreground">
                                Incerteza:{' '}
                              </span>
                              <span className="font-mono">
                                {item.uncertainty} {item.unit}
                              </span>
                            </p>
                            <p>
                              <span className="text-muted-foreground">k: </span>
                              <span className="font-mono">
                                {item.coverageFactor}
                              </span>
                            </p>
                            <p>
                              <span className="text-muted-foreground">
                                Erro:{' '}
                              </span>
                              <span className="font-mono">
                                {formatNumber(item.maxError ?? null, item.unit)}
                              </span>
                            </p>
                            <p>
                              <span className="text-muted-foreground">
                                Deriva:{' '}
                              </span>
                              <span className="font-mono">
                                {formatNumber(item.drift ?? null, item.unit)}
                              </span>
                            </p>
                            <p>
                              <span className="text-muted-foreground">
                                Empuxo:{' '}
                              </span>
                              <span className="font-mono">
                                {formatNumber(item.buoyancy ?? null, item.unit)}
                              </span>
                            </p>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )}

              {composition && (
                <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-sm md:grid-cols-2 xl:grid-cols-5">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Valor certificado
                    </p>
                    <p className="font-mono">
                      {formatTargetNumber(composition.totals.certifiedValue)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Incerteza expandida
                    </p>
                    <p className="font-mono">
                      {formatTargetNumber(
                        composition.totals.expandedUncertainty,
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Erro máximo</p>
                    <p className="font-mono">
                      {formatTargetNumber(composition.totals.maxError)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Deriva</p>
                    <p className="font-mono">
                      {formatTargetNumber(composition.totals.drift)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Empuxo</p>
                    <p className="font-mono">
                      {formatTargetNumber(composition.totals.buoyancy)}
                    </p>
                  </div>
                </div>
              )}

              {composition?.warnings.length ? (
                <div className="flex flex-wrap gap-2">
                  {composition.warnings.map((warning) => (
                    <Badge key={warning} variant="outline">
                      {warning}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onChange(null)}
            >
              Limpar composição
            </Button>
            <Button type="button" onClick={() => setOpen(false)}>
              Concluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
