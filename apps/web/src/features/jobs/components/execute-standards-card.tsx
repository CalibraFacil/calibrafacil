import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  CheckmarkCircle02Icon,
} from '@hugeicons/core-free-icons'
import { Badge } from '@calibra-facil/ui/badge'
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
import { formatCalibrationValue } from '@calibra-facil/shared'
import { type ReferenceStandard } from '@/features/jobs/execution'
import type { useAssetUnitConversion } from '../use-asset-unit-conversion'

export function ExecuteStandardsCard({
  open,
  onOpenChange,
  hasMassCompositionColumns,
  selectedStandardIds,
  selectedStandardsMissingCertificatePdf,
  standardsData,
  onToggleStandard,
  convertValueToDisplayUnit,
  displayUnitFor,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  hasMassCompositionColumns: boolean
  selectedStandardIds: number[]
  selectedStandardsMissingCertificatePdf: ReferenceStandard[]
  standardsData: ReferenceStandard[]
  onToggleStandard: (standardId: number) => void
  convertValueToDisplayUnit: ReturnType<
    typeof useAssetUnitConversion
  >['convertValueToDisplayUnit']
  displayUnitFor: ReturnType<typeof useAssetUnitConversion>['displayUnitFor']
}) {
  return (
    <Card className="rounded-2xl border-0 py-0 bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className="group w-full text-left outline-none">
          <CardHeader className="min-h-16 cursor-pointer rounded-t-2xl px-5 py-4 transition-[background-color] group-hover:bg-muted/40">
            <div className="flex items-center justify-between">
              <CardTitle className="text-balance text-base">
                Padrões de Referência
                {selectedStandardIds.length > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {selectedStandardIds.length} selecionado(s)
                  </Badge>
                )}
              </CardTitle>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
              />
            </div>
            <CardDescription className="max-w-3xl text-pretty">
              {hasMassCompositionColumns
                ? 'Selecione padrões usados fora da composição de pesos, como estação meteorológica, termohigrômetro ou barômetro. Pesos escolhidos em Composição dos pesos entram automaticamente no certificado.'
                : 'Selecione os padrões usados nesta calibração'}
            </CardDescription>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="px-5 pb-5 pt-0">
            {selectedStandardsMissingCertificatePdf.length > 0 && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                {selectedStandardsMissingCertificatePdf.length === 1
                  ? `O padrão ${selectedStandardsMissingCertificatePdf[0]?.name} ainda não possui PDF do certificado original.`
                  : `${selectedStandardsMissingCertificatePdf.length} padrões selecionados ainda não possuem PDF do certificado original.`}
              </div>
            )}
            <div className="grid gap-2 lg:grid-cols-2">
              {standardsData.map((std) => (
                <button
                  type="button"
                  key={std.id}
                  disabled={std.isExpired}
                  className={`min-h-16 rounded-xl px-4 py-3 text-left shadow-[inset_0_0_0_1px_rgba(0,0,0,0.07)] transition-[background-color,box-shadow,transform,opacity] active:scale-[0.96] ${
                    selectedStandardIds.includes(std.id)
                      ? 'bg-primary/5 ring-1 ring-primary shadow-[0_12px_30px_rgba(37,99,235,0.10)]'
                      : 'bg-background hover:bg-muted/40 hover:shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08),0_10px_28px_rgba(15,23,42,0.05)]'
                  } ${std.isExpired ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                  onClick={() => !std.isExpired && onToggleStandard(std.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <span className="block truncate font-medium">
                        {std.name}
                      </span>
                      <p className="mt-1 truncate text-xs text-muted-foreground tabular-nums">
                        Cert: {std.certificateNumber}
                        {!std.certificateDocument && ' | PDF pendente'}
                        {std.uncertainty != null &&
                          ` | U: ${formatCalibrationValue(
                            convertValueToDisplayUnit(
                              std.uncertainty,
                              std.uncertaintyUnit,
                            ),
                          )} ${displayUnitFor(std.uncertaintyUnit) || ''}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {std.isExpired ? (
                        <Badge variant="destructive">Vencido</Badge>
                      ) : std.daysUntilExpiry <= 30 ? (
                        <Badge variant="outline" className="text-amber-600">
                          Vence em {std.daysUntilExpiry}d
                        </Badge>
                      ) : null}
                      {selectedStandardIds.includes(std.id) && (
                        <HugeiconsIcon
                          icon={CheckmarkCircle02Icon}
                          className="h-5 w-5 text-primary"
                        />
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
