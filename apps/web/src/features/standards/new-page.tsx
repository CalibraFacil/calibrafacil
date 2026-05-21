import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { calibraApi } from '@/utils/api'
import { StandardFormSections } from '@/features/standards/components/standard-form-sections'
import {
  createStandardFormData,
  parseStandardForm,
  type StandardFormData,
  type StandardFormField,
} from '@/features/standards/forms'
import type { CreateReferenceStandardInput } from '@calibra-facil/schemas'

export function NewStandardPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [formData, setFormData] = useState<StandardFormData>(
    createStandardFormData(),
  )
  const [errors, setErrors] = useState<
    Partial<Record<StandardFormField, string>>
  >({})

  const createMutation = useMutation({
    mutationFn: async (data: CreateReferenceStandardInput) =>
      calibraApi.standards.create(Object.fromEntries(Object.entries(data))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['standards'] })
      toast.success('Padrão criado com sucesso.')
      navigate({ to: '/dashboard/standards' })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()

    const parsed = parseStandardForm(formData)
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

  return (
    <div className="space-y-6">
      <header className="border-b pb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Novo padrão</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Cadastre o padrão como massa, canal ambiental, pressão, dimensional ou
          outra grandeza metrológica.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-6">
        <StandardFormSections
          formData={formData}
          errors={errors}
          disabled={createMutation.isPending}
          onChange={(nextData) => {
            setFormData(nextData)
            setErrors({})
          }}
        />

        <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: '/dashboard/standards' })}
            disabled={createMutation.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Salvando...' : 'Criar padrão'}
          </Button>
        </div>
      </form>
    </div>
  )
}
