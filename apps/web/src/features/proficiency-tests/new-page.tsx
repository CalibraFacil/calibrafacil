import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import {
  parsePtRoundForm,
  type PtRoundFormData,
} from '@/features/proficiency-tests/forms'
import { useCreatePtRound } from '@/features/proficiency-tests/queries'
import { PT_ACTIVITY_TYPE_LABELS } from '@/features/proficiency-tests/types'
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
import {
  CloudOnlyOfflineState,
  useDesktopCloudOnlyUnavailable,
} from '@/runtime/sync-status'

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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="min-w-0 space-y-1">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Qualidade · ISO/IEC 17025 §7.7
        </p>
        <h1 className="text-balance text-2xl font-semibold tracking-tight">
          Novo ensaio de proficiência
        </h1>
        <p className="max-w-2xl text-pretty text-sm text-muted-foreground">
          Registre a inscrição na rodada. Os resultados e escores são lançados
          depois, quando o provedor emitir o relatório final.
        </p>
      </div>

      <Panel className="p-5">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <section className="space-y-4">
            <h2 className="text-sm font-semibold">Identificação</h2>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Tipo de atividade</Label>
                <Select
                  value={activityTypeValue}
                  onValueChange={(v) => {
                    if (
                      v === 'proficiency_test' ||
                      v === 'interlab_comparison'
                    ) {
                      setValue('activityType', v)
                    }
                  }}
                >
                  <SelectTrigger>
                    <span
                      className="flex flex-1 text-left line-clamp-1"
                      data-slot="select-value"
                    >
                      {PT_ACTIVITY_TYPE_LABELS[activityTypeValue]}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="proficiency_test">
                      Ensaio de proficiência
                    </SelectItem>
                    <SelectItem value="interlab_comparison">
                      Comparação interlaboratorial
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ptRound">Rodada</Label>
                <Input
                  {...register('ptRound', {
                    required: 'Rodada é obrigatória',
                  })}
                  placeholder="Ex: EP-MASSA-2026-01"
                />
                {errors.ptRound && (
                  <p className="text-sm text-destructive">
                    {errors.ptRound.message}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="provider">Provedor</Label>
                <Input
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
                  <p className="text-sm text-destructive">
                    {errors.provider.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="providerAccreditation">
                  Acreditação do provedor (opcional)
                </Label>
                <Input
                  {...register('providerAccreditation')}
                  placeholder="Ex: ISO/IEC 17043 — CGCRE EPnnn"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="scopePart">Parte do escopo</Label>
                <Input
                  {...register('scopePart', {
                    required: 'Parte do escopo é obrigatória',
                    minLength: {
                      value: 2,
                      message: 'Escopo deve ter pelo menos 2 caracteres',
                    },
                  })}
                  placeholder="Ex: Massa — pesos classe M1"
                />
                {errors.scopePart && (
                  <p className="text-sm text-destructive">
                    {errors.scopePart.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="metrologyKind">Grandeza (opcional)</Label>
                <Input
                  {...register('metrologyKind')}
                  placeholder="Ex: massa, dimensional, pressão"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Data de inscrição (opcional)</Label>
                <DatePicker
                  value={registrationDate}
                  onChange={setRegistrationDate}
                  placeholder="Selecione a data"
                />
              </div>

              <div className="space-y-2">
                <Label>Data de participação (opcional)</Label>
                <DatePicker
                  value={participationDate}
                  onChange={setParticipationDate}
                  placeholder="Selecione a data"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Observações (opcional)</Label>
              <Textarea
                {...register('notes')}
                placeholder="Itens ensaiados, condições de participação, observações do plano..."
                rows={3}
              />
            </div>
          </section>

          <div className="flex justify-end gap-3 border-t pt-5">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate({ to: '/dashboard/proficiency-tests' })}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className={ACTION_BUTTON_CLASS}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'Registrando...' : 'Registrar ensaio'}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  )
}
