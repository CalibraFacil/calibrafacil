import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'

import { calibraApi } from '@/utils/api'
import { useNewCompetenceMatrixData } from '@/features/personnel/queries'
import {
  parseCompetenceRequestForm,
  type CompetenceRequestFormData,
  type CompetenceRequestFormField,
} from '@/features/personnel/forms'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
} from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { ACTION_BUTTON_CLASS, Panel } from '@/components/instrument-panel'
import { cn } from '@/lib/utils'

const COMPETENCE_LIFECYCLE = [
  {
    title: 'Solicitada',
    description: 'Você abre o pedido de qualificação para um escopo.',
  },
  {
    title: 'Treinamento',
    description: 'Treinamentos são atribuídos e concluídos.',
  },
  {
    title: 'Avaliação',
    description: 'A eficácia da capacitação é avaliada.',
  },
  {
    title: 'Ativa',
    description: 'O técnico fica habilitado para o escopo.',
  },
]

export function NewCompetencePage() {
  const navigate = useNavigate()
  const [formData, setFormData] = useState<CompetenceRequestFormData>({
    userId: '',
    assetTypeId: '',
    scopeDescription: '',
  })
  const [errors, setErrors] = useState<
    Partial<Record<CompetenceRequestFormField, string>>
  >({})

  // Fetch org members (technicians/admins/owners)
  const { data: matrixData } = useNewCompetenceMatrixData()

  const createMutation = useMutation({
    mutationFn: async (payload: {
      userId: string
      assetTypeId?: number
      scopeDescription: string
    }) => calibraApi.competences.create<{ id: number }>(payload),
    onSuccess: (result) => {
      toast.success('Solicitação de competência criada')
      navigate({
        to: '/dashboard/personnel/$id',
        params: { id: String(result.id) },
      })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const parsed = parseCompetenceRequestForm(formData)
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.fieldErrors.map((error) => [error.field, error.message]),
        ),
      )
      toast.error(parsed.message)
      return
    }

    setErrors({})
    createMutation.mutate(parsed.data)
  }

  const selectedTechnician = matrixData?.technicians.find(
    (t) => t.userId === formData.userId,
  )
  const selectedAssetType = matrixData?.assetTypes.find(
    (at) => String(at.id) === formData.assetTypeId,
  )

  return (
    <div className="space-y-6">
      <div className="min-w-0 space-y-1">
        <h1 className="text-balance text-2xl font-semibold tracking-tight">
          Nova solicitação de competência
        </h1>
        <p className="max-w-2xl text-pretty text-sm text-muted-foreground">
          Inicie o ciclo de qualificação de um técnico para um escopo de
          calibração.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <Panel className="p-5">
          <form onSubmit={handleSubmit} className="space-y-6">
            <FieldGroup>
              {/* Technician */}
              <Field>
                <FieldLabel>Técnico *</FieldLabel>
                <Select
                  value={formData.userId}
                  onValueChange={(v) =>
                    setFormData((current) => ({
                      ...current,
                      userId: v ?? '',
                    }))
                  }
                >
                  <SelectTrigger>
                    <span
                      className="flex flex-1 text-left line-clamp-1"
                      data-slot="select-value"
                    >
                      {selectedTechnician
                        ? selectedTechnician.userName
                        : 'Selecione o técnico'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {matrixData?.technicians.map((tech) => (
                      <SelectItem key={tech.userId} value={tech.userId}>
                        {tech.userName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.userId && <FieldError>{errors.userId}</FieldError>}
              </Field>

              {/* Asset Type */}
              <Field>
                <FieldLabel>Tipo de instrumento (opcional)</FieldLabel>
                <Select
                  value={formData.assetTypeId}
                  onValueChange={(v) =>
                    setFormData((current) => ({
                      ...current,
                      assetTypeId: v ?? '',
                    }))
                  }
                >
                  <SelectTrigger>
                    <span
                      className="flex flex-1 text-left line-clamp-1"
                      data-slot="select-value"
                    >
                      {selectedAssetType
                        ? selectedAssetType.name
                        : 'Escopo geral'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Escopo geral</SelectItem>
                    {matrixData?.assetTypes.map((at) => (
                      <SelectItem key={at.id} value={String(at.id)}>
                        {at.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Deixe vazio para uma competência de escopo geral.
                </p>
              </Field>

              {/* Scope Description */}
              <Field>
                <FieldLabel>Descrição do escopo *</FieldLabel>
                <Textarea
                  value={formData.scopeDescription}
                  onChange={(e) =>
                    setFormData((current) => ({
                      ...current,
                      scopeDescription: e.target.value,
                    }))
                  }
                  placeholder="Ex: Calibração de Balanças Analíticas até 220g"
                  rows={3}
                />
                {errors.scopeDescription && (
                  <FieldError>{errors.scopeDescription}</FieldError>
                )}
              </Field>
            </FieldGroup>

            <div className="flex justify-end gap-3 border-t pt-5">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: '/dashboard/personnel' })}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className={ACTION_BUTTON_CLASS}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? 'Criando...' : 'Criar Solicitação'}
              </Button>
            </div>
          </form>
        </Panel>

        <aside className="space-y-4">
          <Panel className="p-5">
            <h2 className="mt-0.5 text-base font-semibold">
              Ciclo de qualificação
            </h2>
            <ol className="mt-4 space-y-3">
              {COMPETENCE_LIFECYCLE.map((step, index) => {
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
              Descreva o escopo como aparece no certificado — faixa, exatidão e
              tipo de instrumento.
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  )
}
