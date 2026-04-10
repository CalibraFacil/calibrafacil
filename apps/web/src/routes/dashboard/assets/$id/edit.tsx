import {
  Link,
  createFileRoute,
  useNavigate,
  useParams,
} from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { DatePicker } from '@/components/ui/date-picker'
import {
  DynamicSpecsForm,
  type SpecFieldDefinition,
} from '@/components/dynamic-specs-form'

export const Route = createFileRoute('/dashboard/assets/$id/edit')({
  head: () => ({
    meta: [{ title: 'Editar Ativo | CalibraFácil' }],
  }),
  component: EditAssetPage,
})

const statusLabels: Record<FormData['status'], string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  MAINTENANCE: 'Em Manutenção',
  SCRAPPED: 'Descartado',
}

interface FormData {
  name: string
  manufacturer: string
  model: string
  serialNumber: string
  tag: string
  status: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE' | 'SCRAPPED'
  lastCalibrationDate: Date | undefined
  nextCalibrationDate: Date | undefined
  comments: string
  specifications: Record<string, unknown>
}

type AssetData = {
  id: number | string
  name: string
  manufacturer?: string | null
  model?: string | null
  serialNumber: string
  tag: string
  status: string
  customerName?: string | null
  assetTypeName?: string | null
  lastCalibrationDate?: string | Date | null
  nextCalibrationDate?: string | Date | null
  comments?: string | null
  specifications?: Record<string, unknown> | null
  assetTypeDefinition?: SpecFieldDefinition[] | null
}

function parseDate(date: string | Date | null | undefined): Date | undefined {
  if (!date) return undefined
  const d = new Date(date)
  return isNaN(d.getTime()) ? undefined : d
}

function EditAssetPage() {
  const { id } = useParams({ from: '/dashboard/assets/$id/edit' })

  // Fetch the asset data
  const {
    data: asset,
    isLoading,
    error: fetchError,
  } = useQuery({
    queryKey: ['asset', id],
    queryFn: async () => {
      const res = await api.api.assets[':id'].$get({
        param: { id },
      })
      if (!res.ok) {
        throw new Error('Falha ao carregar ativo')
      }
      return res.json() as Promise<AssetData>
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Button variant="ghost" size="sm" disabled className="mb-4">
            <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 size-4" />
            Voltar
          </Button>
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (fetchError || !asset) {
    return (
      <div className="space-y-6">
        <div>
          <Button
            variant="ghost"
            size="sm"
            render={<Link to="/dashboard/assets" />}
            className="mb-4"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 size-4" />
            Voltar
          </Button>
        </div>
        <Card>
          <CardContent className="py-8 text-center text-destructive">
            Erro ao carregar ativo. Tente novamente.
          </CardContent>
        </Card>
      </div>
    )
  }

  return <EditAssetForm key={asset.id} asset={asset} assetId={id} />
}

function EditAssetForm({
  asset,
  assetId,
}: {
  asset: AssetData
  assetId: string
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [formData, setFormData] = useState<FormData>({
    name: asset.name,
    manufacturer: asset.manufacturer || '',
    model: asset.model || '',
    serialNumber: asset.serialNumber,
    tag: asset.tag,
    status: asset.status as FormData['status'],
    lastCalibrationDate: parseDate(asset.lastCalibrationDate),
    nextCalibrationDate: parseDate(asset.nextCalibrationDate),
    comments: asset.comments || '',
    specifications: (asset.specifications as Record<string, unknown>) || {},
  })
  const [errors, setErrors] = useState<
    Partial<Record<keyof FormData | string, string>>
  >({})

  // Get the asset type definition from the asset data
  const assetTypeDefinition = useMemo(() => {
    if (!asset.assetTypeDefinition) return []
    return asset.assetTypeDefinition as SpecFieldDefinition[]
  }, [asset.assetTypeDefinition])

  const updateMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await api.api.assets[':id'].$put({
        param: { id: assetId },
        json: {
          name: data.name,
          manufacturer: data.manufacturer || undefined,
          model: data.model || undefined,
          serialNumber: data.serialNumber,
          tag: data.tag,
          status: data.status,
          lastCalibrationDate:
            data.lastCalibrationDate?.toISOString() || undefined,
          nextCalibrationDate:
            data.nextCalibrationDate?.toISOString() || undefined,
          comments: data.comments || undefined,
          specifications:
            Object.keys(data.specifications).length > 0
              ? data.specifications
              : undefined,
        },
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao atualizar ativo',
        )
      }

      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] })
      queryClient.invalidateQueries({ queryKey: ['asset', assetId] })
      toast.success('Ativo atualizado com sucesso!')
      navigate({ to: '/dashboard/assets/$id', params: { id: assetId } })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof FormData | string, string>> = {}

    if (!formData.name.trim()) {
      newErrors.name = 'Nome é obrigatório'
    } else if (formData.name.trim().length < 2) {
      newErrors.name = 'Nome deve ter pelo menos 2 caracteres'
    }

    if (!formData.serialNumber.trim()) {
      newErrors.serialNumber = 'Número de série é obrigatório'
    }

    if (!formData.tag.trim()) {
      newErrors.tag = 'Tag é obrigatória'
    }

    // Validate required specification fields
    if (assetTypeDefinition.length > 0) {
      for (const field of assetTypeDefinition) {
        if (field.required) {
          const value = formData.specifications[field.key]
          if (value === undefined || value === null || value === '') {
            newErrors[`spec_${field.key}`] = `${field.label} é obrigatório`
          }
        }
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!validate()) {
      return
    }

    updateMutation.mutate(formData)
  }

  const updateField = <TKey extends keyof FormData>(
    field: TKey,
    value: FormData[TKey],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  // Get specification errors in the format expected by DynamicSpecsForm
  const specErrors = useMemo(() => {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(errors)) {
      if (key.startsWith('spec_') && value) {
        result[key.replace('spec_', '')] = value
      }
    }
    return result
  }, [errors])

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          render={<Link to="/dashboard/assets/$id" params={{ id: assetId }} />}
          className="mb-4"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 size-4" />
          Voltar
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Editar Ativo</CardTitle>
          <CardDescription>
            Atualize as informações do equipamento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              {/* Customer - Read only */}
              <Field>
                <FieldLabel>Cliente</FieldLabel>
                <Input value={asset.customerName ?? ''} disabled />
                <FieldDescription>
                  O cliente não pode ser alterado após o cadastro.
                </FieldDescription>
              </Field>

              {/* Asset Type - Read only */}
              <Field>
                <FieldLabel>Tipo de Instrumento</FieldLabel>
                <Input value={asset.assetTypeName ?? ''} disabled />
                <FieldDescription>
                  O tipo de instrumento não pode ser alterado após o cadastro.
                </FieldDescription>
              </Field>

              {/* Name */}
              <Field>
                <FieldLabel htmlFor="name">Nome do Equipamento *</FieldLabel>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="Ex: Balança Analítica"
                  disabled={updateMutation.isPending}
                />
                {errors.name && <FieldError>{errors.name}</FieldError>}
              </Field>

              {/* Tag */}
              <Field>
                <FieldLabel htmlFor="tag">Tag / ID Interno *</FieldLabel>
                <Input
                  id="tag"
                  value={formData.tag}
                  onChange={(e) => updateField('tag', e.target.value)}
                  placeholder="Ex: BAL-001"
                  disabled={updateMutation.isPending}
                />
                <FieldDescription>
                  Identificador único do ativo no laboratório.
                </FieldDescription>
                {errors.tag && <FieldError>{errors.tag}</FieldError>}
              </Field>

              {/* Manufacturer and Model */}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="manufacturer">Fabricante</FieldLabel>
                  <Input
                    id="manufacturer"
                    value={formData.manufacturer}
                    onChange={(e) =>
                      updateField('manufacturer', e.target.value)
                    }
                    placeholder="Ex: Mettler Toledo"
                    disabled={updateMutation.isPending}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="model">Modelo</FieldLabel>
                  <Input
                    id="model"
                    value={formData.model}
                    onChange={(e) => updateField('model', e.target.value)}
                    placeholder="Ex: XPE205"
                    disabled={updateMutation.isPending}
                  />
                </Field>
              </div>

              {/* Serial Number */}
              <Field>
                <FieldLabel htmlFor="serialNumber">
                  Número de Série *
                </FieldLabel>
                <Input
                  id="serialNumber"
                  value={formData.serialNumber}
                  onChange={(e) => updateField('serialNumber', e.target.value)}
                  placeholder="Número de série do fabricante"
                  disabled={updateMutation.isPending}
                />
                {errors.serialNumber && (
                  <FieldError>{errors.serialNumber}</FieldError>
                )}
              </Field>

              {/* Status */}
              <Field>
                <FieldLabel htmlFor="status">Status</FieldLabel>
                <Select
                  value={formData.status}
                  onValueChange={(value) => {
                    if (value)
                      updateField('status', value as FormData['status'])
                  }}
                  disabled={updateMutation.isPending}
                >
                  <SelectTrigger>
                    <span>{statusLabels[formData.status]}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Ativo</SelectItem>
                    <SelectItem value="INACTIVE">Inativo</SelectItem>
                    <SelectItem value="MAINTENANCE">Em Manutenção</SelectItem>
                    <SelectItem value="SCRAPPED">Descartado</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              {/* Dynamic Specifications Form */}
              {assetTypeDefinition.length > 0 && (
                <DynamicSpecsForm
                  definition={assetTypeDefinition}
                  value={formData.specifications}
                  onChange={(specs) => updateField('specifications', specs)}
                  disabled={updateMutation.isPending}
                  errors={specErrors}
                />
              )}

              {/* Calibration Dates */}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="lastCalibrationDate">
                    Última Calibração
                  </FieldLabel>
                  <DatePicker
                    value={formData.lastCalibrationDate}
                    onChange={(date) =>
                      updateField('lastCalibrationDate', date)
                    }
                    placeholder="Selecione a data"
                    disabled={updateMutation.isPending}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="nextCalibrationDate">
                    Próxima Calibração
                  </FieldLabel>
                  <DatePicker
                    value={formData.nextCalibrationDate}
                    onChange={(date) =>
                      updateField('nextCalibrationDate', date)
                    }
                    placeholder="Selecione a data"
                    disabled={updateMutation.isPending}
                  />
                </Field>
              </div>

              {/* Comments */}
              <Field>
                <FieldLabel htmlFor="comments">Observações</FieldLabel>
                <Textarea
                  id="comments"
                  value={formData.comments}
                  onChange={(e) => updateField('comments', e.target.value)}
                  placeholder="Observações adicionais sobre o equipamento..."
                  disabled={updateMutation.isPending}
                  rows={3}
                />
              </Field>

              {/* Submit */}
              <div className="flex justify-end gap-4 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  render={<Link to="/dashboard/assets/$id" params={{ id: assetId }} />}
                  disabled={updateMutation.isPending}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending
                    ? 'Salvando...'
                    : 'Salvar Alterações'}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
