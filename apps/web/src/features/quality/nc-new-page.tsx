import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  DashboardSpeed02Icon,
  LegalDocument01Icon,
  ToolsIcon,
} from '@hugeicons/core-free-icons'
import type { CreateNonConformanceInput } from '@calibra-facil/schemas/quality'

import { calibraApi } from '@/utils/api'
import {
  parseNonConformanceForm,
  type NonConformanceFormData,
} from '@/features/quality/forms'
import { useNonConformanceJobsData } from '@/features/quality/queries'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
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
import { useDesktopCloudOnlyUnavailable } from '@/runtime/sync-status'

const NC_TYPES: ReadonlyArray<{
  value: NonConformanceFormData['type']
  label: string
  hint: string
  icon: typeof ToolsIcon
}> = [
  {
    value: 'work',
    label: 'Trabalho',
    hint: 'Leitura fora de faixa, padrão inadequado',
    icon: ToolsIcon,
  },
  {
    value: 'equipment',
    label: 'Equipamento',
    hint: 'Falha ou item fora de tolerância',
    icon: DashboardSpeed02Icon,
  },
  {
    value: 'documentation',
    label: 'Documentação',
    hint: 'Erro em documento, certificado ou registro',
    icon: LegalDocument01Icon,
  },
  {
    value: 'out_of_tolerance',
    label: 'Fora de tolerância',
    hint: 'Resultado "como encontrado" fora de tolerância (§7.10)',
    icon: Alert02Icon,
  },
]

const NC_FLOW_STEPS = [
  {
    title: 'Registro',
    description: 'Você descreve o que foi detectado, quando e o impacto.',
  },
  {
    title: 'Disposição',
    description: 'Retrabalho, sucata, uso como está ou concessão.',
  },
  {
    title: 'Resolução',
    description: 'A correção é registrada e a NC é encerrada.',
  },
]

export function NewNCPage() {
  const navigate = useNavigate()
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()
  const now = new Date()
  const [detectedDate, setDetectedDate] = useState<Date | undefined>(now)
  const [detectedTime, setDetectedTime] = useState(
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
  )

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors },
  } = useForm<NonConformanceFormData>({
    defaultValues: {
      type: 'work',
      description: '',
      jobId: '',
    },
  })

  const typeValue = watch('type')
  const jobIdValue = watch('jobId')

  // Fetch jobs for linking
  const { data: jobsData } = useNonConformanceJobsData({
    enabled: !cloudOnlyUnavailable,
  })

  const selectedJob = jobsData?.data.find((j) => String(j.id) === jobIdValue)

  const createMutation = useMutation({
    mutationFn: async (payload: CreateNonConformanceInput) =>
      calibraApi.nonConformances.create(payload),
    onSuccess: (result) => {
      if (cloudOnlyUnavailable) {
        // O detalhe da NC é cloud-only; no desktop offline a NC fica no
        // outbox local até a próxima sincronização.
        toast.success(
          'NC registrada localmente — será sincronizada quando houver conexão.',
        )
        navigate({ to: '/dashboard' })
        return
      }

      toast.success(`NC ${result.ncNumber} registrada com sucesso`)
      navigate({ to: '/dashboard/nc/$id', params: { id: String(result.id) } })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const onSubmit = (data: NonConformanceFormData) => {
    const parsed = parseNonConformanceForm(data, detectedDate, detectedTime)
    if (!parsed.success) {
      for (const issue of parsed.fieldErrors) {
        setError(issue.field, { type: 'validate', message: issue.message })
      }

      toast.error(parsed.message)
      return
    }

    createMutation.mutate(parsed.data)
  }

  return (
    <div className="space-y-6">
      <div className="min-w-0 space-y-1">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Qualidade
        </p>
        <h1 className="text-balance text-2xl font-semibold tracking-tight">
          Registrar não conformidade
        </h1>
        <p className="max-w-2xl text-pretty text-sm text-muted-foreground">
          O registro é o primeiro passo do tratamento de um trabalho não
          conforme detectado no laboratório.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <Panel className="p-5">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Type */}
            <div className="space-y-2">
              <Label>Tipo de não conformidade</Label>
              <div
                role="radiogroup"
                aria-label="Tipo de não conformidade"
                className="grid gap-2 sm:grid-cols-2"
              >
                {NC_TYPES.map((option) => {
                  const selected = typeValue === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setValue('type', option.value)}
                      className={cn(
                        'flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-[background-color,box-shadow,transform] active:scale-[0.98]',
                        selected
                          ? 'border-transparent bg-primary/5 shadow-[0_0_0_1.5px_hsl(var(--primary))]'
                          : 'border-border/70 hover:bg-muted/40',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-8 items-center justify-center rounded-lg transition-colors',
                          selected
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        <HugeiconsIcon icon={option.icon} className="size-4" />
                      </span>
                      <span className="text-sm font-medium">
                        {option.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {option.hint}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Detected At */}
            <FieldGroup className="flex-row">
              <Field>
                <FieldLabel>Data da Detecção</FieldLabel>
                <DatePicker
                  value={detectedDate}
                  onChange={setDetectedDate}
                  placeholder="Selecione a data"
                />
              </Field>
              <Field className="w-32">
                <FieldLabel htmlFor="detected-time">Hora</FieldLabel>
                <Input
                  type="time"
                  id="detected-time"
                  value={detectedTime}
                  onChange={(e) => setDetectedTime(e.target.value)}
                  className="bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                />
              </Field>
            </FieldGroup>

            {/* Job Link (optional; requires the cloud API) */}
            <div className="space-y-2">
              <Label htmlFor="jobId">Ordem de Serviço (opcional)</Label>
              {cloudOnlyUnavailable ? (
                <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  Vínculo com calibração disponível apenas no modo online.
                </p>
              ) : (
                <>
                  <Select
                    value={jobIdValue || ''}
                    onValueChange={(v) => setValue('jobId', v ?? '')}
                  >
                    <SelectTrigger>
                      <span
                        className="flex flex-1 text-left line-clamp-1"
                        data-slot="select-value"
                      >
                        {selectedJob
                          ? `${selectedJob.jobId} (${selectedJob.status})`
                          : 'Nenhuma OS vinculada'}
                      </span>
                    </SelectTrigger>
                    <SelectContent className="min-w-[280px]">
                      <SelectItem value="">Nenhuma</SelectItem>
                      {jobsData?.data.map((job) => (
                        <SelectItem key={job.id} value={String(job.id)}>
                          {job.jobId} ({job.status})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Vincule a uma ordem de serviço se a NC estiver relacionada a
                    um trabalho específico.
                  </p>
                </>
              )}
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Descrição da Não Conformidade</Label>
              <Textarea
                {...register('description', {
                  required: 'Descrição é obrigatória',
                  minLength: {
                    value: 10,
                    message: 'Descrição deve ter pelo menos 10 caracteres',
                  },
                })}
                placeholder="Descreva detalhadamente a não conformidade detectada, incluindo: o que foi observado, onde, como foi detectado e potencial impacto..."
                rows={6}
              />
              {errors.description && (
                <p className="text-sm text-destructive">
                  {errors.description.message}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 border-t pt-5">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  navigate({
                    to: cloudOnlyUnavailable ? '/dashboard' : '/dashboard/nc',
                  })
                }
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className={ACTION_BUTTON_CLASS}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? 'Registrando...' : 'Registrar NC'}
              </Button>
            </div>
          </form>
        </Panel>

        <aside className="space-y-4">
          <Panel className="p-5">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Como funciona
            </p>
            <h2 className="mt-0.5 text-base font-semibold">
              Fluxo da não conformidade
            </h2>
            <ol className="mt-4 space-y-3">
              {NC_FLOW_STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs font-medium tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{step.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {step.description}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-4 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
              NCs críticas podem ser escaladas para uma{' '}
              <span className="font-medium text-foreground">CAPA</span> — ação
              corretiva e preventiva com análise de causa raiz.
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  )
}
