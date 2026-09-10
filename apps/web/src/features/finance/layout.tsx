import { Link, Outlet } from '@tanstack/react-router'
import { CreditCardIcon, ShieldKeyIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { useFinanceAccess } from '@/hooks/use-finance-access'
import { BlueprintOverlay, Panel } from '@/components/instrument-panel'
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

export function FinanceLayout() {
  const accessQuery = useFinanceAccess()

  if (accessQuery.isPending) {
    return (
      <div className="space-y-6">
        <Panel className="relative overflow-hidden p-5 sm:p-6">
          <BlueprintOverlay />
          <div className="relative space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
        </Panel>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
        <Skeleton className="h-80 w-full rounded-2xl" />
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
      <Panel className="relative overflow-hidden p-5 sm:p-6">
        <BlueprintOverlay />
        <div className="relative flex flex-col gap-1.5">
          <h1 className="text-balance text-2xl font-semibold tracking-tight">
            Financeiro
          </h1>
          <p className="max-w-2xl text-pretty text-sm text-muted-foreground">
            Cobrança, recebíveis, contratos e exportação para o ERP — o estado
            financeiro do laboratório em um só painel.
          </p>
        </div>
      </Panel>

      <Outlet />
    </div>
  )
}
