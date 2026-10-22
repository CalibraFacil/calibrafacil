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
} from '@/features/jobs/execution'
import { formatContextValue } from '../execute-page-helpers'
import type { useAssetUnitConversion } from '../use-asset-unit-conversion'

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
    <Card className="rounded-2xl border-0 bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10">
      <CardHeader className="px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-balance text-base">
            Execução oficial
          </CardTitle>
          <Badge
            variant={officialDiagnosticCount > 0 ? 'outline' : 'secondary'}
          >
            {officialDiagnosticCount} diagnóstico
            {officialDiagnosticCount === 1 ? '' : 's'}
          </Badge>
        </div>
        <CardDescription>
          Resultado persistido pelo backend para o método compilado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 px-5 pb-5 pt-0 text-xs">
        {[
          ['Method', officialExecution.methodFingerprint],
          ['Input', officialExecution.inputFingerprint],
          ['Calculation', officialExecution.calculationFingerprint],
          ['Result', officialExecution.resultFingerprint],
          ['Engine', officialExecution.engineVersion],
          ['Engine options', officialExecution.engineOptionsFingerprint],
        ].map(([label, value]) => (
          <div
            key={label}
            className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 rounded-lg bg-muted/40 px-2 py-1.5"
          >
            <span className="font-medium text-muted-foreground">{label}</span>
            <span className="min-w-0 overflow-hidden font-mono [overflow-wrap:anywhere]">
              {value || '-'}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function ExecuteResultsCard({
  open,
  onOpenChange,
  activeCalculationFormulas,
  hasOfficialResults,
  displayedFormulaResults,
  displayUnitFor,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeCalculationFormulas: MethodFormula[]
  hasOfficialResults: boolean
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
                <Badge variant={hasOfficialResults ? 'secondary' : 'outline'}>
                  {hasOfficialResults ? 'Oficial' : 'Prévia local'}
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
                      <span className="block max-w-full overflow-hidden rounded-lg bg-background/80 px-2 py-1 font-mono text-sm leading-relaxed tabular-nums [overflow-wrap:anywhere]">
                        {result.displayValue}
                        {displayUnitFor(formula.unit) && (
                          <span className="text-xs text-muted-foreground ml-1">
                            {displayUnitFor(formula.unit)}
                          </span>
                        )}
                      </span>
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
