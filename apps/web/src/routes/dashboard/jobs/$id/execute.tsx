import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
    ArrowLeft01Icon,
    ArrowDown01Icon,
    CheckmarkCircle02Icon,
    Alert02Icon,
    Download01Icon,
    SentIcon,
} from '@hugeicons/core-free-icons'
import { createEngine, flattenForExecution } from '@calibra-facil/math-engine'
import type { FormulaContext } from '@calibra-facil/math-engine'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
} from '@/components/ui/select'
import { TableInputRenderer, type CertifiedValueOption } from '@/components/method-builder/table-input-renderer'
import type {
    MethodInputField,
    FormulaResult,
    ValidationResult,
} from '@/components/method-builder/types'

export const Route = createFileRoute('/dashboard/jobs/$id/execute')({
    head: () => ({
        meta: [{ title: 'Executar Calibração | CalibraFacil' }],
    }),
    component: ExecuteJobPage,
})

interface ReferenceStandard {
    id: number
    name: string
    certificateNumber: string
    calibrationDate: string
    nextCalibrationDate: string
    uncertainty: number | null
    uncertaintyUnit: string | null
    coverageFactor: number
    distribution: string
    drift: number | null
    certifiedValues: Array<{
        nominal: string
        value: number
        uncertainty: number
        unit: string
    }> | null
    status: string
    isExpired: boolean
    daysUntilExpiry: number
}

interface StandardSnapshotItem {
    id: number
    name: string
    certificateNumber: string
    calibrationDate: string
    uncertainty: number | null
    uncertaintyUnit: string | null
    coverageFactor: number
    distribution: string
    drift: number | null
    certifiedValues: Array<{
        nominal: string
        value: number
        uncertainty: number
        unit: string
    }> | null
}

interface JobData {
    id: number
    jobId: string
    status: string
    customerName: string
    assetName: string
    assetTag: string
    serviceName: string
    methodSnapshot: {
        methodId: number
        methodName: string
        methodVersion: number
        dataFields: MethodInputField[]
        formulas: Array<{ outputKey: string; expression: string; label?: string; unit?: string }>
        validations: Array<{ expression: string; message: string; severity: 'error' | 'warning' }>
        uncertaintyParams: Array<unknown>
    }
    data: Record<string, unknown> | null
    results: Record<string, unknown> | null
    standardsSnapshot?: StandardSnapshotItem[] | null
}

const statusLabels: Record<string, string> = {
    DRAFT: 'Rascunho',
    IN_PROGRESS: 'Em Execução',
    REVIEW: 'Em Revisão',
    APPROVED: 'Aprovado',
    REJECTED: 'Rejeitado',
    CANCELED: 'Cancelado',
}

function ExecuteJobPage() {
    const { id } = Route.useParams()
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    // Form state
    const [formData, setFormData] = useState<Record<string, unknown>>({})
    const [selectedStandardIds, setSelectedStandardIds] = useState<number[]>([])
    const [sectionsOpen, setSectionsOpen] = useState({
        standards: true,
        data: true,
        results: true,
        validations: true,
        debug: false,
    })

    // Math engine
    const engine = useMemo(() => createEngine(), [])

    // Fetch job data
    const { data: job, isLoading: jobLoading, error: jobError } = useQuery({
        queryKey: ['jobs', id],
        queryFn: async () => {
            const res = await api.api.jobs[':id'].$get({ param: { id } })
            if (!res.ok) throw new Error('Falha ao carregar job')
            return res.json() as Promise<JobData>
        },
    })

    // Fetch available standards
    const { data: standardsData } = useQuery({
        queryKey: ['standards', 'active'],
        queryFn: async () => {
            const res = await api.api.standards.$get({
                query: { status: 'ACTIVE', limit: '100' },
            })
            if (!res.ok) throw new Error('Falha ao carregar padrões')
            return res.json() as Promise<{ data: ReferenceStandard[] }>
        },
    })

    // Initialize form data and selected standards from job
    useEffect(() => {
        if (job?.data) {
            setFormData(job.data)
        }
        // Restore selected standard IDs from snapshot
        if (job?.standardsSnapshot && job.standardsSnapshot.length > 0) {
            const snapshotIds = job.standardsSnapshot.map((s) => s.id)
            setSelectedStandardIds(snapshotIds)
        }
    }, [job?.data, job?.standardsSnapshot])

    // Build context for math engine (including standard values)
    const context = useMemo(() => {
        if (!job) return {}

        const processedData: Record<string, unknown> = {}

        // Process form data fields
        for (const field of job.methodSnapshot.dataFields) {
            const value = formData[field.key]

            if (field.type === 'table' && field.columns) {
                const rows = Array.isArray(value) ? value : []
                for (const col of field.columns) {
                    const columnValues = rows
                        .map((row: Record<string, unknown>) => {
                            const cellValue = row[col.key]
                            if (typeof cellValue === 'number') return cellValue
                            if (typeof cellValue === 'string' && cellValue.trim() !== '') {
                                const parsed = parseFloat(cellValue)
                                return isNaN(parsed) ? null : parsed
                            }
                            return null
                        })
                        .filter((v): v is number => v !== null)
                    processedData[`${field.key}_${col.key}`] = columnValues
                }
                processedData[field.key] = rows
            } else if (value !== undefined && value !== '') {
                processedData[field.key] = value
            }
        }

        // Inject selected standard values into context
        const selectedStandards = standardsData?.data?.filter((s) =>
            selectedStandardIds.includes(s.id),
        ) || []

        for (const std of selectedStandards) {
            const prefix = `std_${std.id}`
            processedData[`${prefix}_uncertainty`] = std.uncertainty
            processedData[`${prefix}_k`] = std.coverageFactor
            processedData[`${prefix}_drift`] = std.drift

            // Flatten certified values for easy formula access
            if (std.certifiedValues) {
                for (const cv of std.certifiedValues) {
                    // Normalize nominal name (e.g., "100g" -> "100g")
                    const key = cv.nominal.replace(/\s+/g, '')
                    processedData[`${prefix}_${key}`] = cv.value
                    processedData[`${prefix}_${key}_u`] = cv.uncertainty
                }
            }
        }

        return flattenForExecution(processedData, { preserveArrays: true })
    }, [formData, job, standardsData?.data, selectedStandardIds])

    // Evaluate formulas
    const formulaResults = useMemo(() => {
        if (!job) return {}

        const results: Record<string, FormulaResult> = {}
        const runningContext: Record<string, unknown> = { ...context }

        for (const formula of job.methodSnapshot.formulas) {
            const result = engine.evaluateFormula({
                formula: formula.expression,
                context: runningContext as FormulaContext,
            })

            if (result.success) {
                const rawValue = result.data.result
                let displayValue: string
                if (Array.isArray(rawValue)) {
                    displayValue = `[${rawValue.map((v) => String(v)).join(', ')}]`
                } else {
                    displayValue = String(rawValue)
                }

                results[formula.outputKey] = { value: rawValue, displayValue }
                runningContext[formula.outputKey] = rawValue
            } else {
                results[formula.outputKey] = { error: result.error.message }
            }
        }

        return results
    }, [engine, job, context])

    // Evaluate validations
    const validationResults = useMemo((): ValidationResult[] => {
        if (!job) return []

        const fullContext: Record<string, unknown> = { ...context }
        for (const [key, result] of Object.entries(formulaResults)) {
            if (result.value !== undefined) {
                fullContext[key] = result.value
            }
        }

        return job.methodSnapshot.validations.map((validation) => {
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
    }, [engine, job, context, formulaResults])

    // Compute certified value options from selected standards
    const certifiedValueOptions = useMemo((): CertifiedValueOption[] => {
        const options: CertifiedValueOption[] = []
        const selectedStandards = standardsData?.data?.filter((s) =>
            selectedStandardIds.includes(s.id)
        ) || []

        for (const std of selectedStandards) {
            if (std.certifiedValues) {
                for (const cv of std.certifiedValues) {
                    options.push({
                        label: cv.nominal,
                        value: cv.value,
                        uncertainty: cv.uncertainty,
                        unit: cv.unit,
                        standardName: std.name,
                    })
                }
            }
        }
        return options
    }, [standardsData?.data, selectedStandardIds])

    // Update field
    const updateField = useCallback((key: string, value: unknown) => {
        setFormData((prev) => ({ ...prev, [key]: value }))
    }, [])

    // Save draft mutation
    const saveMutation = useMutation({
        mutationFn: async () => {
            const res = await api.api.jobs[':id'].execute.$post({
                param: { id },
                json: {
                    selectedStandardIds,
                    data: formData,
                    results: Object.fromEntries(
                        Object.entries(formulaResults)
                            .filter(([, r]) => r.value !== undefined)
                            .map(([k, r]) => [k, r.value]),
                    ),
                },
            })
            if (!res.ok) {
                const error = await res.json()
                throw new Error((error as { error?: string }).error || 'Erro ao salvar')
            }
            return res.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['jobs', id] })
            toast.success('Dados salvos com sucesso!')
        },
        onError: (error) => {
            toast.error(error.message)
        },
    })

    // Submit for review mutation
    const submitMutation = useMutation({
        mutationFn: async () => {
            const res = await api.api.jobs[':id'].submit.$post({
                param: { id },
                json: { data: formData },
            })
            if (!res.ok) {
                const error = await res.json()
                throw new Error((error as { error?: string }).error || 'Erro ao submeter')
            }
            return res.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['jobs'] })
            toast.success('Job enviado para revisão!')
            navigate({ to: '/dashboard/jobs' })
        },
        onError: (error) => {
            toast.error(error.message)
        },
    })

    // Render field
    const renderField = (field: MethodInputField) => {
        const value = formData[field.key]

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
                        certifiedValueOptions={certifiedValueOptions}
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
                            type="text"
                            inputMode="decimal"
                            value={value != null ? String(value) : ''}
                            onChange={(e) => {
                                const val = e.target.value
                                // Allow empty, numbers, decimal points, and negative sign
                                // Keep as string to preserve trailing decimals during typing
                                if (val === '' || /^-?\d*[.,]?\d*$/.test(val)) {
                                    // Normalize comma to period for consistency
                                    const normalized = val.replace(',', '.')
                                    updateField(field.key, normalized)
                                }
                            }}
                            onBlur={(e) => {
                                // Parse to number on blur if valid
                                const val = e.target.value.replace(',', '.')
                                if (val !== '' && val !== '-' && val !== '.') {
                                    const parsed = parseFloat(val)
                                    if (!isNaN(parsed)) {
                                        updateField(field.key, parsed)
                                    }
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

    // Toggle standard selection
    const toggleStandard = (standardId: number) => {
        setSelectedStandardIds((prev) =>
            prev.includes(standardId)
                ? prev.filter((id) => id !== standardId)
                : [...prev, standardId],
        )
    }

    // Check if can submit
    const canSubmit = useMemo(() => {
        if (!job) return false
        const hasRequiredFields = job.methodSnapshot.dataFields
            .filter((f) => f.required)
            .every((f) => {
                const val = formData[f.key]
                return val !== undefined && val !== ''
            })
        const hasNoErrors = validationResults.every(
            (v) => v.passed || v.severity !== 'error' || v.error,
        )
        return hasRequiredFields && hasNoErrors
    }, [job, formData, validationResults])

    if (jobError) {
        return (
            <Card>
                <CardContent className="pt-6">
                    <p className="text-red-500">Erro ao carregar job: {jobError.message}</p>
                </CardContent>
            </Card>
        )
    }

    if (jobLoading || !job) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-8 w-48" />
                <Card>
                    <CardContent className="pt-6 space-y-4">
                        <Skeleton className="h-6 w-full" />
                        <Skeleton className="h-6 w-3/4" />
                        <Skeleton className="h-6 w-1/2" />
                    </CardContent>
                </Card>
            </div>
        )
    }

    const isEditable = ['DRAFT', 'IN_PROGRESS', 'REJECTED'].includes(job.status)

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate({ to: '/dashboard/jobs' })}
                    >
                        <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 h-4 w-4" />
                        Voltar
                    </Button>
                    <div>
                        <h1 className="text-xl font-bold">{job.jobId}</h1>
                        <p className="text-sm text-muted-foreground">
                            {job.customerName} • {job.assetName} ({job.assetTag})
                        </p>
                    </div>
                    <Badge>{statusLabels[job.status]}</Badge>
                </div>

                {isEditable && (
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            onClick={() => saveMutation.mutate()}
                            disabled={saveMutation.isPending}
                        >
                            <HugeiconsIcon icon={Download01Icon} className="mr-2 h-4 w-4" />
                            {saveMutation.isPending ? 'Salvando...' : 'Salvar Rascunho'}
                        </Button>
                        <Button
                            onClick={() => submitMutation.mutate()}
                            disabled={submitMutation.isPending || !canSubmit}
                        >
                            <HugeiconsIcon icon={SentIcon} className="mr-2 h-4 w-4" />
                            {submitMutation.isPending ? 'Enviando...' : 'Enviar para Revisão'}
                        </Button>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Left Column: Data Entry */}
                <div className="lg:col-span-2 space-y-4">
                    {/* Reference Standards */}
                    <Card>
                        <Collapsible
                            open={sectionsOpen.standards}
                            onOpenChange={(open) =>
                                setSectionsOpen((s) => ({ ...s, standards: open }))
                            }
                        >
                            <CollapsibleTrigger className="w-full">
                                <CardHeader className="cursor-pointer">
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-base">
                                            Padrões de Referência
                                            {selectedStandardIds.length > 0 && (
                                                <Badge variant="secondary" className="ml-2">
                                                    {selectedStandardIds.length} selecionado(s)
                                                </Badge>
                                            )}
                                        </CardTitle>
                                        <HugeiconsIcon
                                            icon={ArrowDown01Icon}
                                            className={`h-4 w-4 transition-transform ${sectionsOpen.standards ? 'rotate-180' : ''}`}
                                        />
                                    </div>
                                    <CardDescription>
                                        Selecione os padrões usados nesta calibração
                                    </CardDescription>
                                </CardHeader>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                                <CardContent className="pt-0">
                                    <div className="grid gap-2">
                                        {standardsData?.data?.map((std) => (
                                            <div
                                                key={std.id}
                                                className={`p-3 border rounded-lg cursor-pointer transition-colors ${selectedStandardIds.includes(std.id)
                                                    ? 'border-primary bg-primary/5'
                                                    : 'hover:bg-muted/50'
                                                    } ${std.isExpired ? 'opacity-50' : ''}`}
                                                onClick={() => !std.isExpired && toggleStandard(std.id)}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <span className="font-medium">{std.name}</span>
                                                        <p className="text-xs text-muted-foreground">
                                                            Cert: {std.certificateNumber}
                                                            {std.uncertainty != null &&
                                                                ` | U: ${std.uncertainty} ${std.uncertaintyUnit || ''}`}
                                                        </p>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {std.isExpired ? (
                                                            <Badge variant="destructive">Vencido</Badge>
                                                        ) : std.daysUntilExpiry <= 30 ? (
                                                            <Badge variant="outline" className="text-amber-600">
                                                                Vence em {std.daysUntilExpiry}d
                                                            </Badge>
                                                        ) : null}
                                                        {selectedStandardIds.includes(std.id) && (
                                                            <HugeiconsIcon
                                                                icon={CheckmarkCircle02Icon}
                                                                className="h-5 w-5 text-primary"
                                                            />
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </CollapsibleContent>
                        </Collapsible>
                    </Card>

                    {/* Data Entry Form */}
                    <Card>
                        <Collapsible
                            open={sectionsOpen.data}
                            onOpenChange={(open) =>
                                setSectionsOpen((s) => ({ ...s, data: open }))
                            }
                        >
                            <CollapsibleTrigger className="w-full">
                                <CardHeader className="cursor-pointer">
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-base">
                                            Dados de Medição ({job.methodSnapshot.dataFields.length})
                                        </CardTitle>
                                        <HugeiconsIcon
                                            icon={ArrowDown01Icon}
                                            className={`h-4 w-4 transition-transform ${sectionsOpen.data ? 'rotate-180' : ''}`}
                                        />
                                    </div>
                                    <CardDescription>
                                        {job.methodSnapshot.methodName} v{job.methodSnapshot.methodVersion}
                                    </CardDescription>
                                </CardHeader>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                                <CardContent className="pt-0 space-y-4">
                                    {job.methodSnapshot.dataFields.map(renderField)}
                                </CardContent>
                            </CollapsibleContent>
                        </Collapsible>
                    </Card>
                </div>

                {/* Right Column: Results & Validations */}
                <div className="space-y-4">
                    {/* Formula Results */}
                    <Card>
                        <Collapsible
                            open={sectionsOpen.results}
                            onOpenChange={(open) =>
                                setSectionsOpen((s) => ({ ...s, results: open }))
                            }
                        >
                            <CollapsibleTrigger className="w-full">
                                <CardHeader className="cursor-pointer">
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-base">
                                            Resultados ({job.methodSnapshot.formulas.length})
                                        </CardTitle>
                                        <HugeiconsIcon
                                            icon={ArrowDown01Icon}
                                            className={`h-4 w-4 transition-transform ${sectionsOpen.results ? 'rotate-180' : ''}`}
                                        />
                                    </div>
                                </CardHeader>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                                <CardContent className="pt-0 space-y-2">
                                    {job.methodSnapshot.formulas.map((formula) => {
                                        const result = formulaResults[formula.outputKey]
                                        return (
                                            <div key={formula.outputKey} className="p-2 border rounded">
                                                <div className="flex items-center justify-between">
                                                    <span className="font-medium text-sm">
                                                        {formula.label || formula.outputKey}
                                                    </span>
                                                    {result?.error ? (
                                                        <Badge variant="destructive">Erro</Badge>
                                                    ) : result?.value !== undefined ? (
                                                        <span className="font-mono text-sm">
                                                            {result.displayValue}
                                                            {formula.unit && (
                                                                <span className="text-xs text-muted-foreground ml-1">
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
                                            </div>
                                        )
                                    })}
                                </CardContent>
                            </CollapsibleContent>
                        </Collapsible>
                    </Card>

                    {/* Validations */}
                    <Card>
                        <Collapsible
                            open={sectionsOpen.validations}
                            onOpenChange={(open) =>
                                setSectionsOpen((s) => ({ ...s, validations: open }))
                            }
                        >
                            <CollapsibleTrigger className="w-full">
                                <CardHeader className="cursor-pointer">
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-base">
                                            Critérios de Aceitação ({job.methodSnapshot.validations.length})
                                        </CardTitle>
                                        <HugeiconsIcon
                                            icon={ArrowDown01Icon}
                                            className={`h-4 w-4 transition-transform ${sectionsOpen.validations ? 'rotate-180' : ''}`}
                                        />
                                    </div>
                                </CardHeader>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                                <CardContent className="pt-0 space-y-2">
                                    {validationResults.map((result, idx) => (
                                        <div
                                            key={idx}
                                            className={`p-2 border rounded ${result.error
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
                                                <span className="text-sm">{result.message}</span>
                                            </div>
                                        </div>
                                    ))}
                                </CardContent>
                            </CollapsibleContent>
                        </Collapsible>
                    </Card>

                    {/* Debug Context */}
                    <Card>
                        <Collapsible
                            open={sectionsOpen.debug}
                            onOpenChange={(open) =>
                                setSectionsOpen((s) => ({ ...s, debug: open }))
                            }
                        >
                            <CollapsibleTrigger className="w-full">
                                <CardHeader className="cursor-pointer">
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-base text-muted-foreground">
                                            Debug: Contexto
                                        </CardTitle>
                                        <HugeiconsIcon
                                            icon={ArrowDown01Icon}
                                            className={`h-4 w-4 text-muted-foreground transition-transform ${sectionsOpen.debug ? 'rotate-180' : ''}`}
                                        />
                                    </div>
                                </CardHeader>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                                <CardContent className="pt-0">
                                    <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-48">
                                        {JSON.stringify(context, null, 2)}
                                    </pre>
                                </CardContent>
                            </CollapsibleContent>
                        </Collapsible>
                    </Card>
                </div>
            </div>
        </div>
    )
}
