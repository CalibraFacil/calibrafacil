import { useCallback, useMemo, useState } from 'react'
import { createEngine, flattenForExecution } from '@calibra-facil/math-engine'

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
    form: true,
    results: true,
    validations: true,
    context: false,
  })

  // Create engine instance
  const engine = useMemo(() => createEngine(), [])

  // Flatten preview data with array preservation for vector math
  const context = useMemo(() => {
    // For table inputs, we need to extract the column arrays
    const processedData: Record<string, unknown> = {}

    for (const field of method.dataFields) {
      const value = previewData[field.key]

      if (field.type === 'table' && Array.isArray(value) && field.columns) {
        // Extract each column as an array, ensuring consistent lengths for vector math
        const rowCount = value.length
        for (const col of field.columns) {
          const columnValues = value
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
          // Only include column if all rows have valid values (consistent length)
          if (columnValues.length === rowCount && columnValues.length > 0) {
            processedData[`${field.key}_${col.key}`] = columnValues
          }
        }
        // Also store the full array
        processedData[field.key] = value
      } else if (value !== undefined && value !== '') {
        processedData[field.key] = value
      }
    }

    return flattenForExecution(processedData, { preserveArrays: true })
  }, [previewData, method.dataFields])

  // Evaluate all formulas
  const formulaResults = useMemo(() => {
    const results: Record<string, FormulaResult> = {}
    const runningContext = { ...context }

    for (const formula of method.formulas) {
      const result = engine.evaluateFormula({
        formula: formula.expression,
        context: runningContext,
      })

      if (result.success) {
        results[formula.outputKey] = {
          value: result.data.resultAsNumber,
          displayValue: String(result.data.result),
        }
        // Add to running context for subsequent formulas
        runningContext[formula.outputKey] = result.data.resultAsNumber
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
    const fullContext: FormulaContext = { ...context }
    for (const [key, result] of Object.entries(formulaResults)) {
      if (result.value !== undefined) {
        fullContext[key] = result.value
      }
    }

    return method.validations.map((validation) => {
      const result = engine.evaluateFormula({
        formula: validation.expression,
        context: fullContext,
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
              <span>{(value as string) || 'Selecione...'}</span>
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
              type="number"
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
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => updateField(field.key, e.target.value)}
        />
      </Field>
    )
  }

  const hasAnyData = Object.keys(previewData).length > 0

  return (
    <div className="p-4 space-y-4">
      <h3 className="font-semibold text-lg">Pré-visualização</h3>
      <p className="text-sm text-muted-foreground">
        Digite valores de teste para ver os cálculos em tempo real.
      </p>

      {/* Form Preview */}
      <Collapsible
        open={sectionsOpen.form}
        onOpenChange={(open) => setSectionsOpen((s) => ({ ...s, form: open }))}
      >
        <CollapsibleTrigger className="flex items-center justify-between w-full p-2 hover:bg-muted/50 rounded">
          <span className="font-medium">
            Formulário ({method.dataFields.length} campos)
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className={`h-4 w-4 transition-transform ${sectionsOpen.form ? 'rotate-180' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          {method.dataFields.length === 0 ? (
            <p className="text-sm text-muted-foreground p-2">
              Adicione campos de entrada para visualizar o formulário.
            </p>
          ) : (
            <div className="space-y-4">
              {method.dataFields.map(renderField)}
            </div>
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
        <CollapsibleTrigger className="flex items-center justify-between w-full p-2 hover:bg-muted/50 rounded">
          <span className="font-medium">
            Resultados ({method.formulas.length} fórmulas)
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className={`h-4 w-4 transition-transform ${sectionsOpen.results ? 'rotate-180' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          {method.formulas.length === 0 ? (
            <p className="text-sm text-muted-foreground p-2">
              Adicione fórmulas para ver os cálculos.
            </p>
          ) : !hasAnyData ? (
            <p className="text-sm text-muted-foreground p-2">
              Digite valores no formulário para ver os resultados.
            </p>
          ) : (
            <div className="space-y-2">
              {method.formulas.map((formula) => {
                const result = formulaResults[formula.outputKey]
                return (
                  <div
                    key={formula.outputKey}
                    className="p-2 border rounded bg-muted/30"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {formula.label || formula.outputKey}
                      </span>
                      {result?.error ? (
                        <Badge variant="destructive">Erro</Badge>
                      ) : result?.value !== undefined ? (
                        <span className="font-mono text-lg">
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
                    <code className="text-xs text-muted-foreground block mt-1">
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
        <CollapsibleTrigger className="flex items-center justify-between w-full p-2 hover:bg-muted/50 rounded">
          <span className="font-medium">
            Validações ({method.validations.length})
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className={`h-4 w-4 transition-transform ${sectionsOpen.validations ? 'rotate-180' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          {method.validations.length === 0 ? (
            <p className="text-sm text-muted-foreground p-2">
              Adicione critérios de aceitação para validar os resultados.
            </p>
          ) : !hasAnyData ? (
            <p className="text-sm text-muted-foreground p-2">
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
        <CollapsibleTrigger className="flex items-center justify-between w-full p-2 hover:bg-muted/50 rounded">
          <span className="font-medium text-muted-foreground">
            Debug: Contexto
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className={`h-4 w-4 transition-transform ${sectionsOpen.context ? 'rotate-180' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-48">
            {JSON.stringify(context, null, 2)}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
