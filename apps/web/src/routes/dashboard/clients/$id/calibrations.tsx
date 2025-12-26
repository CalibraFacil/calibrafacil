import { createFileRoute } from '@tanstack/react-router'
import { Certificate01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

export const Route = createFileRoute('/dashboard/clients/$id/calibrations')({
  component: ClientCalibrationsTab,
})

function ClientCalibrationsTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Calibrações</CardTitle>
        <CardDescription>
          Histórico de calibrações deste cliente.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Empty className="py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Certificate01Icon} />
            </EmptyMedia>
            <EmptyTitle>Em breve</EmptyTitle>
            <EmptyDescription>
              O histórico de calibrações estará disponível em uma próxima
              atualização.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent />
        </Empty>
      </CardContent>
    </Card>
  )
}
