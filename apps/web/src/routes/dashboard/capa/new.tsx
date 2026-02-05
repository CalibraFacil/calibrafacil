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
import { Separator } from '@/components/ui/separator'

export const Route = createFileRoute('/dashboard/capa/new')({
  head: () => ({
    meta: [{ title: 'Nova CAPA | CalibraFacil' }],
  }),
  component: NewCAPAPage,
})

type CAPAFormData = {
  title: string
  description: string
  source: string
  sourceReference: string
  detectionDate: string
  type: string
  severity: string
  category: string
  actionPlan: string
  responsibleId: string
  dueDate: string
  rootCauseAnalysis: string
  rootCauseAnalysisMethod: string
  preventiveMeasures: string
}

function NewCAPAPage() {
  const navigate = useNavigate()

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CAPAFormData>({
    defaultValues: {
      title: '',
      description: '',
      source: 'nc_detection',
      sourceReference: '',
      detectionDate: new Date().toISOString().slice(0, 10),
      type: 'corrective',
      severity: 'minor',
      category: 'procedure',
      actionPlan: '',
      responsibleId: '',
      dueDate: '',
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

  // Fetch organization members (technicians) for responsible selection
  const { data: membersData } = useQuery({
    queryKey: ['jobs', 'technicians'],
    queryFn: async () => {
      const res = await api.api.jobs['technicians']['list'].$get()
      if (!res.ok) return { data: [] }
      return res.json() as Promise<{
        data: Array<{ id: string; name: string; role: string }>
      }>
    },
  })

  const createMutation = useMutation({
    mutationFn: async (data: CAPAFormData) => {
      const res = await api.api.capa.$post({
        json: {
          title: data.title,
          description: data.description,
          source: data.source as
            | 'internal_audit'
            | 'customer_complaint'
            | 'nc_detection'
            | 'external_audit'
            | 'management_review',
          sourceReference: data.sourceReference || undefined,
          detectionDate: new Date(data.detectionDate).toISOString(),
          type: data.type as 'corrective' | 'preventive',
          severity: data.severity as 'minor' | 'major' | 'critical',
          category: data.category as
            | 'method'
            | 'equipment'
            | 'personnel'
            | 'procedure'
            | 'environment'
            | 'other',
          actionPlan: data.actionPlan,
          responsibleId: data.responsibleId,
          dueDate: new Date(data.dueDate).toISOString(),
          rootCauseAnalysis: data.rootCauseAnalysis || undefined,
          rootCauseAnalysisMethod: data.rootCauseAnalysisMethod
            ? (data.rootCauseAnalysisMethod as
                | '5_whys'
                | 'fishbone'
                | 'pareto'
                | 'other')
            : undefined,
          preventiveMeasures: data.preventiveMeasures || undefined,
        },
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(
          (err as { error?: string }).error || 'Erro ao criar CAPA',
        )
      }

      return res.json() as Promise<{ id: number; capaNumber: string }>
    },
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

  const onSubmit = (data: CAPAFormData) => {
    createMutation.mutate(data)
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Basic Information */}
        <Card>
          <CardHeader>
            <CardTitle>Nova Acao Corretiva (CAPA)</CardTitle>
            <CardDescription>
              ISO 17025 Clausula 8.2 - Registre a acao corretiva ou preventiva
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Titulo</Label>
              <Input
                {...register('title', {
                  required: 'Titulo e obrigatorio',
                  minLength: {
                    value: 5,
                    message: 'Titulo deve ter pelo menos 5 caracteres',
                  },
                })}
                placeholder="Titulo resumido da acao corretiva"
              />
              {errors.title && (
                <p className="text-sm text-destructive">
                  {errors.title.message}
                </p>
              )}
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Descricao</Label>
              <Textarea
                {...register('description', {
                  required: 'Descricao e obrigatoria',
                  minLength: {
                    value: 10,
                    message: 'Descricao deve ter pelo menos 10 caracteres',
                  },
                })}
                placeholder="Descreva detalhadamente o problema encontrado, incluindo evidencias e impacto..."
                rows={4}
              />
              {errors.description && (
                <p className="text-sm text-destructive">
                  {errors.description.message}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Detection Date */}
              <div className="space-y-2">
                <Label htmlFor="detectionDate">Data de Deteccao</Label>
                <Input
                  type="date"
                  {...register('detectionDate', {
                    required: 'Data de deteccao e obrigatoria',
                  })}
                />
                {errors.detectionDate && (
                  <p className="text-sm text-destructive">
                    {errors.detectionDate.message}
                  </p>
                )}
              </div>

              {/* Source */}
              <div className="space-y-2">
                <Label>Origem</Label>
                <Select
                  value={sourceValue}
                  onValueChange={(v) => setValue('source', v ?? '')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nc_detection">
                      Deteccao de NC
                    </SelectItem>
                    <SelectItem value="internal_audit">
                      Auditoria Interna
                    </SelectItem>
                    <SelectItem value="external_audit">
                      Auditoria Externa
                    </SelectItem>
                    <SelectItem value="customer_complaint">
                      Reclamacao de Cliente
                    </SelectItem>
                    <SelectItem value="management_review">
                      Revisao Gerencial
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Source Reference */}
            <div className="space-y-2">
              <Label htmlFor="sourceReference">
                Referencia da Origem (opcional)
              </Label>
              <Input
                {...register('sourceReference')}
                placeholder="Ex: NC-2024-0001, OS-2024-001, Reclamacao #123"
              />
              <p className="text-xs text-muted-foreground">
                Numero da NC, OS, reclamacao ou auditoria que originou esta
                CAPA.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Classification */}
        <Card>
          <CardHeader>
            <CardTitle>Classificacao</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {/* Type */}
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select
                  value={typeValue}
                  onValueChange={(v) => setValue('type', v ?? '')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="corrective">Corretiva</SelectItem>
                    <SelectItem value="preventive">Preventiva</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Severity */}
              <div className="space-y-2">
                <Label>Severidade</Label>
                <Select
                  value={severityValue}
                  onValueChange={(v) => setValue('severity', v ?? '')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minor">Menor</SelectItem>
                    <SelectItem value="major">Maior</SelectItem>
                    <SelectItem value="critical">Critica</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Category */}
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select
                  value={categoryValue}
                  onValueChange={(v) => setValue('category', v ?? '')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="method">Metodo</SelectItem>
                    <SelectItem value="equipment">Equipamento</SelectItem>
                    <SelectItem value="personnel">Pessoal</SelectItem>
                    <SelectItem value="procedure">Procedimento</SelectItem>
                    <SelectItem value="environment">Ambiente</SelectItem>
                    <SelectItem value="other">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Root Cause Analysis */}
        <Card>
          <CardHeader>
            <CardTitle>Analise de Causa Raiz (opcional)</CardTitle>
            <CardDescription>
              Pode ser preenchido posteriormente durante a investigacao
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* RCA Method */}
            <div className="space-y-2">
              <Label>Metodo de Analise</Label>
              <Select
                value={rcaMethodValue}
                onValueChange={(v) => setValue('rootCauseAnalysisMethod', v ?? '')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Nenhum</SelectItem>
                  <SelectItem value="5_whys">5 Porques (5 Whys)</SelectItem>
                  <SelectItem value="fishbone">
                    Diagrama de Ishikawa (Fishbone)
                  </SelectItem>
                  <SelectItem value="pareto">Analise de Pareto</SelectItem>
                  <SelectItem value="other">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* RCA Text */}
            <div className="space-y-2">
              <Label htmlFor="rootCauseAnalysis">Analise de Causa Raiz</Label>
              <Textarea
                {...register('rootCauseAnalysis')}
                placeholder={
                  rcaMethodValue === '5_whys'
                    ? '1. Por que? ...\n2. Por que? ...\n3. Por que? ...\n4. Por que? ...\n5. Por que? (causa raiz) ...'
                    : rcaMethodValue === 'fishbone'
                      ? 'Mao de Obra:\nMetodo:\nMaquina:\nMaterial:\nMeio Ambiente:\nMedicao:'
                      : 'Descreva a analise de causa raiz...'
                }
                rows={6}
              />
            </div>
          </CardContent>
        </Card>

        {/* Action Plan */}
        <Card>
          <CardHeader>
            <CardTitle>Plano de Acao</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Action Plan */}
            <div className="space-y-2">
              <Label htmlFor="actionPlan">Plano de Acao Corretiva</Label>
              <Textarea
                {...register('actionPlan', {
                  required: 'Plano de acao e obrigatorio',
                  minLength: {
                    value: 10,
                    message:
                      'Plano de acao deve ter pelo menos 10 caracteres',
                  },
                })}
                placeholder="Descreva as acoes a serem tomadas para corrigir o problema e prevenir recorrencia..."
                rows={4}
              />
              {errors.actionPlan && (
                <p className="text-sm text-destructive">
                  {errors.actionPlan.message}
                </p>
              )}
            </div>

            {/* Preventive Measures */}
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

            <Separator />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Responsible */}
              <div className="space-y-2">
                <Label>Responsavel</Label>
                <Select
                  value={watch('responsibleId')}
                  onValueChange={(v) => setValue('responsibleId', v ?? '')}
                >
                  <SelectTrigger>
                    <SelectValue />
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
                    Responsavel e obrigatorio
                  </p>
                )}
              </div>

              {/* Due Date */}
              <div className="space-y-2">
                <Label htmlFor="dueDate">Data Alvo</Label>
                <Input
                  type="date"
                  {...register('dueDate', {
                    required: 'Data alvo e obrigatoria',
                  })}
                />
                {errors.dueDate && (
                  <p className="text-sm text-destructive">
                    {errors.dueDate.message}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: '/dashboard/capa' })}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Criando...' : 'Criar CAPA'}
          </Button>
        </div>
      </form>
    </div>
  )
}
