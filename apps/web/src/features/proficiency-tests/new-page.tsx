import { useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { Building02Icon, DistributionIcon } from '@hugeicons/core-free-icons'

import {
  parsePtRoundForm,
  type PtRoundFormData,
} from '@/features/proficiency-tests/forms'
import {
  useCreatePtRound,
  usePtStandardOptionsData,
} from '@/features/proficiency-tests/queries'
import {
  PT_ACTIVITY_TYPE_LABELS,
  type PtActivityType,
} from '@/features/proficiency-tests/types'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
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

const ACTIVITY_OPTIONS: Array<{
  value: PtActivityType
  hint: string
  icon: typeof DistributionIcon
}> = [
  {
    value: 'proficiency_test',
    hint: 'Rodada organizada por um provedor, com valor designado e escore.',
    icon: DistributionIcon,
  },
  {
    value: 'interlab_comparison',
    hint: 'Comparação de resultados entre laboratórios participantes.',
    icon: Building02Icon,
  },
]

export function NewProficiencyTestPage() {
  const navigate = useNavigate()
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()
  const [registrationDate, setRegistrationDate] = useState<Date | undefined>(
    undefined,
  )
  const [participationDate, setParticipationDate] = useState<Date | undefined>(
    undefined,
  )

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors },
  } = useForm<PtRoundFormData>({
    defaultValues: {
      activityType: 'proficiency_test',
      provider: '',
      providerAccreditation: '',
      ptRound: '',
      scopePart: '',
      metrologyKind: '',
      standardId: '',
      notes: '',
    },
  })

  const activityTypeValue = watch('activityType')
  const ptRoundValue = watch('ptRound')
  const providerValue = watch('provider')
  const scopePartValue = watch('scopePart')
  const standardIdValue = watch('standardId')

  const { data: standardsData } = usePtStandardOptionsData({
    enabled: !cloudOnlyUnavailable,
  })
  const selectedStandard = standardsData?.data.find(
    (standard) => String(standard.id) === standardIdValue,
  )

  const createMutation = useCreatePtRound()

  const onSubmit = (data: PtRoundFormData) => {
    const parsed = parsePtRoundForm(data, registrationDate, participationDate)
    if (!parsed.success) {
      for (const issue of parsed.fieldErrors) {
        setError(issue.field, { type: 'validate', message: issue.message })
      }

      toast.error(parsed.message)
      return
    }

    createMutation.mutate(parsed.data, {
      onSuccess: (result) => {
        toast.success(`Ensaio ${result.ptRound} registrado com sucesso`)
        navigate({
          to: '/dashboard/proficiency-tests/$id',
          params: { id: String(result.id) },
        })
      },
      onError: (error) => {
        toast.error(error.message)
      },
    })
  }

  if (cloudOnlyUnavailable) {
    return <CloudOnlyOfflineState title="Registro de EP indisponível offline" />
  }

  const summary = [
    {
      label: 'Atividade',
      value: PT_ACTIVITY_TYPE_LABELS[activityTypeValue],
      complete: true,
    },
    {
      label: 'Rodada',
      value: ptRoundValue.trim() || 'Pendente',
      complete: Boolean(ptRoundValue.trim()),
    },
    {
      label: 'Provedor',
      value: providerValue.trim() || 'Pendente',
      complete: Boolean(providerValue.trim()),
    },
    {
      label: 'Escopo',
      value: scopePartValue.trim() || 'Pendente',
      complete: Boolean(scopePartValue.trim()),
    },
    {
      label: 'Participação',
      value: participationDate
        ? participationDate.toLocaleDateString('pt-BR')
        : 'Opcional',
      complete: Boolean(participationDate),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="min-w-0 space-y-1">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Qualidade
        </p>
        <h1 className="text-balance text-2xl font-semibold tracking-tight">
          Novo ensaio de proficiência
        </h1>
        <p className="max-w-2xl text-pretty text-sm text-muted-foreground">
          Registre a inscrição na rodada. Resultados e escores entram depois,
          quando o provedor emitir o relatório final.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <form id="pt-round-form" onSubmit={handleSubmit(onSubmit)}>
          <Panel className="space-y-6 p-5 sm:p-6">
            <FormSection
              step={1}
              title="Atividade"
              description="Em que o laboratório vai participar e como a rodada é identificada."
            >
              <div
                role="radiogroup"
                aria-label="Tipo de atividade"
                className="grid gap-3 sm:grid-cols-2"
              >
                {ACTIVITY_OPTIONS.map((option) => {
                  const selected = activityTypeValue === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setValue('activityType', option.value)}
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
                        {PT_ACTIVITY_TYPE_LABELS[option.value]}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {option.hint}
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="mt-4">
                <Field>
                  <FieldLabel htmlFor="ptRound">
                    Identificação da rodada *
                  </FieldLabel>
                  <Input
                    id="ptRound"
                    {...register('ptRound', {
                      required: 'Rodada é obrigatória',
                    })}
                    placeholder="Ex: EP-MASSA-2026-01"
                  />
                  <FieldDescription>
                    Use o código da rodada do provedor ou um identificador
                    interno único.
                  </FieldDescription>
                  {errors.ptRound && (
                    <FieldError>{errors.ptRound.message}</FieldError>
                  )}
                </Field>
              </div>
            </FormSection>

            <FormSection
              step={2}
              title="Provedor"
              description="Quem organiza a rodada e emite o relatório final."
            >
              <div className="grid gap-5 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="provider">Provedor *</FieldLabel>
                  <Input
                    id="provider"
                    {...register('provider', {
                      required: 'Provedor é obrigatório',
                      minLength: {
                        value: 2,
                        message: 'Provedor deve ter pelo menos 2 caracteres',
                      },
                    })}
                    placeholder="Ex: Rede Metrológica RS"
                  />
                  {errors.provider && (
                    <FieldError>{errors.provider.message}</FieldError>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="providerAccreditation">
                    Acreditação do provedor
                  </FieldLabel>
                  <Input
                    id="providerAccreditation"
                    {...register('providerAccreditation')}
                    placeholder="Ex: CGCRE EP0001"
                  />
                  <FieldDescription>
                    Opcional. Registre a acreditação do provedor, se houver.
                  </FieldDescription>
                </Field>
              </div>
            </FormSection>

            <FormSection
              step={3}
              title="Escopo"
              description="Qual parte do escopo do laboratório esta rodada cobre."
            >
              <div className="grid gap-5 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="scopePart">Parte do escopo *</FieldLabel>
                  <Input
                    id="scopePart"
                    {...register('scopePart', {
                      required: 'Parte do escopo é obrigatória',
                      minLength: {
                        value: 2,
                        message: 'Escopo deve ter pelo menos 2 caracteres',
                      },
                    })}
                    placeholder="Ex: Massa, pesos classe M1"
                  />
                  <FieldDescription>
                    Escreva igual ao plano de participação para manter o
                    histórico por escopo.
                  </FieldDescription>
                  {errors.scopePart && (
                    <FieldError>{errors.scopePart.message}</FieldError>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="metrologyKind">Grandeza</FieldLabel>
                  <Input
                    id="metrologyKind"
                    {...register('metrologyKind')}
                    placeholder="Ex: massa, dimensional, pressão"
                  />
                  <FieldDescription>Opcional.</FieldDescription>
                </Field>

                <Field className="md:col-span-2">
                  <FieldLabel>Padrão de referência utilizado</FieldLabel>
                  <Select
                    value={standardIdValue}
                    onValueChange={(v) => setValue('standardId', v ?? '')}
                  >
                    <SelectTrigger>
                      <span
                        className="flex flex-1 text-left line-clamp-1"
                        data-slot="select-value"
                      >
                        {selectedStandard
                          ? `${selectedStandard.name} (${selectedStandard.serialNumber})`
                          : 'Nenhum padrão vinculado'}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Nenhum padrão vinculado</SelectItem>
                      {standardsData?.data.map((standard) => (
                        <SelectItem
                          key={standard.id}
                          value={String(standard.id)}
                        >
                          {standard.name} ({standard.serialNumber})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Opcional. Vincule o padrão usado na participação para
                    rastrear o histórico dele.
                  </FieldDescription>
                </Field>
              </div>
            </FormSection>

            <FormSection
              step={4}
              title="Cronograma"
              description="Datas de inscrição e participação, se já definidas."
            >
              <div className="grid gap-5 md:grid-cols-2">
                <Field>
                  <FieldLabel>Data de inscrição</FieldLabel>
                  <DatePicker
                    value={registrationDate}
                    onChange={setRegistrationDate}
                    placeholder="Selecione a data"
                  />
                  <FieldDescription>Opcional.</FieldDescription>
                </Field>

                <Field>
                  <FieldLabel>Data de participação</FieldLabel>
                  <DatePicker
                    value={participationDate}
                    onChange={setParticipationDate}
                    placeholder="Selecione a data"
                  />
                  <FieldDescription>
                    Opcional. Pode ser preenchida depois, quando a rodada
                    acontecer.
                  </FieldDescription>
                </Field>
              </div>
            </FormSection>

            <FormSection
              step={5}
              title="Observações"
              description="Itens ensaiados, condições de participação e notas do plano."
            >
              <Field>
                <FieldLabel htmlFor="notes" className="sr-only">
                  Observações
                </FieldLabel>
                <Textarea
                  id="notes"
                  {...register('notes')}
                  placeholder="Itens ensaiados, condições de participação, observações do plano..."
                  rows={4}
                />
              </Field>
            </FormSection>
          </Panel>
        </form>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Panel className="p-5">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Ensaio de proficiência
            </p>
            <h2 className="mt-0.5 text-base font-semibold">Resumo</h2>

            <dl className="mt-4 space-y-2.5">
              {summary.map((item) => (
                <div
                  key={item.label}
                  className="flex items-baseline justify-between gap-3"
                >
                  <dt className="flex shrink-0 items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <span
                      className={`size-1.5 rounded-full ${
                        item.complete ? 'bg-primary' : 'bg-muted-foreground/35'
                      }`}
                    />
                    {item.label}
                  </dt>
                  <dd
                    className={`min-w-0 truncate text-right text-sm ${
                      item.complete
                        ? 'text-foreground'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-5 space-y-2 border-t pt-4">
              <Button
                form="pt-round-form"
                type="submit"
                className={`${ACTION_BUTTON_CLASS} w-full`}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending
                  ? 'Registrando...'
                  : 'Registrar ensaio'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className={`${ACTION_BUTTON_CLASS} w-full`}
                onClick={() => navigate({ to: '/dashboard/proficiency-tests' })}
                disabled={createMutation.isPending}
              >
                Cancelar
              </Button>
            </div>

            <p className="mt-4 text-pretty text-xs leading-5 text-muted-foreground">
              O ensaio entra como pendente. Lance os resultados na página do
              ensaio quando o relatório do provedor chegar.
            </p>
          </Panel>
        </aside>
      </div>
    </div>
  )
}

function FormSection({
  step,
  title,
  description,
  children,
}: {
  step: number
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="border-t border-border/60 pt-6 first:border-t-0 first:pt-0">
      <div className="flex items-start gap-3">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs font-medium tabular-nums text-muted-foreground">
          {step}
        </span>
        <div className="min-w-0">
          <h2 className="text-balance text-sm font-semibold">{title}</h2>
          {description && (
            <p className="text-pretty text-xs leading-5 text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      <div className="mt-4 min-w-0 sm:pl-9">{children}</div>
    </section>
  )
}
