import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@calibra-facil/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@calibra-facil/ui/collapsible'
import { EccentricityIndicator } from '@/components/eccentricity-indicator'
import {
  getEccentricityIndicatorVariant,
  resolveSelectedIndicatorPosition,
  type JobData,
} from '@/features/jobs/execution'
import type { ReactNode } from 'react'

export function ExecuteMeasurementCard({
  open,
  onOpenChange,
  job,
  manualFieldCount,
  eccentricityFieldCount,
  selectedIndicatorPosition,
  eccentricityIndicatorVariant,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  job: JobData
  manualFieldCount: number
  eccentricityFieldCount: number
  selectedIndicatorPosition: ReturnType<typeof resolveSelectedIndicatorPosition>
  eccentricityIndicatorVariant: ReturnType<
    typeof getEccentricityIndicatorVariant
  >
  children: ReactNode
}) {
  return (
    <Card className="rounded-2xl border-0 py-0 bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className="group w-full text-left outline-none">
          <CardHeader className="min-h-16 cursor-pointer rounded-t-2xl px-5 py-4 transition-[background-color] group-hover:bg-muted/40">
            <div className="flex items-center justify-between">
              <CardTitle className="text-balance text-base">
                Dados de Medição ({manualFieldCount})
              </CardTitle>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
              />
            </div>
            <CardDescription className="text-pretty">
              {job.methodSnapshot.methodName} v
              {job.methodSnapshot.methodVersion}
            </CardDescription>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-5 px-5 pb-5 pt-0">
            {eccentricityIndicatorVariant !== null &&
              eccentricityFieldCount === 0 && (
                <EccentricityIndicator
                  value={selectedIndicatorPosition}
                  variant={eccentricityIndicatorVariant}
                  readOnly
                />
              )}
            {children}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
