import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api } from '@/utils/api'
import { methodRouteId } from '@/lib/route-identifiers'
import {
  MethodBuilder,
  draftToMethodSavePayload,
  methodDataToDraft,
  type MethodDraft,
} from '@/components/method-builder'

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
    mutationFn: async (draft: MethodDraft) => {
      const payload = draftToMethodSavePayload(draft)
      const res = await api.api.methods.$post({
        json: payload,
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
          initialDraft={methodDataToDraft()}
          onSave={(data) => createMutation.mutate(data)}
          onCancel={() => navigate({ to: '/dashboard/methods' })}
          isSaving={createMutation.isPending}
          isNew
        />
      </div>
    </div>
  )
}
