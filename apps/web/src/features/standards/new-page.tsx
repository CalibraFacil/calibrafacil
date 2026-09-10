import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { FloppyDiskIcon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { calibraApi } from '@/utils/api'
import { StandardFormSections } from '@/features/standards/components/standard-form-sections'
import { ACTION_BUTTON_CLASS, Panel } from '@/components/instrument-panel'
import {
  createStandardFormData,
  parseStandardForm,
  type StandardFormData,
  type StandardFormField,
} from '@/features/standards/forms'
import type { CreateReferenceStandardInput } from '@calibra-facil/schemas'
import { cn } from '@/lib/utils'

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
  const isSaving = createMutation.isPending

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
      <div className="min-w-0 space-y-1">
        <h1 className="text-balance text-2xl font-semibold tracking-tight">
          Novo padrão
        </h1>
        <p className="max-w-2xl text-pretty text-sm text-muted-foreground">
          Cadastre o padrão como massa, canal ambiental, pressão, dimensional ou
          outra grandeza metrológica.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Panel className="p-4 sm:p-5">
          <StandardFormSections
            formData={formData}
            errors={errors}
            disabled={isSaving}
            onChange={(nextData) => {
              setFormData(nextData)
              setErrors({})
            }}
          />
        </Panel>

        <div className="sticky bottom-0 z-10 -mx-1 pt-2 pb-1">
          <div className="flex flex-col gap-3 rounded-2xl bg-card/95 p-3 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_16px_40px_rgba(15,23,42,0.08)] ring-1 ring-foreground/10 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <p className="px-1 text-pretty text-xs text-muted-foreground">
              Padrões ativos ficam disponíveis para vincular como
              rastreabilidade nas calibrações.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: '/dashboard/standards' })}
                disabled={isSaving}
                className={ACTION_BUTTON_CLASS}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSaving}
                className={cn(ACTION_BUTTON_CLASS, 'min-w-36')}
              >
                {isSaving ? (
                  <>
                    <Spinner className="mr-2 size-4" />
                    Salvando…
                  </>
                ) : (
                  <>
                    <HugeiconsIcon
                      icon={FloppyDiskIcon}
                      className="mr-2 size-4"
                    />
                    Criar padrão
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
