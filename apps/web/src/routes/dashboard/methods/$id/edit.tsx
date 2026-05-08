import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'

import type { MethodData } from '@/components/method-builder'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { MethodBuilder } from '@/components/method-builder'

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

      return res.json() as Promise<MethodData>
    },
  })

  const updateMutation = useMutation({
    mutationFn: async (data: MethodData) => {
      const res = await api.api.methods[':id'].$put({
        param: { id: String(method?.id ?? id) },
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

  const publishMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api.methods[':id']['request-approval'].$post({
        param: { id: String(method?.id ?? id) },
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao solicitar aprovação',
        )
      }

      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['methods'] })
      toast.success('Método enviado para aprovação')
      navigate({ to: '/dashboard/methods' })
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
          initialData={method}
          onSave={(data) => updateMutation.mutate(data)}
          onPublish={() => publishMutation.mutate()}
          isSaving={updateMutation.isPending}
          isPublishing={publishMutation.isPending}
        />
      </div>
    </div>
  )
}
