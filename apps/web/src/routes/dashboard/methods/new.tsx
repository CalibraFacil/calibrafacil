import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import type { MethodData } from '@/components/method-builder'

import { api } from '@/utils/api'
import { MethodBuilder } from '@/components/method-builder'
import { methodRouteId } from '@/lib/route-identifiers'

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
          variableBindings: data.variableBindings ?? [],
          formulas: data.formulas,
          validations: data.validations,
          uncertaintyParams: data.uncertaintyParams,
          certificateContent: data.certificateContent,
        },
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao criar método',
        )
      }

      return res.json() as Promise<{
        id: number
        name: string
        version: number
      }>
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['methods'] })
      toast.success('Método salvo como rascunho')
      navigate({
        to: '/dashboard/methods/$id/edit',
        params: { id: methodRouteId(data) },
      })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 min-h-0">
        <MethodBuilder
          onSave={(data) => createMutation.mutate(data)}
          onCancel={() => navigate({ to: '/dashboard/methods' })}
          isSaving={createMutation.isPending}
          isNew
        />
      </div>
    </div>
  )
}
