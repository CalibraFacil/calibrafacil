import { createFileRoute } from '@tanstack/react-router'

import {
  loadBackofficeSupportData,
  useBackofficeSupportQueueData,
} from '@/features/backoffice/queries'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/backoffice/support')({
  loader: ({ context }) => loadBackofficeSupportData(context.queryClient),
  component: BackofficeSupportPage,
})

function BackofficeSupportPage() {
  const queueQuery = useBackofficeSupportQueueData('list')

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
          {queueQuery.isPending
            ? Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-24 w-full" />
              ))
            : queueQuery.data?.data.map((request) => (
                <div key={request.id} className="rounded-lg border p-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1">
                      <p className="font-medium">{request.subject}</p>
                      <p className="text-sm text-muted-foreground">
                        {request.organization?.name ??
                          'Organização desconhecida'}{' '}
                        · {request.category}
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
                    Atribuído para:{' '}
                    {request.assignedToUser?.email ?? 'Não atribuído'}
                  </p>
                </div>
              ))}
        </CardContent>
      </Card>
    </div>
  )
}
