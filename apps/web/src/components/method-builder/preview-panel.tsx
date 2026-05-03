import { useCallback, useMemo, useState } from 'react'
import { createEngine, flattenForExecution } from '@calibra-facil/math-engine'
import { formatCalibrationValue } from '@calibra-facil/shared'

import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { TableInputRenderer } from './table-input-renderer'

import type { FormulaContext } from '@calibra-facil/math-engine'

import type {
  FormulaResult,
  MethodData,
  MethodInputField,
  ValidationResult,
} from './types'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Field, FieldLabel } from '@/components/ui/field'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

interface PreviewPanelProps {
  method: MethodData
  previewData: Record<string, unknown>
  onPreviewDataChange: (data: Record<string, unknown>) => void
}

export function PreviewPanel({
  method,
  previewData,
  onPreviewDataChange,
}: PreviewPanelProps) {
  const [sectionsOpen, setSectionsOpen] = useState({
    assetValues: true,
    form: true,
    results: true,
    validations: true,
    context: false,
  })
  const assetSpecFields = method.dataFields.filter(
    (field) => field.source === 'asset_spec',
  )
  const manualFields = method.dataFields.filter(
    (field) => field.source !== 'asset_spec',
  )

  // Create engine instance
  const engine = useMemo(() => createEngine(), [])

  // Flatten preview data with array preservation for vector math
  const context = useMemo(() => {
    // For table inputs, we need to extract the column arrays
    const processedData: Record<string, unknown> = {}

    for (const field of method.dataFields) {
      const value = previewData[field.key]

      if (field.type === 'table' && field.columns) {
        // Extract each column as an array for vector math (mean, std, etc.)
        // Arrays are ALWAYS included, even if empty - variables must exist in scope
        const rows = Array.isArray(value) ? value : []

        for (const col of field.columns) {
          const columnValues = rows
            .map((row: Record<string, unknown>) => {
              const cellValue = row[col.key]
              // Handle numbers directly
              if (typeof cellValue === 'number') return cellValue
              // Parse numeric strings
              if (typeof cellValue === 'string' && cellValue.trim() !== '') {
                const parsed = parseFloat(cellValue)
                return isNaN(parsed) ? null : parsed
              }
              return null
            })
            .filter((v): v is number => v !== null)

          // Always include column - empty array [] is valid
          processedData[`${field.key}_${col.key}`] = columnValues
        }
        // Also store the full array (even if empty)
        processedData[field.key] = rows
      } else if (value !== undefined && value !== '') {
        processedData[field.key] = value
      }
    }

    return flattenForExecution(processedData, { preserveArrays: true })
  }, [previewData, method.dataFields])

  // Evaluate all formulas
  const formulaResults = useMemo(() => {
    const results: Record<string, FormulaResult> = {}
    const runningContext: Record<string, unknown> = { ...context }

    for (const formula of method.formulas) {
      const result = engine.evaluateFormula({
        formula: formula.expression,
        context: runningContext as FormulaContext,
      })

      if (result.success) {
        // Store the RAW result (string/number/array) to preserve BigNumber precision
        // This prevents "Cannot convert >15 significant digits to BigNumber" errors
        const rawValue = result.data.result

        // Format for display
        const displayValue = formatCalibrationValue(rawValue, {
          wrapArrays: true,
        })

        results[formula.outputKey] = {
          value: rawValue, // Store raw value (fixes arrays showing "-")
          displayValue,
        }

        // CRITICAL: Inject RAW result back into context for subsequent formulas
        // Passing string/array prevents BigNumber conversion errors with messy floats
        // mathjs handles string-to-BigNumber conversion safely
        runningContext[formula.outputKey] = rawValue
      } else {
        results[formula.outputKey] = {
          error: result.error.message,
        }
      }
    }

    return results
  }, [engine, method.formulas, context])

  // Evaluate validations
  const validationResults = useMemo((): Array<ValidationResult> => {
    // Build context with formula results
    // Use Record<string, unknown> to allow mixed types (strings, numbers, arrays)
    // mathjs handles string-to-BigNumber conversion safely at runtime
    const fullContext: Record<string, unknown> = { ...context }
    for (const [key, result] of Object.entries(formulaResults)) {
      if (result.value !== undefined) {
        fullContext[key] = result.value
      }
    }

    return method.validations.map((validation) => {
      const result = engine.evaluateFormula({
        formula: validation.expression,
        context: fullContext as FormulaContext,
      })

      if (result.success) {
        const passed = Boolean(result.data.resultAsNumber)
        return {
          expression: validation.expression,
          message: validation.message,
          severity: validation.severity,
          passed,
        }
      }
      return {
        expression: validation.expression,
        message: validation.message,
        severity: validation.severity,
        error: result.error.message,
      }
    })
  }, [engine, method.validations, context, formulaResults])

  // Update preview data for a field
  const updateField = useCallback(
    (key: string, value: unknown) => {
      onPreviewDataChange({
        ...previewData,
        [key]: value,
      })
    },
    [previewData, onPreviewDataChange],
  )

  // Render a single input field
  const renderField = (field: MethodInputField) => {
    const value = previewData[field.key]

    if (field.type === 'table') {
      return (
        <Field key={field.key}>
          <FieldLabel>
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </FieldLabel>
          <TableInputRenderer
            field={field}
            value={(value as Array<Record<string, unknown>>) || []}
            onChange={(newValue) => updateField(field.key, newValue)}
          />
        </Field>
      )
    }

    if (field.type === 'select' && field.options) {
      return (
        <Field key={field.key}>
          <FieldLabel>
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </FieldLabel>
          <Select
            value={(value as string) || ''}
            onValueChange={(v) => updateField(field.key, v)}
          >
            <SelectTrigger>
              <span>{(value as string) || 'Selecione…'}</span>
            </SelectTrigger>
            <SelectContent>
              {field.options.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )
    }

    if (field.type === 'number') {
      return (
        <Field key={field.key}>
          <FieldLabel>
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </FieldLabel>
          <div className="flex">
            <Input
              name={field.key}
              type="number"
              inputMode="decimal"
              step="any"
              value={(value as number) ?? ''}
              onChange={(e) => {
                const val = e.target.value
                if (val === '') {
                  updateField(field.key, '')
                } else {
                  const parsed = parseFloat(val)
                  updateField(field.key, isNaN(parsed) ? '' : parsed)
                }
              }}
              className={field.unit ? 'rounded-r-none' : ''}
              autoComplete="off"
            />
            {field.unit && (
              <span className="inline-flex items-center px-3 text-sm text-muted-foreground bg-muted border border-l-0 border-input rounded-r-md">
                {field.unit}
              </span>
            )}
          </div>
        </Field>
      )
    }

    // Default: text input
    return (
      <Field key={field.key}>
        <FieldLabel>
          {field.label}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </FieldLabel>
        <Input
          name={field.key}
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => updateField(field.key, e.target.value)}
          autoComplete="off"
        />
      </Field>
    )
  }

  const hasAnyData = Object.keys(previewData).length > 0

  return (
    <div className="space-y-0 divide-y">
      <div className="pb-5">
        <h2 className="text-sm font-medium text-balance">Pré-visualização</h2>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">
          Digite valores de teste para ver os cálculos em tempo real.
        </p>
      </div>

      {/* Form Preview */}
      {assetSpecFields.length > 0 && (
        <Collapsible
          open={sectionsOpen.assetValues}
          onOpenChange={(open) =>
            setSectionsOpen((s) => ({ ...s, assetValues: open }))
          }
        >
          <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between gap-3 py-3 text-left hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-[color]">
            <span className="font-medium text-balance">
              Valores simulados do ativo ({assetSpecFields.length})
            </span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              aria-hidden="true"
              className={`size-4 shrink-0 text-muted-foreground transition-transform ${sectionsOpen.assetValues ? 'rotate-180' : ''}`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="pb-5">
            <div className="space-y-4">{assetSpecFields.map(renderField)}</div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <Collapsible
        open={sectionsOpen.form}
        onOpenChange={(open) => setSectionsOpen((s) => ({ ...s, form: open }))}
      >
        <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between gap-3 py-3 text-left hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-[color]">
          <span className="font-medium text-balance">
            Formulário ({manualFields.length} campos)
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            aria-hidden="true"
            className={`size-4 shrink-0 text-muted-foreground transition-transform ${sectionsOpen.form ? 'rotate-180' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pb-5">
          {manualFields.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground text-pretty">
              Adicione campos de entrada para visualizar o formulário.
            </p>
          ) : (
            <div className="space-y-4">{manualFields.map(renderField)}</div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Formula Results */}
      <Collapsible
        open={sectionsOpen.results}
        onOpenChange={(open) =>
          setSectionsOpen((s) => ({ ...s, results: open }))
        }
      >
        <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between gap-3 py-3 text-left hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-[color]">
          <span className="font-medium text-balance">
            Resultados ({method.formulas.length} fórmulas)
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            aria-hidden="true"
            className={`size-4 shrink-0 text-muted-foreground transition-transform ${sectionsOpen.results ? 'rotate-180' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pb-5">
          {method.formulas.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground text-pretty">
              Adicione fórmulas para ver os cálculos.
            </p>
          ) : !hasAnyData ? (
            <p className="py-2 text-sm text-muted-foreground text-pretty">
              Digite valores no formulário para ver os resultados.
            </p>
          ) : (
            <div className="divide-y">
              {method.formulas.map((formula) => {
                const result = formulaResults[formula.outputKey]
                return (
                  <div key={formula.outputKey} className="py-3">
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <span className="truncate font-medium">
                        {formula.label || formula.outputKey}
                      </span>
                      {result?.error ? (
                        <Badge variant="destructive">Erro</Badge>
                      ) : result?.value !== undefined ? (
                        <span className="shrink-0 font-mono text-lg tabular-nums">
                          {result.displayValue}
                          {formula.unit && (
                            <span className="text-sm text-muted-foreground ml-1">
                              {formula.unit}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </div>
                    {result?.error && (
                      <p className="text-xs text-red-500 mt-1">
                        {result.error}
                      </p>
                    )}
                    <code className="mt-1 block truncate rounded-md bg-muted/50 px-2 py-1 font-mono text-xs text-muted-foreground">
                      {formula.expression}
                    </code>
                  </div>
                )
              })}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Validation Results */}
      <Collapsible
        open={sectionsOpen.validations}
        onOpenChange={(open) =>
          setSectionsOpen((s) => ({ ...s, validations: open }))
        }
      >
        <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between gap-3 py-3 text-left hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-[color]">
          <span className="font-medium text-balance">
            Validações ({method.validations.length})
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            aria-hidden="true"
            className={`size-4 shrink-0 text-muted-foreground transition-transform ${sectionsOpen.validations ? 'rotate-180' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pb-5">
          {method.validations.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground text-pretty">
              Adicione critérios de aceitação para validar os resultados.
            </p>
          ) : !hasAnyData ? (
            <p className="py-2 text-sm text-muted-foreground text-pretty">
              Digite valores no formulário para ver as validações.
            </p>
          ) : (
            <div className="space-y-2">
              {validationResults.map((result, index) => (
                <div
                  key={index}
                  className={`p-2 border rounded ${
                    result.error
                      ? 'bg-amber-50 border-amber-200'
                      : result.passed
                        ? 'bg-green-50 border-green-200'
                        : result.severity === 'error'
                          ? 'bg-red-50 border-red-200'
                          : 'bg-amber-50 border-amber-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {result.error ? (
                      <Badge variant="outline">Erro</Badge>
                    ) : result.passed ? (
                      <Badge variant="default" className="bg-green-600">
                        Aprovado
                      </Badge>
                    ) : (
                      <Badge
                        variant="destructive"
                        className={
                          result.severity === 'warning'
                            ? 'bg-amber-500'
                            : undefined
                        }
                      >
                        {result.severity === 'error' ? 'Reprovado' : 'Aviso'}
                      </Badge>
                    )}
                    <span className="text-sm">{result.message}</span>
                  </div>
                  {result.error && (
                    <p className="text-xs text-amber-600 mt-1">
                      {result.error}
                    </p>
                  )}
                  <code className="text-xs text-muted-foreground block mt-1">
                    {result.expression}
                  </code>
                </div>
              ))}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Context Debug */}
      <Collapsible
        open={sectionsOpen.context}
        onOpenChange={(open) =>
          setSectionsOpen((s) => ({ ...s, context: open }))
        }
      >
        <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between gap-3 py-3 text-left hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-[color]">
          <span className="font-medium text-muted-foreground">
            Debug: Contexto
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            aria-hidden="true"
            className={`size-4 shrink-0 text-muted-foreground transition-transform ${sectionsOpen.context ? 'rotate-180' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pb-5">
          <pre className="max-h-48 overflow-auto rounded-md bg-muted/50 p-2 text-xs">
            {JSON.stringify(context, null, 2)}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
