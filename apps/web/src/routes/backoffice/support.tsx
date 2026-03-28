import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/utils/api'

export const Route = createFileRoute('/backoffice/support')({
  component: BackofficeSupportPage,
})

type SupportQueueItem = {
  id: number
  subject: string
  category: string
  priority: string
  status: string
  organization: { name: string; slug: string } | null
  requestedByUser: { name: string; email: string } | null
  assignedToUser: { name: string; email: string } | null
  createdAt: string
}

function BackofficeSupportPage() {
  const queueQuery = useQuery({
    queryKey: ['backoffice', 'support', 'queue'],
    queryFn: async () => {
      const res = await api.api.backoffice.support.queue.$get()
      if (!res.ok) {
        throw new Error('Falha ao carregar fila de suporte')
      }

      return res.json() as Promise<{ data: SupportQueueItem[] }>
    },
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Suporte</h1>
        <p className="text-sm text-muted-foreground">
          Fila operacional consolidada de solicitações do laboratório.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fila operacional</CardTitle>
          <CardDescription>
            Solicitações abertas e recentes em todas as organizações.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {queueQuery.isPending ? (
            Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-24 w-full" />
            ))
          ) : (
            queueQuery.data?.data.map((request) => (
              <div key={request.id} className="rounded-lg border p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-1">
                    <p className="font-medium">{request.subject}</p>
                    <p className="text-sm text-muted-foreground">
                      {request.organization?.name ?? 'Organização desconhecida'} ·{' '}
                      {request.category}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Solicitante: {request.requestedByUser?.email ?? 'N/D'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{request.priority}</Badge>
                    <Badge>{request.status}</Badge>
                  </div>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Atribuído para: {request.assignedToUser?.email ?? 'Não atribuído'}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
