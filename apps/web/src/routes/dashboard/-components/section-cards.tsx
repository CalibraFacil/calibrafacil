import { HugeiconsIcon } from "@hugeicons/react"
import {
  Clock01Icon,
  CheckmarkCircle01Icon,
  Alert02Icon,
  PercentCircleIcon,
  Calendar03Icon,
} from "@hugeicons/core-free-icons"

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

interface SectionCardsProps {
  pendingCalibrations: number
  approvedThisMonth: number
  expiringStandards: number
  approvalRate: number
  overdueJobs: number
  isLoading?: boolean
}

export function SectionCards({
  pendingCalibrations,
  approvedThisMonth,
  expiringStandards,
  approvalRate,
  overdueJobs,
  isLoading,
}: SectionCardsProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 grid-cols-1 @xl:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-5">
        {[...Array(5)].map((_, i) => (
          <Card key={i} size="sm">
            <CardHeader>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-9 w-16 mt-2" />
            </CardHeader>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="grid gap-4 grid-cols-1 @xl:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-5">
      {/* Pending Calibrations */}
      <Card size="sm">
        <CardHeader>
          <CardDescription>
            <span className="flex items-center gap-2">
              <HugeiconsIcon icon={Clock01Icon} className="size-4" />
              Calibrações Pendentes
            </span>
          </CardDescription>
          <CardTitle className="text-3xl tabular-nums">
            {pendingCalibrations}
          </CardTitle>
          <CardAction>
            <Badge variant="secondary">Em aberto</Badge>
          </CardAction>
        </CardHeader>
      </Card>

      {/* Approved This Month */}
      <Card size="sm">
        <CardHeader>
          <CardDescription>
            <span className="flex items-center gap-2">
              <HugeiconsIcon icon={CheckmarkCircle01Icon} className="size-4" />
              Aprovadas Este Mês
            </span>
          </CardDescription>
          <CardTitle className="text-3xl tabular-nums text-green-600 dark:text-green-500">
            {approvedThisMonth}
          </CardTitle>
          <CardAction>
            <Badge variant="default">Concluídas</Badge>
          </CardAction>
        </CardHeader>
      </Card>

      {/* Expiring Standards */}
      <Card size="sm">
        <CardHeader>
          <CardDescription>
            <span className="flex items-center gap-2">
              <HugeiconsIcon icon={Calendar03Icon} className="size-4" />
              Padrões Expirando
            </span>
          </CardDescription>
          <CardTitle
            className={cn(
              "text-3xl tabular-nums",
              expiringStandards > 0 && "text-amber-600 dark:text-amber-500"
            )}
          >
            {expiringStandards}
          </CardTitle>
          <CardAction>
            <Badge variant={expiringStandards > 0 ? "destructive" : "outline"}>
              Próx. 30 dias
            </Badge>
          </CardAction>
        </CardHeader>
      </Card>

      {/* Approval Rate */}
      <Card size="sm">
        <CardHeader>
          <CardDescription>
            <span className="flex items-center gap-2">
              <HugeiconsIcon icon={PercentCircleIcon} className="size-4" />
              Taxa de Aprovação
            </span>
          </CardDescription>
          <CardTitle className="text-3xl tabular-nums">
            {approvalRate.toFixed(1)}%
          </CardTitle>
          <CardAction>
            <Badge variant="outline">Este mês</Badge>
          </CardAction>
        </CardHeader>
      </Card>

      {/* Overdue Jobs */}
      <Card size="sm">
        <CardHeader>
          <CardDescription>
            <span className="flex items-center gap-2">
              <HugeiconsIcon icon={Alert02Icon} className="size-4" />
              Em Atraso
            </span>
          </CardDescription>
          <CardTitle
            className={cn(
              "text-3xl tabular-nums",
              overdueJobs > 0 && "text-destructive"
            )}
          >
            {overdueJobs}
          </CardTitle>
          <CardAction>
            <Badge variant={overdueJobs > 0 ? "destructive" : "outline"}>
              {overdueJobs > 0 ? "Atenção" : "OK"}
            </Badge>
          </CardAction>
        </CardHeader>
      </Card>
    </div>
  )
}
