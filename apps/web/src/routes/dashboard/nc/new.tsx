import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export const Route = createFileRoute('/dashboard/nc/new')({
  head: () => ({
    meta: [{ title: 'Registrar Nao Conformidade | CalibraFacil' }],
  }),
  component: NewNCPage,
})

type NCFormData = {
  type: 'work' | 'equipment' | 'documentation'
  description: string
  detectedAt: string
  jobId?: string
}

function NewNCPage() {
  const navigate = useNavigate()

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
      detectedAt: new Date().toISOString().slice(0, 16),
      jobId: '',
    },
  })

  const typeValue = watch('type')

  // Fetch jobs for linking
  const { data: jobsData } = useQuery({
    queryKey: ['jobs-for-nc'],
    queryFn: async () => {
      const res = await api.api.jobs.$get({
        query: { limit: '100' },
      })
      if (!res.ok) throw new Error('Falha ao carregar ordens')
      return res.json() as Promise<{
        data: Array<{ id: number; jobId: string; status: string }>
        pagination: { total: number }
      }>
    },
  })

  const createMutation = useMutation({
    mutationFn: async (data: NCFormData) => {
      const res = await api.api.nc.$post({
        json: {
          type: data.type,
          description: data.description,
          detectedAt: new Date(data.detectedAt).toISOString(),
          jobId: data.jobId ? Number(data.jobId) : undefined,
        },
      })

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
    createMutation.mutate(data)
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Registrar Nao Conformidade</CardTitle>
          <CardDescription>
            ISO 17025 Clausula 8.7 - Controle de trabalho nao conforme
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Type */}
            <div className="space-y-2">
              <Label htmlFor="type">Tipo de Nao Conformidade</Label>
              <Select
                value={typeValue}
                onValueChange={(v) =>
                  setValue('type', v as NCFormData['type'])
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="work">
                    Trabalho - Leitura fora de range, padrao inadequado, etc.
                  </SelectItem>
                  <SelectItem value="equipment">
                    Equipamento - Falha de equipamento, fora de tolerancia
                  </SelectItem>
                  <SelectItem value="documentation">
                    Documentacao - Erro em documento, certificado, registro
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Detected At */}
            <div className="space-y-2">
              <Label htmlFor="detectedAt">Data/Hora da Deteccao</Label>
              <Input
                type="datetime-local"
                {...register('detectedAt', {
                  required: 'Data de deteccao e obrigatoria',
                })}
              />
              {errors.detectedAt && (
                <p className="text-sm text-destructive">
                  {errors.detectedAt.message}
                </p>
              )}
            </div>

            {/* Job Link (optional) */}
            <div className="space-y-2">
              <Label htmlFor="jobId">
                Ordem de Servico (opcional)
              </Label>
              <Select
                value={watch('jobId') || ''}
                onValueChange={(v) => setValue('jobId', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Nenhuma OS vinculada" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Nenhuma</SelectItem>
                  {jobsData?.data.map((job) => (
                    <SelectItem key={job.id} value={String(job.id)}>
                      {job.jobId} ({job.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Vincule a uma ordem de servico se a NC estiver relacionada a um
                trabalho especifico.
              </p>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Descricao da Nao Conformidade</Label>
              <Textarea
                {...register('description', {
                  required: 'Descricao e obrigatoria',
                  minLength: {
                    value: 10,
                    message: 'Descricao deve ter pelo menos 10 caracteres',
                  },
                })}
                placeholder="Descreva detalhadamente a nao conformidade detectada, incluindo: o que foi observado, onde, como foi detectado e potencial impacto..."
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
                {createMutation.isPending
                  ? 'Registrando...'
                  : 'Registrar NC'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
