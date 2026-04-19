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
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
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
    value: 'A',
    label: 'Superior',
    diagramLabel: 'A',
    className: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2',
  },
  {
    value: 'B',
    label: 'Lateral Direito',
    diagramLabel: 'B',
    className: 'right-0 top-1/2 -translate-y-1/2 translate-x-1/2',
  },
  {
    value: 'C',
    label: 'Inferior',
    diagramLabel: 'C',
    className: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2',
  },
  {
    value: 'D',
    label: 'Lateral Esquerdo',
    diagramLabel: 'D',
    className: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2',
  },
  {
    value: 'E',
    label: 'Centro',
    diagramLabel: 'E',
    className: 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
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
    ? `${option.value} - ${option.label}`
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
  disabled?: boolean
  readOnly?: boolean
  className?: string
}

export function EccentricityIndicator({
  value = null,
  onChange,
  variant = 'circular_platform',
  disabled = false,
  readOnly = false,
  className,
}: EccentricityIndicatorProps) {
  const options = getEccentricityIndicatorOptions(variant)
  const selectedOption = options.find((option) => option.value === value)
  const isInteractive = !disabled && !readOnly && Boolean(onChange)

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
            Informe onde o módulo de display/indicador está localizado no
            instrumento.
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
                            aria-label={`${option.value} - ${option.label}. ${getPointDescription(option.value, variant)}`}
                            aria-disabled={!isInteractive}
                            title={`${option.value} - ${option.label}: ${getPointDescription(option.value, variant)}`}
                            onClick={() => togglePosition(option.value)}
                            className={cn(
                              'mx-auto flex size-11 items-center justify-center rounded-md border bg-background text-sm font-semibold shadow-xs transition-colors',
                              'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
                              selected
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border text-foreground hover:bg-muted',
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
            <div className="relative aspect-square w-full max-w-64">
              <div
                className="absolute inset-0 rounded-full border-2 border-border bg-muted/20"
                aria-hidden="true"
              />
              <div
                className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border"
                aria-hidden="true"
              />
              <div
                className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-border"
                aria-hidden="true"
              />

              {options.map((option) => {
                const selected = value === option.value

                return (
                  <Tooltip key={option.value}>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          aria-pressed={selected}
                          aria-label={`${option.value} - ${option.label}. ${getPointDescription(option.value, variant)}`}
                          aria-disabled={!isInteractive}
                          title={`${option.value} - ${option.label}: ${getPointDescription(option.value, variant)}`}
                          onClick={() => togglePosition(option.value)}
                          className={cn(
                            'absolute z-10 flex size-11 items-center justify-center rounded-md border bg-background text-sm font-semibold shadow-xs transition-colors',
                            'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
                            selected
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border text-foreground hover:bg-muted',
                            !isInteractive && 'cursor-default',
                            option.className,
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
          )}
        </div>
      </div>
    </div>
  )
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
    case 'A':
      return 'Extremidade superior da plataforma'
    case 'B':
      return 'Extremidade direita da plataforma'
    case 'C':
      return 'Extremidade inferior da plataforma'
    case 'D':
      return 'Extremidade esquerda da plataforma'
    case 'E':
      return 'Centro geométrico da plataforma'
    default:
      return 'Ponto da plataforma'
  }
}

function normalizeText(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}
