import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'

import { calibraApi } from '@/utils/api'
import { useMethodEditData } from '@/features/methods/queries'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  draftToMethodSavePayload,
  methodDataToDraft,
} from '@/components/method-builder/adapters'
import type { MethodDraft } from '@/components/method-builder/types'

const MethodBuilder = lazy(() =>
  import('@/components/method-builder/method-builder').then((module) => ({
    default: module.MethodBuilder,
  })),
)

export function EditMethodPage({ id }: { id: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: method, isLoading, error } = useMethodEditData(id)

  const updateMutation = useMutation({
    mutationFn: async (draft: MethodDraft) => {
      const payload = draftToMethodSavePayload(draft)
      return calibraApi.methods.update(method?.id ?? id, payload)
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
        <Suspense fallback={<MethodBuilderSkeleton />}>
          <MethodBuilder
            initialDraft={methodDataToDraft(method)}
            onSave={(data) => updateMutation.mutateAsync(data)}
            onCancel={() => navigate({ to: '/dashboard/methods' })}
            onPublished={() => {
              queryClient.invalidateQueries({ queryKey: ['methods'] })
              navigate({ to: '/dashboard/methods' })
            }}
            isSaving={updateMutation.isPending}
          />
        </Suspense>
      </div>
    </div>
  )
}

function MethodBuilderSkeleton() {
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
