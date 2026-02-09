import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
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
import { Field, FieldGroup, FieldLabel, FieldError } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'

export const Route = createFileRoute('/dashboard/personnel/new')({
  head: () => ({
    meta: [{ title: 'Nova Solicitação de Competência | CalibraFacil' }],
  }),
  component: NewCompetencePage,
})

function NewCompetencePage() {
  const navigate = useNavigate()
  const [userId, setUserId] = useState('')
  const [assetTypeId, setAssetTypeId] = useState('')
  const [scopeDescription, setScopeDescription] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Fetch org members (technicians/admins/owners)
  const { data: matrixData } = useQuery({
    queryKey: ['competences-matrix'],
    queryFn: async () => {
      const res = await api.api.competences.matrix.$get()
      if (!res.ok) throw new Error('Falha ao carregar dados')
      return res.json() as Promise<{
        technicians: Array<{ userId: string; userName: string; role: string }>
        assetTypes: Array<{ id: number; name: string }>
        competences: Array<unknown>
      }>
    },
  })

  const createMutation = useMutation({
    mutationFn: async (payload: {
      userId: string
      assetTypeId?: number
      scopeDescription: string
    }) => {
      const res = await api.api.competences.$post({ json: payload })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(
          (err as { error?: string }).error || 'Erro ao criar solicitação',
        )
      }
      return res.json() as Promise<{ id: number }>
    },
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

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!userId) newErrors.userId = 'Selecione um técnico'
    if (!scopeDescription.trim())
      newErrors.scopeDescription = 'Descrição do escopo é obrigatória'
    if (scopeDescription.trim().length < 5)
      newErrors.scopeDescription = 'Descrição deve ter pelo menos 5 caracteres'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    createMutation.mutate({
      userId,
      assetTypeId: assetTypeId ? Number(assetTypeId) : undefined,
      scopeDescription: scopeDescription.trim(),
    })
  }

  const selectedTechnician = matrixData?.technicians.find(
    (t) => t.userId === userId,
  )
  const selectedAssetType = matrixData?.assetTypes.find(
    (at) => String(at.id) === assetTypeId,
  )

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Nova Solicitação de Competência</CardTitle>
          <CardDescription>
            ISO 17025 Cláusula 6.2.3 - Solicite a qualificação de um técnico para
            um tipo de instrumento
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <FieldGroup>
              {/* Technician */}
              <Field>
                <FieldLabel>Técnico *</FieldLabel>
                <Select value={userId} onValueChange={(v) => setUserId(v ?? '')}>
                  <SelectTrigger>
                    <span className="flex flex-1 text-left line-clamp-1" data-slot="select-value">
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
                <FieldLabel>Tipo de Instrumento (opcional)</FieldLabel>
                <Select
                  value={assetTypeId}
                  onValueChange={(v) => setAssetTypeId(v ?? '')}
                >
                  <SelectTrigger>
                    <span className="flex flex-1 text-left line-clamp-1" data-slot="select-value">
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
                <FieldLabel>Descrição do Escopo *</FieldLabel>
                <Textarea
                  value={scopeDescription}
                  onChange={(e) => setScopeDescription(e.target.value)}
                  placeholder="Ex: Calibração de Balanças Analíticas até 220g"
                  rows={3}
                />
                {errors.scopeDescription && (
                  <FieldError>{errors.scopeDescription}</FieldError>
                )}
              </Field>
            </FieldGroup>

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: '/dashboard/personnel' })}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending
                  ? 'Criando...'
                  : 'Criar Solicitação'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
