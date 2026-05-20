import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { Separator } from '@/components/ui/separator'
import {
  CloudOnlyOfflineState,
  useDesktopCloudOnlyUnavailable,
} from '@/runtime/sync-status'

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
  type: string
  severity: string
  category: string
  actionPlan: string
  responsibleId: string
  rootCauseAnalysis: string
  rootCauseAnalysisMethod: string
  preventiveMeasures: string
}

const SOURCE_LABELS: Record<string, string> = {
  nc_detection: 'Detecção de NC',
  internal_audit: 'Auditoria Interna',
  external_audit: 'Auditoria Externa',
  customer_complaint: 'Reclamação de Cliente',
  management_review: 'Revisão Gerencial',
}

const TYPE_LABELS: Record<string, string> = {
  corrective: 'Corretiva',
  preventive: 'Preventiva',
}

const SEVERITY_LABELS: Record<string, string> = {
  minor: 'Menor',
  major: 'Maior',
  critical: 'Crítica',
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

function NewCAPAPage() {
  const navigate = useNavigate()
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()
  const [detectionDate, setDetectionDate] = useState<Date | undefined>(
    new Date(),
  )
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined)

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
  const { data: membersData } = useQuery({
    queryKey: ['jobs', 'technicians'],
    enabled: !cloudOnlyUnavailable,
    queryFn: () => calibraApi.jobs.listTechnicians(),
  })

  const selectedMember = membersData?.data?.find(
    (m) => m.id === responsibleIdValue,
  )

  const createMutation = useMutation({
    mutationFn: async (payload: {
      title: string
      description: string
      source:
        | 'internal_audit'
        | 'customer_complaint'
        | 'nc_detection'
        | 'external_audit'
        | 'management_review'
      sourceReference?: string
      detectionDate: string
      type: 'corrective' | 'preventive'
      severity: 'minor' | 'major' | 'critical'
      category:
        | 'method'
        | 'equipment'
        | 'personnel'
        | 'procedure'
        | 'environment'
        | 'other'
      actionPlan: string
      responsibleId: string
      dueDate: string
      rootCauseAnalysis?: string
      rootCauseAnalysisMethod?: '5_whys' | 'fishbone' | 'pareto' | 'other'
      preventiveMeasures?: string
    }) => calibraApi.capas.create<{ id: number; capaNumber: string }>(payload),
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
    if (!detectionDate) {
      toast.error('Data de detecção é obrigatória')
      return
    }
    if (!dueDate) {
      toast.error('Data alvo é obrigatória')
      return
    }

    createMutation.mutate({
      title: data.title,
      description: data.description,
      source: data.source as
        | 'internal_audit'
        | 'customer_complaint'
        | 'nc_detection'
        | 'external_audit'
        | 'management_review',
      sourceReference: data.sourceReference || undefined,
      detectionDate: detectionDate.toISOString(),
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
      dueDate: dueDate.toISOString(),
      rootCauseAnalysis: data.rootCauseAnalysis || undefined,
      rootCauseAnalysisMethod: data.rootCauseAnalysisMethod
        ? (data.rootCauseAnalysisMethod as
            | '5_whys'
            | 'fishbone'
            | 'pareto'
            | 'other')
        : undefined,
      preventiveMeasures: data.preventiveMeasures || undefined,
    })
  }

  if (cloudOnlyUnavailable) {
    return (
      <CloudOnlyOfflineState title="Criação de CAPA indisponível offline" />
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Basic Information */}
        <Card>
          <CardHeader>
            <CardTitle>Nova Ação Corretiva (CAPA)</CardTitle>
            <CardDescription>
              ISO 17025 Cláusula 8.2 - Registre a ação corretiva ou preventiva
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Title */}
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

            {/* Description */}
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
              {/* Detection Date */}
              <div className="space-y-2">
                <Label>Data de Detecção</Label>
                <DatePicker
                  value={detectionDate}
                  onChange={setDetectionDate}
                  placeholder="Selecione a data"
                />
              </div>

              {/* Source */}
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
                    <SelectItem value="nc_detection">Detecção de NC</SelectItem>
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

            {/* Source Reference */}
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
          </CardContent>
        </Card>

        {/* Classification */}
        <Card>
          <CardHeader>
            <CardTitle>Classificação</CardTitle>
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
                    <span
                      className="flex flex-1 text-left line-clamp-1"
                      data-slot="select-value"
                    >
                      {TYPE_LABELS[typeValue] ?? 'Selecione o tipo'}
                    </span>
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
                    <span
                      className="flex flex-1 text-left line-clamp-1"
                      data-slot="select-value"
                    >
                      {SEVERITY_LABELS[severityValue] ??
                        'Selecione a severidade'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minor">Menor</SelectItem>
                    <SelectItem value="major">Maior</SelectItem>
                    <SelectItem value="critical">Crítica</SelectItem>
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
          </CardContent>
        </Card>

        {/* Root Cause Analysis */}
        <Card>
          <CardHeader>
            <CardTitle>Análise de Causa Raiz (opcional)</CardTitle>
            <CardDescription>
              Pode ser preenchido posteriormente durante a investigação
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* RCA Method */}
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

            {/* RCA Text */}
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
          </CardContent>
        </Card>

        {/* Action Plan */}
        <Card>
          <CardHeader>
            <CardTitle>Plano de Ação</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Action Plan */}
            <div className="space-y-2">
              <Label htmlFor="actionPlan">Plano de Ação Corretiva</Label>
              <Textarea
                {...register('actionPlan', {
                  required: 'Plano de ação é obrigatório',
                  minLength: {
                    value: 10,
                    message: 'Plano de ação deve ter pelo menos 10 caracteres',
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

              {/* Due Date */}
              <div className="space-y-2">
                <Label>Data Alvo</Label>
                <DatePicker
                  value={dueDate}
                  onChange={setDueDate}
                  placeholder="Selecione a data alvo"
                />
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
