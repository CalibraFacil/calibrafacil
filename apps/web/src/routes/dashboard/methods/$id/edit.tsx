import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  MethodBuilder,
  draftToMethodSavePayload,
  methodDataToDraft,
  type MethodRecordData,
  type MethodDraft,
} from '@/components/method-builder'

export const Route = createFileRoute('/dashboard/methods/$id/edit')({
  head: () => ({
    meta: [{ title: 'Editar Método | CalibraFácil' }],
  }),
  component: EditMethodPage,
})

function EditMethodPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const {
    data: method,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['methods', id],
    queryFn: async () => {
      const res = await api.api.methods[':id'].$get({
        param: { id },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar método')
      }

      return res.json() as Promise<MethodRecordData>
    },
  })

  const updateMutation = useMutation({
    mutationFn: async (draft: MethodDraft) => {
      const payload = draftToMethodSavePayload(draft)
      const res = await api.api.methods[':id'].$put({
        param: { id: String(method?.id ?? id) },
        json: payload,
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao atualizar método',
        )
      }

      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['methods'] })
      toast.success('Método salvo')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  if (error) {
    return (
      <div className="p-6">
        <p className="text-red-500">Erro ao carregar método: {error.message}</p>
      </div>
    )
  }

  if (isLoading || !method) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-4">
          <Skeleton className="h-150 w-1/2" />
          <Skeleton className="h-150 w-1/2" />
        </div>
      </div>
    )
  }

  if (method.status !== 'DRAFT') {
    return (
      <div className="p-6">
        <p>
          Este método não está em rascunho e não pode ser editado diretamente.
          Crie uma nova versão para fazer alterações.
        </p>
        <Button
          variant="outline"
          onClick={() => navigate({ to: '/dashboard/methods' })}
          className="mt-4"
        >
          Voltar
        </Button>
      </div>
    )
  }

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
          initialDraft={methodDataToDraft(method)}
          onSave={(data) => updateMutation.mutate(data)}
          onCancel={() => navigate({ to: '/dashboard/methods' })}
          onPublished={() => {
            queryClient.invalidateQueries({ queryKey: ['methods'] })
            navigate({ to: '/dashboard/methods' })
          }}
          isSaving={updateMutation.isPending}
        />
      </div>
    </div>
  )
}
