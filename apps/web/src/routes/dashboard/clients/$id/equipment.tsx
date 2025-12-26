import { createFileRoute } from '@tanstack/react-router'
import { ToolsIcon } from '@hugeicons/core-free-icons'
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

export const Route = createFileRoute('/dashboard/clients/$id/equipment')({
  component: ClientEquipmentTab,
})

function ClientEquipmentTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Equipamentos</CardTitle>
        <CardDescription>
          Equipamentos cadastrados deste cliente.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Empty className="py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={ToolsIcon} />
            </EmptyMedia>
            <EmptyTitle>Em breve</EmptyTitle>
            <EmptyDescription>
              O gerenciamento de equipamentos estara disponivel em uma proxima
              atualizacao.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent />
        </Empty>
      </CardContent>
    </Card>
  )
}
