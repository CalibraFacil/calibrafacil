import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { toast } from 'sonner'

import { calibraApi } from '@/utils/api'
import { methodRouteId } from '@/lib/route-identifiers'
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

export function NewMethodPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const createMutation = useMutation({
    mutationFn: async (draft: MethodDraft) => {
      const payload = draftToMethodSavePayload(draft)
      return calibraApi.methods.create(payload) as Promise<{
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
        <Suspense fallback={<MethodBuilderSkeleton />}>
          <MethodBuilder
            initialDraft={methodDataToDraft()}
            onSave={(data) => createMutation.mutateAsync(data)}
            onCancel={() => navigate({ to: '/dashboard/methods' })}
            isSaving={createMutation.isPending}
            isNew
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
