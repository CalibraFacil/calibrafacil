import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export const ECCENTRICITY_INDICATOR_SPEC_KEY = 'eccentricityIndicatorPosition'

export type EccentricityIndicatorVariant = 'circular_platform' | 'road_scale'
export type EccentricityIndicatorPosition =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | '1'
  | '2'
  | '3'
  | '4'

type PositionOption = {
  value: EccentricityIndicatorPosition
  label: string
  diagramLabel: string
  className: string
}

export const CIRCULAR_ECCENTRICITY_INDICATOR_OPTIONS: PositionOption[] = [
  {
    value: 'top',
    label: 'Superior',
    diagramLabel: '',
    className: 'left-1/2 top-0 -translate-x-1/2',
  },
  {
    value: 'right',
    label: 'Lateral Direito',
    diagramLabel: '',
    className: 'right-0 top-1/2 -translate-y-1/2',
  },
  {
    value: 'bottom',
    label: 'Inferior',
    diagramLabel: '',
    className: 'bottom-0 left-1/2 -translate-x-1/2',
  },
  {
    value: 'left',
    label: 'Lateral Esquerdo',
    diagramLabel: '',
    className: 'left-0 top-1/2 -translate-y-1/2',
  },
]

export const ROAD_SCALE_ECCENTRICITY_INDICATOR_OPTIONS: PositionOption[] = [
  {
    value: '1',
    label: 'Seção 1',
    diagramLabel: '1',
    className: '',
  },
  {
    value: '2',
    label: 'Seção 2',
    diagramLabel: '2',
    className: '',
  },
  {
    value: '3',
    label: 'Seção 3',
    diagramLabel: '3',
    className: '',
  },
  {
    value: '4',
    label: 'Seção 4',
    diagramLabel: '4',
    className: '',
  },
]

const CIRCULAR_LOAD_POINT_CLASSES: Record<string, string> = {
  A: 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-[55%]',
  B: 'left-[39%] top-[39%] -translate-x-1/2 -translate-y-1/2',
  C: 'left-[61%] top-[39%] -translate-x-1/2 -translate-y-1/2',
  D: 'left-[61%] top-[61%] -translate-x-1/2 -translate-y-1/2',
  E: 'left-[39%] top-[61%] -translate-x-1/2 -translate-y-1/2',
}

const DEFAULT_CIRCULAR_LOAD_POINTS = Object.keys(CIRCULAR_LOAD_POINT_CLASSES)

export const ECCENTRICITY_INDICATOR_OPTIONS = [
  ...CIRCULAR_ECCENTRICITY_INDICATOR_OPTIONS,
  ...ROAD_SCALE_ECCENTRICITY_INDICATOR_OPTIONS,
]

export function getEccentricityIndicatorOptions(
  variant: EccentricityIndicatorVariant = 'circular_platform',
) {
  return variant === 'road_scale'
    ? ROAD_SCALE_ECCENTRICITY_INDICATOR_OPTIONS
    : CIRCULAR_ECCENTRICITY_INDICATOR_OPTIONS
}

export function isEccentricityIndicatorPosition(
  value: unknown,
  variant?: EccentricityIndicatorVariant,
): value is EccentricityIndicatorPosition {
  return (
    typeof value === 'string' &&
    getEccentricityIndicatorOptions(variant).some(
      (option) => option.value === value,
    )
  )
}

export function getEccentricityIndicatorLabel(
  value: EccentricityIndicatorPosition | null | undefined,
  variant: EccentricityIndicatorVariant = 'circular_platform',
) {
  const option = getEccentricityIndicatorOptions(variant).find(
    (item) => item.value === value,
  )

  return option
    ? formatPositionOptionLabel(option, variant)
    : 'Nenhum ponto selecionado'
}

export function isWeighingScaleAssetType(assetType?: {
  name?: string | null
  slug?: string | null
}) {
  const normalizedSlug = normalizeText(assetType?.slug)
  const normalizedName = normalizeText(assetType?.name)

  return (
    normalizedSlug.includes('balanca') ||
    normalizedSlug.includes('scale') ||
    normalizedName.includes('balanca') ||
    normalizedName.includes('scale')
  )
}

type EccentricityIndicatorProps = {
  value?: EccentricityIndicatorPosition | null
  onChange?: (value: EccentricityIndicatorPosition | null) => void
  variant?: EccentricityIndicatorVariant
  loadPositions?: string[]
  disabled?: boolean
  readOnly?: boolean
  className?: string
}

export function EccentricityIndicator({
  value = null,
  onChange,
  variant = 'circular_platform',
  loadPositions,
  disabled = false,
  readOnly = false,
  className,
}: EccentricityIndicatorProps) {
  const options = getEccentricityIndicatorOptions(variant)
  const selectedOption = options.find((option) => option.value === value)
  const isInteractive = !disabled && !readOnly && Boolean(onChange)
  const circularLoadPositions = loadPositions?.filter(
    (position) => position in CIRCULAR_LOAD_POINT_CLASSES,
  ).length
    ? loadPositions.filter(
        (position) => position in CIRCULAR_LOAD_POINT_CLASSES,
      )
    : DEFAULT_CIRCULAR_LOAD_POINTS

  const togglePosition = (position: EccentricityIndicatorPosition) => {
    if (!isInteractive) return
    onChange?.(value === position ? null : position)
  }

  return (
    <div className={cn('space-y-4 border-t pt-4', className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">
            Posição do indicador da balança
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {readOnly
              ? 'Definido no cadastro do ativo; esta posição não é alterada durante a execução.'
              : 'Informe onde o módulo de display/indicador está localizado no instrumento.'}
          </p>
        </div>
        <Badge variant={selectedOption ? 'default' : 'outline'}>
          {getEccentricityIndicatorLabel(value, variant)}
        </Badge>
      </div>

      <div className="grid gap-4">
        <div
          aria-label="Diagrama de excentricidade da plataforma da balança"
          className="flex justify-center px-6 py-5"
        >
          {variant === 'road_scale' ? (
            <div className="w-full max-w-xl space-y-5">
              <div className="grid h-20 grid-cols-4 items-center rounded-md border-2 border-border bg-muted/20">
                {options.map((option) => {
                  const selected = value === option.value

                  return (
                    <Tooltip key={option.value}>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            aria-pressed={selected}
                            aria-label={`${formatPositionOptionLabel(option, variant)}. ${getPointDescription(option.value, variant)}`}
                            aria-disabled={!isInteractive}
                            aria-readonly={readOnly || undefined}
                            title={`${formatPositionOptionLabel(option, variant)}: ${getPointDescription(option.value, variant)}`}
                            onClick={() => togglePosition(option.value)}
                            className={cn(
                              'mx-auto flex size-11 items-center justify-center rounded-md border bg-background text-sm font-semibold shadow-xs transition-colors',
                              'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
                              selected
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border text-foreground',
                              isInteractive && !selected && 'hover:bg-muted',
                              !isInteractive && 'cursor-default',
                            )}
                          />
                        }
                      >
                        {option.diagramLabel}
                      </TooltipTrigger>
                      <TooltipContent>
                        <span className="font-medium">
                          {option.value} - {option.label}
                        </span>
                        <span className="block text-background/80">
                          {getPointDescription(option.value, variant)}
                        </span>
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="h-8 w-24 rounded-sm border-2 border-border bg-background" />
                <span className="text-sm font-medium text-muted-foreground">
                  Posição do indicador
                </span>
              </div>
            </div>
          ) : (
            <div className="relative aspect-square w-full max-w-72">
              <div
                className="absolute inset-16 rounded-full border-2 border-border bg-muted/20"
                aria-hidden="true"
              />
              <div
                className="absolute bottom-8 left-1/2 top-8 w-px -translate-x-1/2 bg-border"
                aria-hidden="true"
              />
              <div
                className="absolute left-8 right-8 top-1/2 h-px -translate-y-1/2 bg-border"
                aria-hidden="true"
              />
              {circularLoadPositions.map((position) => (
                <span
                  key={position}
                  className={cn(
                    'absolute z-10 px-1 text-2xl font-semibold leading-none',
                    position === 'A' && 'bg-background',
                    CIRCULAR_LOAD_POINT_CLASSES[position],
                  )}
                >
                  {position}
                </span>
              ))}

              {options.map((option) => {
                const selected = value === option.value

                return (
                  <Tooltip key={option.value}>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          aria-pressed={selected}
                          aria-label={`${formatPositionOptionLabel(option, variant)}. ${getPointDescription(option.value, variant)}`}
                          aria-disabled={!isInteractive}
                          aria-readonly={readOnly || undefined}
                          title={`${formatPositionOptionLabel(option, variant)}: ${getPointDescription(option.value, variant)}`}
                          onClick={() => togglePosition(option.value)}
                          className={cn(
                            'absolute z-10 flex size-11 items-center justify-center rounded-md border text-sm font-semibold shadow-xs transition-all',
                            'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
                            selected
                              ? 'border-primary bg-primary shadow-md ring-4 ring-primary/15'
                              : 'border-border bg-background',
                            isInteractive &&
                              !selected &&
                              'hover:border-primary/50 hover:bg-muted',
                            !isInteractive && 'cursor-default',
                            option.className,
                          )}
                        >
                          <span className="sr-only">
                            {formatPositionOptionLabel(option, variant)}
                          </span>
                        </button>
                      }
                    >
                      <span className="sr-only">
                        {formatPositionOptionLabel(option, variant)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <span className="font-medium">
                        {formatPositionOptionLabel(option, variant)}
                      </span>
                      <span className="block text-background/80">
                        {getPointDescription(option.value, variant)}
                      </span>
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function formatPositionOptionLabel(
  option: PositionOption,
  variant: EccentricityIndicatorVariant,
) {
  return variant === 'road_scale'
    ? `${option.value} - ${option.label}`
    : option.label
}

function getPointDescription(
  position: EccentricityIndicatorPosition,
  variant: EccentricityIndicatorVariant,
) {
  if (variant === 'road_scale') {
    switch (position) {
      case '1':
        return 'Primeira seção da plataforma rodoviária'
      case '2':
        return 'Segunda seção da plataforma rodoviária'
      case '3':
        return 'Terceira seção da plataforma rodoviária'
      case '4':
        return 'Quarta seção da plataforma rodoviária'
      default:
        return 'Seção da plataforma rodoviária'
    }
  }

  switch (position) {
    case 'top':
      return 'Indicador posicionado acima da plataforma'
    case 'right':
      return 'Indicador posicionado à direita da plataforma'
    case 'bottom':
      return 'Indicador posicionado abaixo da plataforma'
    case 'left':
      return 'Indicador posicionado à esquerda da plataforma'
    default:
      return 'Posição do indicador'
  }
}

function normalizeText(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}
