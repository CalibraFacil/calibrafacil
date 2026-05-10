import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { api, calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import {
  CloudOnlyOfflineState,
  useDesktopCloudOnlyUnavailable,
} from '@/runtime/sync-status'

export const Route = createFileRoute('/dashboard/nc/new')({
  head: () => ({
    meta: [{ title: 'Registrar Não Conformidade | CalibraFacil' }],
  }),
  component: NewNCPage,
})

type NCFormData = {
  type: 'work' | 'equipment' | 'documentation'
  description: string
  jobId?: string
}

const NC_TYPE_LABELS: Record<NCFormData['type'], string> = {
  work: 'Trabalho',
  equipment: 'Equipamento',
  documentation: 'Documentação',
}

function NewNCPage() {
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
    setValue,
    watch,
    formState: { errors },
  } = useForm<NCFormData>({
    defaultValues: {
      type: 'work',
      description: '',
      jobId: '',
    },
  })

  const typeValue = watch('type')
  const jobIdValue = watch('jobId')

  // Fetch jobs for linking
  const { data: jobsData } = useQuery({
    queryKey: ['jobs-for-nc'],
    enabled: !cloudOnlyUnavailable,
    queryFn: () =>
      calibraApi.jobs.list({
        page: 1,
        limit: 100,
      }),
  })

  const selectedJob = jobsData?.data.find((j) => String(j.id) === jobIdValue)

  const createMutation = useMutation({
    mutationFn: async (payload: {
      type: NCFormData['type']
      description: string
      detectedAt: string
      jobId?: number
    }) => {
      const res = await api.api.nc.$post({ json: payload })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(
          (err as { error?: string }).error || 'Erro ao registrar NC',
        )
      }

      return res.json() as Promise<{ id: number; ncNumber: string }>
    },
    onSuccess: (result) => {
      toast.success(`NC ${result.ncNumber} registrada com sucesso`)
      navigate({ to: '/dashboard/nc/$id', params: { id: String(result.id) } })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const onSubmit = (data: NCFormData) => {
    if (!detectedDate) {
      toast.error('Data de detecção é obrigatória')
      return
    }
    const [hours, minutes] = detectedTime.split(':').map(Number)
    const combined = new Date(detectedDate)
    combined.setHours(hours ?? 0, minutes ?? 0, 0, 0)

    createMutation.mutate({
      type: data.type,
      description: data.description,
      detectedAt: combined.toISOString(),
      jobId: data.jobId ? Number(data.jobId) : undefined,
    })
  }

  if (cloudOnlyUnavailable) {
    return (
      <CloudOnlyOfflineState title="Registro de não conformidade indisponível offline" />
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Registrar Não Conformidade</CardTitle>
          <CardDescription>
            ISO 17025 Cláusula 8.7 - Controle de trabalho não conforme
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Type */}
            <div className="space-y-2">
              <Label htmlFor="type">Tipo de Não Conformidade</Label>
              <Select
                value={typeValue}
                onValueChange={(v) => setValue('type', v as NCFormData['type'])}
              >
                <SelectTrigger>
                  <span
                    className="flex flex-1 text-left line-clamp-1"
                    data-slot="select-value"
                  >
                    {NC_TYPE_LABELS[typeValue] ?? 'Selecione o tipo'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="work">
                    Trabalho - Leitura fora de faixa, padrão inadequado, etc.
                  </SelectItem>
                  <SelectItem value="equipment">
                    Equipamento - Falha de equipamento, fora de tolerância
                  </SelectItem>
                  <SelectItem value="documentation">
                    Documentação - Erro em documento, certificado, registro
                  </SelectItem>
                </SelectContent>
              </Select>
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

            {/* Job Link (optional) */}
            <div className="space-y-2">
              <Label htmlFor="jobId">Ordem de Serviço (opcional)</Label>
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
                Vincule a uma ordem de serviço se a NC estiver relacionada a um
                trabalho específico.
              </p>
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
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: '/dashboard/nc' })}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Registrando...' : 'Registrar NC'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
