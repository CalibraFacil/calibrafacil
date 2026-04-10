import { Link, Outlet, createFileRoute } from '@tanstack/react-router'
import { CreditCardIcon, ShieldKeyIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { useFinanceAccess } from '@/hooks/use-finance-access'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/dashboard/finance')({
  head: () => ({
    meta: [{ title: 'Financeiro | CalibraFácil' }],
  }),
  component: FinanceLayout,
})

function FinanceLayout() {
  const accessQuery = useFinanceAccess()

  if (accessQuery.isPending) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    )
  }

  if (accessQuery.isError || !accessQuery.data) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={CreditCardIcon} />
          </EmptyMedia>
          <EmptyTitle>Não foi possível carregar o módulo financeiro</EmptyTitle>
          <EmptyDescription>
            Verifique sua sessão ou tente novamente em instantes.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (!accessQuery.data.hasFinancialModule) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={CreditCardIcon} />
          </EmptyMedia>
          <EmptyTitle>Módulo financeiro indisponível no plano atual</EmptyTitle>
          <EmptyDescription>
            O Financeiro operacional fica disponível a partir dos planos
            Professional e Enterprise.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button render={<Link to="/dashboard/settings/subscription" />}>
            Ver assinatura da plataforma
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  if (!accessQuery.data.canReadFinancial) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={ShieldKeyIcon} />
          </EmptyMedia>
          <EmptyTitle>Seu perfil não opera o financeiro</EmptyTitle>
          <EmptyDescription>
            O módulo Financeiro é restrito a owners e admins. Técnicos recebem
            apenas contexto financeiro nas telas operacionais.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
        <p className="text-muted-foreground">
          Contratos comerciais, documentos de cobrança, recebimentos e
          exportação ERP.
        </p>
      </div>

      <Outlet />
    </div>
  )
}
