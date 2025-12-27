import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'

import type { MethodData } from '@/components/method-builder'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { MethodBuilder } from '@/components/method-builder'

export const Route = createFileRoute('/dashboard/methods/new')({
  head: () => ({
    meta: [{ title: 'Novo Método | CalibraFacil' }],
  }),
  component: NewMethodPage,
})

function NewMethodPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const createMutation = useMutation({
    mutationFn: async (data: MethodData) => {
      const res = await api.api.methods.$post({
        json: {
          name: data.name,
          description: data.description,
          assetTypeId: data.assetTypeId,
          dataFields: data.dataFields,
          formulas: data.formulas,
          validations: data.validations,
          uncertaintyParams: data.uncertaintyParams,
        },
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao criar método',
        )
      }

      return res.json() as Promise<{ id: number }>
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['methods'] })
      toast.success('Método salvo como rascunho')
      navigate({
        to: '/dashboard/methods/$id/edit',
        params: { id: String(data.id) },
      })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/dashboard/methods' })}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 h-4 w-4" />
          Voltar
        </Button>
      </div>

      <div className="flex-1 min-h-0">
        <MethodBuilder
          onSave={(data) => createMutation.mutate(data)}
          isSaving={createMutation.isPending}
          isNew
        />
      </div>
    </div>
  )
}
