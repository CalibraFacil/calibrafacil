import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { Shield01Icon, Wrench01Icon } from '@hugeicons/core-free-icons'
import type { CapaCreateInput } from '@calibra-facil/client-runtime'

import { calibraApi } from '@/utils/api'
import { parseCapaForm, type CapaFormData } from '@/features/quality/forms'
import { useCapaResponsibleMembersData } from '@/features/quality/queries'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { ACTION_BUTTON_CLASS, Panel } from '@/components/instrument-panel'
import { cn } from '@/lib/utils'
import {
  CloudOnlyOfflineState,
  useDesktopCloudOnlyUnavailable,
} from '@/runtime/sync-status'

const SOURCE_LABELS: Record<string, string> = {
  nc_detection: 'Detecção de NC',
  internal_audit: 'Auditoria Interna',
  external_audit: 'Auditoria Externa',
  customer_complaint: 'Reclamação de Cliente',
  management_review: 'Revisão Gerencial',
}

const CATEGORY_LABELS: Record<string, string> = {
  method: 'Método',
  equipment: 'Equipamento',
  personnel: 'Pessoal',
  procedure: 'Procedimento',
  environment: 'Ambiente',
  other: 'Outro',
}

const RCA_METHOD_LABELS: Record<string, string> = {
  '': 'Nenhum',
  '5_whys': '5 Porquês (5 Whys)',
  fishbone: 'Diagrama de Ishikawa (Fishbone)',
  pareto: 'Análise de Pareto',
  other: 'Outro',
}

const CAPA_TYPES: ReadonlyArray<{
  value: string
  label: string
  hint: string
  icon: typeof Wrench01Icon
}> = [
  {
    value: 'corrective',
    label: 'Corretiva',
    hint: 'Corrige um problema que já ocorreu',
    icon: Wrench01Icon,
  },
  {
    value: 'preventive',
    label: 'Preventiva',
    hint: 'Evita um problema que pode ocorrer',
    icon: Shield01Icon,
  },
]

const SEVERITY_OPTIONS: ReadonlyArray<{
  value: string
  label: string
  selectedClass: string
}> = [
  {
    value: 'minor',
    label: 'Menor',
    selectedClass: 'border-primary bg-primary/10 text-primary',
  },
  {
    value: 'major',
    label: 'Maior',
    selectedClass:
      'border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  {
    value: 'critical',
    label: 'Crítica',
    selectedClass: 'border-destructive bg-destructive/10 text-destructive',
  },
]

const CAPA_LIFECYCLE = [
  {
    title: 'Aberta',
    description: 'O problema e o plano de ação são registrados.',
  },
  {
    title: 'Investigação',
    description: 'A causa raiz é analisada.',
  },
  {
    title: 'Implementação',
    description: 'As ações são executadas com evidência.',
  },
  {
    title: 'Verificação',
    description: 'A eficácia das ações é confirmada.',
  },
  {
    title: 'Encerrada',
    description: 'A CAPA é fechada.',
  },
]

export function NewCAPAPage() {
  const navigate = useNavigate()
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()
  const [detectionDate, setDetectionDate] = useState<Date | undefined>(
    new Date(),
  )
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined)

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CapaFormData>({
    defaultValues: {
      title: '',
      description: '',
      source: 'nc_detection',
      sourceReference: '',
      type: 'corrective',
      severity: 'minor',
      category: 'procedure',
      actionPlan: '',
      responsibleId: '',
      rootCauseAnalysis: '',
      rootCauseAnalysisMethod: '',
      preventiveMeasures: '',
    },
  })

  const sourceValue = watch('source')
  const typeValue = watch('type')
  const severityValue = watch('severity')
  const categoryValue = watch('category')
  const rcaMethodValue = watch('rootCauseAnalysisMethod')
  const responsibleIdValue = watch('responsibleId')

  // Fetch organization members (technicians) for responsible selection
  const { data: membersData } = useCapaResponsibleMembersData({
    enabled: !cloudOnlyUnavailable,
  })

  const selectedMember = membersData?.data?.find(
    (m) => m.id === responsibleIdValue,
  )

  const createMutation = useMutation({
    mutationFn: async (payload: CapaCreateInput) =>
      calibraApi.capas.create<{ id: number; capaNumber: string }>(payload),
    onSuccess: (result) => {
      toast.success(`${result.capaNumber} criada com sucesso`)
      navigate({
        to: '/dashboard/capa/$id',
        params: { id: String(result.id) },
      })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const onSubmit = (data: CapaFormData) => {
    const parsed = parseCapaForm(data, detectionDate, dueDate)
    if (!parsed.success) {
      for (const issue of parsed.fieldErrors) {
        setError(issue.field, { type: 'validate', message: issue.message })
      }

      toast.error(parsed.message)
      return
    }

    // proficiency_test / spc_signal CAPAs are opened automatically by the
    // §7.7 escalation flows — they are not valid manual-creation sources.
    const { source } = parsed.data
    if (source === 'proficiency_test' || source === 'spc_signal') {
      toast.error('Origem inválida para criação manual de CAPA')
      return
    }

    createMutation.mutate({ ...parsed.data, source })
  }

  if (cloudOnlyUnavailable) {
    return (
      <CloudOnlyOfflineState title="Criação de CAPA indisponível offline" />
    )
  }

  return (
    <div className="space-y-6">
      <div className="min-w-0 space-y-1">
        <h1 className="text-balance text-2xl font-semibold tracking-tight">
          Nova ação corretiva (CAPA)
        </h1>
        <p className="max-w-2xl text-pretty text-sm text-muted-foreground">
          Registre o problema e o plano de tratamento. A investigação de causa
          raiz e a verificação de eficácia acontecem nas próximas etapas.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <Panel className="p-5">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Identificação */}
            <section className="space-y-4">
              <h2 className="text-sm font-semibold">Identificação</h2>

              <div className="space-y-2">
                <Label htmlFor="title">Título</Label>
                <Input
                  {...register('title', {
                    required: 'Título é obrigatório',
                    minLength: {
                      value: 5,
                      message: 'Título deve ter pelo menos 5 caracteres',
                    },
                  })}
                  placeholder="Título resumido da ação corretiva"
                />
                {errors.title && (
                  <p className="text-sm text-destructive">
                    {errors.title.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Descrição</Label>
                <Textarea
                  {...register('description', {
                    required: 'Descrição é obrigatória',
                    minLength: {
                      value: 10,
                      message: 'Descrição deve ter pelo menos 10 caracteres',
                    },
                  })}
                  placeholder="Descreva detalhadamente o problema encontrado, incluindo evidências e impacto..."
                  rows={4}
                />
                {errors.description && (
                  <p className="text-sm text-destructive">
                    {errors.description.message}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Data de Detecção</Label>
                  <DatePicker
                    value={detectionDate}
                    onChange={setDetectionDate}
                    placeholder="Selecione a data"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Origem</Label>
                  <Select
                    value={sourceValue}
                    onValueChange={(v) => setValue('source', v ?? '')}
                  >
                    <SelectTrigger>
                      <span
                        className="flex flex-1 text-left line-clamp-1"
                        data-slot="select-value"
                      >
                        {SOURCE_LABELS[sourceValue] ?? 'Selecione a origem'}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nc_detection">
                        Detecção de NC
                      </SelectItem>
                      <SelectItem value="internal_audit">
                        Auditoria Interna
                      </SelectItem>
                      <SelectItem value="external_audit">
                        Auditoria Externa
                      </SelectItem>
                      <SelectItem value="customer_complaint">
                        Reclamação de Cliente
                      </SelectItem>
                      <SelectItem value="management_review">
                        Revisão Gerencial
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sourceReference">
                  Referência da Origem (opcional)
                </Label>
                <Input
                  {...register('sourceReference')}
                  placeholder="Ex: NC-2024-0001, OS-2024-001, Reclamação #123"
                />
                <p className="text-xs text-muted-foreground">
                  Número da NC, OS, reclamação ou auditoria que originou esta
                  CAPA.
                </p>
              </div>
            </section>

            {/* Classificação */}
            <section className="space-y-4 border-t border-border/60 pt-6">
              <h2 className="text-sm font-semibold">Classificação</h2>

              <div className="space-y-2">
                <Label>Tipo</Label>
                <div
                  role="radiogroup"
                  aria-label="Tipo da CAPA"
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {CAPA_TYPES.map((option) => {
                    const selected = typeValue === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setValue('type', option.value)}
                        className={cn(
                          'flex items-start gap-3 rounded-xl border p-3 text-left transition-[background-color,box-shadow,transform] active:scale-[0.98]',
                          selected
                            ? 'border-transparent bg-primary/5 shadow-[0_0_0_1.5px_hsl(var(--primary))]'
                            : 'border-border/70 hover:bg-muted/40',
                        )}
                      >
                        <span
                          className={cn(
                            'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                            selected
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-muted-foreground',
                          )}
                        >
                          <HugeiconsIcon
                            icon={option.icon}
                            className="size-4"
                          />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">
                            {option.label}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {option.hint}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Severidade</Label>
                  <div
                    role="radiogroup"
                    aria-label="Severidade"
                    className="grid grid-cols-3 gap-2"
                  >
                    {SEVERITY_OPTIONS.map((option) => {
                      const selected = severityValue === option.value
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setValue('severity', option.value)}
                          className={cn(
                            'rounded-lg border px-3 py-2 text-sm font-medium transition-[background-color,color,border-color,transform] active:scale-[0.97]',
                            selected
                              ? option.selectedClass
                              : 'border-border/70 text-muted-foreground hover:bg-muted/40',
                          )}
                        >
                          {option.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Categoria</Label>
                  <Select
                    value={categoryValue}
                    onValueChange={(v) => setValue('category', v ?? '')}
                  >
                    <SelectTrigger>
                      <span
                        className="flex flex-1 text-left line-clamp-1"
                        data-slot="select-value"
                      >
                        {CATEGORY_LABELS[categoryValue] ??
                          'Selecione a categoria'}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="method">Método</SelectItem>
                      <SelectItem value="equipment">Equipamento</SelectItem>
                      <SelectItem value="personnel">Pessoal</SelectItem>
                      <SelectItem value="procedure">Procedimento</SelectItem>
                      <SelectItem value="environment">Ambiente</SelectItem>
                      <SelectItem value="other">Outro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            {/* Root Cause Analysis */}
            <section className="space-y-4 border-t border-border/60 pt-6">
              <div>
                <h2 className="text-sm font-semibold">
                  Análise de causa raiz (opcional)
                </h2>
                <p className="text-xs text-muted-foreground">
                  Pode ser preenchida depois, durante a investigação.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Método de Análise</Label>
                <Select
                  value={rcaMethodValue}
                  onValueChange={(v) =>
                    setValue('rootCauseAnalysisMethod', v ?? '')
                  }
                >
                  <SelectTrigger>
                    <span
                      className="flex flex-1 text-left line-clamp-1"
                      data-slot="select-value"
                    >
                      {RCA_METHOD_LABELS[rcaMethodValue] ?? 'Nenhum'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Nenhum</SelectItem>
                    <SelectItem value="5_whys">5 Porquês (5 Whys)</SelectItem>
                    <SelectItem value="fishbone">
                      Diagrama de Ishikawa (Fishbone)
                    </SelectItem>
                    <SelectItem value="pareto">Análise de Pareto</SelectItem>
                    <SelectItem value="other">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="rootCauseAnalysis">Análise de Causa Raiz</Label>
                <Textarea
                  {...register('rootCauseAnalysis')}
                  placeholder={
                    rcaMethodValue === '5_whys'
                      ? '1. Por quê? ...\n2. Por quê? ...\n3. Por quê? ...\n4. Por quê? ...\n5. Por quê? (causa raiz) ...'
                      : rcaMethodValue === 'fishbone'
                        ? 'Mão de Obra:\nMétodo:\nMáquina:\nMaterial:\nMeio Ambiente:\nMedição:'
                        : 'Descreva a análise de causa raiz...'
                  }
                  rows={6}
                />
              </div>
            </section>

            {/* Action Plan */}
            <section className="space-y-4 border-t border-border/60 pt-6">
              <h2 className="text-sm font-semibold">Plano de ação</h2>

              <div className="space-y-2">
                <Label htmlFor="actionPlan">Plano de Ação Corretiva</Label>
                <Textarea
                  {...register('actionPlan', {
                    required: 'Plano de ação é obrigatório',
                    minLength: {
                      value: 10,
                      message:
                        'Plano de ação deve ter pelo menos 10 caracteres',
                    },
                  })}
                  placeholder="Descreva as ações a serem tomadas para corrigir o problema e prevenir recorrência..."
                  rows={4}
                />
                {errors.actionPlan && (
                  <p className="text-sm text-destructive">
                    {errors.actionPlan.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="preventiveMeasures">
                  Medidas Preventivas (opcional)
                </Label>
                <Textarea
                  {...register('preventiveMeasures')}
                  placeholder="Descreva medidas para prevenir que o problema ocorra novamente..."
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Responsável</Label>
                  <Select
                    value={responsibleIdValue}
                    onValueChange={(v) => setValue('responsibleId', v ?? '')}
                  >
                    <SelectTrigger>
                      <span
                        className="flex flex-1 text-left line-clamp-1"
                        data-slot="select-value"
                      >
                        {selectedMember
                          ? `${selectedMember.name} (${selectedMember.role})`
                          : 'Selecione o responsável'}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {membersData?.data?.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name} ({m.role})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.responsibleId && (
                    <p className="text-sm text-destructive">
                      Responsável é obrigatório
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Data Alvo</Label>
                  <DatePicker
                    value={dueDate}
                    onChange={setDueDate}
                    placeholder="Selecione a data alvo"
                  />
                </div>
              </div>
            </section>

            {/* Actions */}
            <div className="flex justify-end gap-3 border-t pt-5">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: '/dashboard/capa' })}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className={ACTION_BUTTON_CLASS}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? 'Criando...' : 'Criar CAPA'}
              </Button>
            </div>
          </form>
        </Panel>

        <aside className="space-y-4">
          <Panel className="p-5">
            <h2 className="mt-0.5 text-base font-semibold">Ciclo da CAPA</h2>
            <ol className="mt-4 space-y-3">
              {CAPA_LIFECYCLE.map((step, index) => {
                const isFirst = index === 0
                return (
                  <li key={step.title} className="flex gap-3">
                    <span
                      className={cn(
                        'flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-xs font-medium tabular-nums',
                        isFirst
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {step.title}
                        {isFirst && (
                          <span className="ml-1.5 text-xs font-normal text-primary">
                            você está aqui
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {step.description}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ol>
            <div className="mt-4 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Corretiva</span>{' '}
              trata um problema existente;{' '}
              <span className="font-medium text-foreground">preventiva</span>{' '}
              age sobre um risco potencial.
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  )
}
