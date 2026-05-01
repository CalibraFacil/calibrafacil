import { useMemo, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, Delete02Icon } from '@hugeicons/core-free-icons'

import {
  buildMassCompositionValue,
  isMassCompositionValue,
  type MassCompositionConfig,
  type MassCompositionItem,
  type MassCompositionOption,
  type MassCompositionValue,
  type MassUnit,
} from './mass-composition-utils'

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
import { cn } from '@/lib/utils'

interface MassCompositionCellProps {
  value: unknown
  onChange: (value: MassCompositionValue | null) => void
  options: MassCompositionOption[]
  config?: MassCompositionConfig
  disabled?: boolean
  presentation?: 'cell' | 'field'
}

function optionKey(option: MassCompositionOption): string {
  return `${option.standardId}:${option.certifiedValueIndex}`
}

function formatNumber(value: number | null, unit: string): string {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${Number(value.toPrecision(10))} ${unit}`
}

export function MassCompositionCell({
  value,
  onChange,
  options,
  config,
  disabled = false,
  presentation = 'cell',
}: MassCompositionCellProps) {
  const [open, setOpen] = useState(false)
  const [selectedKey, setSelectedKey] = useState(() =>
    options[0] ? optionKey(options[0]) : '',
  )
  const [quantity, setQuantity] = useState('1')

  const composition = isMassCompositionValue(value) ? value : null
  const isFieldPresentation = presentation === 'field'
  const targetUnit = config?.targetUnit ?? composition?.targetUnit ?? 'g'
  const optionSource = config?.optionSource ?? 'certified_values'
  const visibleOptions = useMemo(
    () =>
      options.filter((option) =>
        optionSource === 'composition_profiles'
          ? option.compositionProfile === true
          : option.compositionProfile !== true,
      ),
    [optionSource, options],
  )
  const items = composition?.items ?? []
  const selectedOption = useMemo(
    () => visibleOptions.find((option) => optionKey(option) === selectedKey),
    [visibleOptions, selectedKey],
  )

  const commitItems = (nextItems: MassCompositionItem[]) => {
    onChange(
      nextItems.length > 0
        ? buildMassCompositionValue(nextItems, targetUnit as MassUnit)
        : null,
    )
  }

  const addItem = () => {
    const parsedQuantity = Number.parseInt(quantity, 10)
    if (
      !selectedOption ||
      !Number.isInteger(parsedQuantity) ||
      parsedQuantity < 1
    ) {
      return
    }

    const { optionLabel: _optionLabel, ...item } = selectedOption
    commitItems([...items, { ...item, quantity: parsedQuantity }])
    setQuantity('1')
  }

  const updateQuantity = (index: number, nextQuantity: string) => {
    const parsedQuantity = Number.parseInt(nextQuantity, 10)
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1) return

    commitItems(
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, quantity: parsedQuantity } : item,
      ),
    )
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
            ? 'h-8 w-full max-w-none px-2.5 font-normal'
            : 'h-8 max-w-64 px-2',
        )}
        disabled={disabled}
        onClick={() => {
          if (!selectedOption && visibleOptions[0]) {
            setSelectedKey(optionKey(visibleOptions[0]))
          }
          setOpen(true)
        }}
        title={composition?.label || 'Compor pesos'}
      >
        <span
          className={cn(
            'min-w-0 truncate',
            !composition && isFieldPresentation && 'text-muted-foreground',
          )}
        >
          {composition?.label || 'Compor pesos'}
        </span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="!max-w-[1120px] w-[calc(100vw-2rem)] overflow-visible">
          <DialogHeader>
            <DialogTitle>Composição dos pesos</DialogTitle>
            <DialogDescription>
              Selecione os padrões certificados e a quantidade usada neste
              ponto.
            </DialogDescription>
          </DialogHeader>

          <div>
            {visibleOptions.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                {optionSource === 'composition_profiles'
                  ? 'Nenhum perfil agregado de composição disponível.'
                  : 'Nenhum padrão ativo com valores certificados disponível.'}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_120px_auto]">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      {optionSource === 'composition_profiles'
                        ? 'Perfil agregado'
                        : 'Valor certificado'}
                    </label>
                    <select
                      value={selectedKey}
                      onChange={(event) => setSelectedKey(event.target.value)}
                      className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                    >
                      {visibleOptions.map((option) => (
                        <option
                          key={optionKey(option)}
                          value={optionKey(option)}
                        >
                          {option.optionLabel}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      Quantidade
                    </label>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={quantity}
                      onChange={(event) => setQuantity(event.target.value)}
                      className="h-9"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      onClick={addItem}
                      disabled={!selectedOption}
                      className="h-9"
                    >
                      <HugeiconsIcon icon={Add01Icon} className="h-4 w-4" />
                      Adicionar
                    </Button>
                  </div>
                </div>

                {items.length === 0 ? (
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    Nenhum peso adicionado para este ponto.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {items.map((item, index) => (
                      <div
                        key={`${item.standardId}:${item.certifiedValueIndex}:${index}`}
                        className="grid gap-3 rounded-md border p-3 lg:grid-cols-[88px_minmax(180px,1.3fr)_minmax(130px,0.8fr)_minmax(105px,0.55fr)_minmax(105px,0.55fr)_minmax(180px,1fr)_40px]"
                      >
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">
                            Qtd.
                          </p>
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            step={1}
                            defaultValue={item.quantity}
                            onBlur={(event) =>
                              updateQuantity(index, event.target.value)
                            }
                            className="h-8"
                          />
                        </div>
                        <div className="min-w-0 space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">
                            Padrão
                          </p>
                          <p className="break-words text-sm font-medium">
                            {item.compositionProfile
                              ? (item.profileKey ?? item.nominal)
                              : `${item.nominal} - ${item.standardName}`}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">
                            Certificado
                          </p>
                          <p className="break-words text-xs">
                            {item.certificateNumber}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">
                            Valor
                          </p>
                          <p className="font-mono text-xs">
                            {item.value} {item.unit}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">
                            Incerteza
                          </p>
                          <p className="font-mono text-xs">
                            {item.uncertainty} {item.unit}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs lg:block lg:space-y-1">
                          <p className="col-span-2 font-medium text-muted-foreground">
                            Metadados
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
                          <p>
                            <span className="text-muted-foreground">k: </span>
                            <span className="font-mono">
                              {item.coverageFactor}
                            </span>
                          </p>
                        </div>
                        <div className="flex items-start justify-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() =>
                              commitItems(items.filter((_, i) => i !== index))
                            }
                          >
                            <HugeiconsIcon
                              icon={Delete02Icon}
                              className="h-4 w-4"
                            />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {composition && (
                  <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-sm md:grid-cols-2 xl:grid-cols-5">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Valor certificado
                      </p>
                      <p className="font-mono">
                        {formatNumber(
                          composition.totals.certifiedValue,
                          targetUnit,
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Incerteza expandida
                      </p>
                      <p className="font-mono">
                        {formatNumber(
                          composition.totals.expandedUncertainty,
                          targetUnit,
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Erro máximo
                      </p>
                      <p className="font-mono">
                        {formatNumber(composition.totals.maxError, targetUnit)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Deriva</p>
                      <p className="font-mono">
                        {formatNumber(composition.totals.drift, targetUnit)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Empuxo</p>
                      <p className="font-mono">
                        {formatNumber(composition.totals.buoyancy, targetUnit)}
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
          </div>

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
