import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  CheckmarkCircle02Icon,
  Alert02Icon,
} from '@hugeicons/core-free-icons'
import { Badge } from '@calibra-facil/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@calibra-facil/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@calibra-facil/ui/collapsible'
import type {
  MethodFormula,
  ValidationResult,
} from '@/components/method-runtime/types'
import {
  buildExecutionFormulaContext,
  getDisplayedFormulaResults,
  getOfficialCompiledExecution,
  previewFormulaErrorMessage,
  type ExecutionResultsSource,
} from '@/features/jobs/execution'
import { formatContextValue } from '../execute-page-helpers'
import type { useAssetUnitConversion } from '../use-asset-unit-conversion'

const FINGERPRINT_LABELS = [
  ['Método', 'methodFingerprint'],
  ['Entradas', 'inputFingerprint'],
  ['Cálculo', 'calculationFingerprint'],
  ['Resultado', 'resultFingerprint'],
  ['Versão do motor', 'engineVersion'],
  ['Opções do motor', 'engineOptionsFingerprint'],
] as const

/**
 * The fingerprints that pin the persisted calculation (method, inputs,
 * result, engine). They matter to an audit, not to the technician filling the
 * worksheet, so they sit closed at the end of the side column.
 */
export function ExecuteOfficialExecutionCard({
  officialExecution,
  officialDiagnosticCount,
}: {
  officialExecution: NonNullable<
    ReturnType<typeof getOfficialCompiledExecution>
  >
  officialDiagnosticCount: number
}) {
  return (
    <Card className="rounded-2xl border-0 py-0 bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10">
      <Collapsible>
        <CollapsibleTrigger className="group w-full text-left outline-none">
          <CardHeader className="min-h-14 cursor-pointer rounded-t-2xl px-5 py-4 transition-[background-color] group-hover:bg-muted/40">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <CardTitle className="text-balance text-base">
                  Rastreabilidade do cálculo
                </CardTitle>
                {officialDiagnosticCount > 0 ? (
                  <Badge variant="outline">
                    {officialDiagnosticCount} diagnóstico
                    {officialDiagnosticCount === 1 ? '' : 's'}
                  </Badge>
                ) : null}
              </div>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className="h-4 w-4 transition-transform duration-200 group-data-[panel-open]:rotate-180"
              />
            </div>
            <CardDescription className="text-pretty">
              Identificadores do método, das entradas e do resultado salvos,
              usados na auditoria do cálculo.
            </CardDescription>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-2 px-5 pb-5 pt-0 text-xs">
            {FINGERPRINT_LABELS.map(([label, key]) => (
              <div
                key={key}
                className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 rounded-lg bg-muted/40 px-2 py-1.5"
              >
                <span className="font-medium text-muted-foreground">
                  {label}
                </span>
                <span className="min-w-0 overflow-hidden font-mono [overflow-wrap:anywhere]">
                  {officialExecution[key] || '-'}
                </span>
              </div>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

/**
 * A per-point result ("[200,002; 500,014; ...]") as one row per point,
 * instead of a bracketed vector the technician has to count through.
 */
function perPointValues(displayValue: string): string[] | null {
  const trimmed = displayValue.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null
  const values = trimmed
    .slice(1, -1)
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean)
  return values.length > 1 ? values : null
}

function FormulaResultValue({
  displayValue,
  unit,
}: {
  displayValue: string
  unit: string | null | undefined
}) {
  const points = perPointValues(displayValue)
  if (!points) {
    return (
      <span className="block max-w-full overflow-hidden rounded-lg bg-background/80 px-2 py-1 font-mono text-sm leading-relaxed tabular-nums [overflow-wrap:anywhere]">
        {displayValue}
        {unit ? (
          <span className="ml-1 text-xs text-muted-foreground">{unit}</span>
        ) : null}
      </span>
    )
  }
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded-lg bg-background/80 px-2 py-1.5 text-sm">
      {points.map((value, index) => (
        <div key={index} className="contents">
          <dt className="font-mono text-xs leading-6 text-muted-foreground">
            Ponto {index + 1}
          </dt>
          <dd className="text-right font-mono leading-6 tabular-nums">
            {value}
            {unit ? (
              <span className="ml-1 text-xs text-muted-foreground">{unit}</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** What the results badge says about where the numbers come from (F1). */
const RESULTS_SOURCE_LABEL: Record<ExecutionResultsSource, string> = {
  official: 'Oficial',
  unsaved_preview: 'Prévia (não salva)',
  preview: 'Prévia local',
}

export function ExecuteResultsCard({
  open,
  onOpenChange,
  activeCalculationFormulas,
  resultsSource,
  displayedFormulaResults,
  displayUnitFor,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeCalculationFormulas: MethodFormula[]
  resultsSource: ExecutionResultsSource
  displayedFormulaResults: ReturnType<typeof getDisplayedFormulaResults>
  displayUnitFor: ReturnType<typeof useAssetUnitConversion>['displayUnitFor']
}) {
  return (
    <Card className="rounded-2xl border-0 py-0 bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className="group w-full text-left outline-none">
          <CardHeader className="min-h-14 cursor-pointer rounded-t-2xl px-5 py-4 transition-[background-color] group-hover:bg-muted/40">
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <CardTitle className="text-balance text-base">
                  Resultados ({activeCalculationFormulas.length})
                </CardTitle>
                <Badge
                  variant={
                    resultsSource === 'official' ? 'secondary' : 'outline'
                  }
                >
                  {RESULTS_SOURCE_LABEL[resultsSource]}
                </Badge>
              </div>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
              />
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="max-h-[560px] space-y-2 overflow-auto px-5 pb-5 pt-0">
            {activeCalculationFormulas.map((formula) => {
              const result = displayedFormulaResults[formula.outputKey]
              return (
                <div
                  key={formula.outputKey}
                  className={`rounded-xl px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] transition-[background-color,box-shadow] ${
                    result?.error
                      ? 'bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-200'
                      : 'bg-muted/40 hover:bg-background hover:shadow-[inset_0_0_0_1px_rgba(0,0,0,0.07),0_8px_24px_rgba(15,23,42,0.05)]'
                  }`}
                >
                  <div className="grid min-w-0 gap-1.5">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <span className="min-w-0 text-pretty text-sm font-medium leading-snug">
                        {formula.label || formula.outputKey}
                      </span>
                      {result?.error && (
                        <Badge variant="destructive">Erro</Badge>
                      )}
                    </div>
                    {result?.error ? (
                      <p className="text-pretty text-xs text-red-600 dark:text-red-300">
                        {previewFormulaErrorMessage(result)}
                      </p>
                    ) : result?.value !== undefined ? (
                      <FormulaResultValue
                        displayValue={String(result.displayValue)}
                        unit={displayUnitFor(formula.unit)}
                      />
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

export function ExecuteValidationsCard({
  open,
  onOpenChange,
  validationResults,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  validationResults: ValidationResult[]
}) {
  return (
    <Card className="rounded-2xl border-0 py-0 bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className="group w-full text-left outline-none">
          <CardHeader className="min-h-14 cursor-pointer rounded-t-2xl px-5 py-4 transition-[background-color] group-hover:bg-muted/40">
            <div className="flex items-center justify-between">
              <CardTitle className="text-balance text-base">
                Critérios de Aceitação ({validationResults.length})
              </CardTitle>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
              />
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-2 px-5 pb-5 pt-0">
            {validationResults.map((result, idx) => (
              <div
                key={idx}
                className={`rounded-xl px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] ${
                  result.error
                    ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
                    : result.passed
                      ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
                      : result.severity === 'error'
                        ? 'bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-200'
                        : 'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  {result.error ? (
                    <Badge variant="outline">Erro</Badge>
                  ) : result.passed ? (
                    <HugeiconsIcon
                      icon={CheckmarkCircle02Icon}
                      className="h-4 w-4 text-green-600"
                    />
                  ) : (
                    <HugeiconsIcon
                      icon={Alert02Icon}
                      className={`h-4 w-4 ${result.severity === 'error' ? 'text-red-600' : 'text-amber-600'}`}
                    />
                  )}
                  <span className="text-pretty text-sm">{result.message}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

export function ExecuteCalculationContextCard({
  open,
  onOpenChange,
  context,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  context: ReturnType<typeof buildExecutionFormulaContext>
}) {
  return (
    <Card className="rounded-2xl border-0 py-0 bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className="group w-full text-left outline-none">
          <CardHeader className="min-h-14 cursor-pointer rounded-t-2xl px-5 py-4 transition-[background-color] group-hover:bg-muted/40">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <CardTitle className="text-balance text-base">
                  Contexto de cálculo
                </CardTitle>
                <Badge variant="outline" className="tabular-nums">
                  {Object.keys(context).length} variáve
                  {Object.keys(context).length === 1 ? 'l' : 'is'}
                </Badge>
              </div>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
              />
            </div>
            <CardDescription className="text-pretty">
              Variáveis e valores usados nos cálculos do método — a base de
              rastreabilidade do resultado.
            </CardDescription>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="px-5 pb-5 pt-0">
            {Object.keys(context).length > 0 ? (
              <div className="max-h-72 overflow-auto rounded-xl ring-1 ring-foreground/10">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-3 border-b bg-muted/40 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Variável</span>
                  <span>Valor</span>
                </div>
                <div className="divide-y divide-foreground/10">
                  {Object.entries(context).map(([key, value]) => (
                    <div
                      key={key}
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-3 px-3 py-2 text-xs"
                    >
                      <span
                        className="truncate font-mono text-muted-foreground"
                        title={key}
                      >
                        {key}
                      </span>
                      <span className="min-w-0 font-mono tabular-nums [overflow-wrap:anywhere]">
                        {formatContextValue(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhuma variável de contexto disponível ainda.
              </p>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
