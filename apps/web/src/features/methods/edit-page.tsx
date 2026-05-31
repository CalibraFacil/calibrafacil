import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { toast } from 'sonner'

import { calibraApi } from '@/utils/api'
import { useMethodEditData } from '@/features/methods/queries'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ACTION_BUTTON_CLASS, Panel } from '@/components/instrument-panel'
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
      <Panel className="p-8 text-center">
        <p className="text-sm text-destructive">
          Erro ao carregar método: {error.message}
        </p>
      </Panel>
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
      <Panel className="space-y-4 p-6 sm:p-8">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Método não editável</h2>
          <p className="max-w-prose text-pretty text-sm leading-6 text-muted-foreground">
            Este método não está em rascunho e não pode ser editado diretamente.
            Crie uma nova versão para fazer alterações.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => navigate({ to: '/dashboard/methods' })}
          className={ACTION_BUTTON_CLASS}
        >
          Ver métodos
        </Button>
      </Panel>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
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
