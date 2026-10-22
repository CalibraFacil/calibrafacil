import { HugeiconsIcon } from '@hugeicons/react'
import { SentIcon } from '@hugeicons/core-free-icons'
import { Button } from '@calibra-facil/ui/button'
import { Badge } from '@calibra-facil/ui/badge'
import { SaveButton } from '@/components/ui/save-button'
import { BlueprintOverlay, Panel } from '@calibra-facil/ui/instrument-panel'
import type { MethodInputField } from '@/components/method-runtime/types'
import { JOB_STATUS_LABELS, type JobData } from '@/features/jobs/execution'
import type { buildAssetSpecSummaryItems } from '../execute-page-helpers'

export function ExecuteHeader({
  job,
  selectedStandardIds,
  environmentStatus,
  totalIssueCount,
  requiredFields,
  completedRequiredFields,
  requiredCompletionPercent,
  requiredComplete,
  assetSpecSummaryItems,
  missingAssetSpecFields,
  isEditable,
  canSubmit,
  isSubmitting,
  onSave,
  onSubmit,
}: {
  job: JobData
  selectedStandardIds: number[]
  environmentStatus: string
  totalIssueCount: number
  requiredFields: MethodInputField[]
  completedRequiredFields: MethodInputField[]
  requiredCompletionPercent: number
  requiredComplete: boolean
  assetSpecSummaryItems: ReturnType<typeof buildAssetSpecSummaryItems>
  missingAssetSpecFields: MethodInputField[]
  isEditable: boolean
  canSubmit: boolean
  isSubmitting: boolean
  onSave: () => Promise<unknown>
  onSubmit: () => void
}) {
  return (
    <Panel className="relative overflow-hidden p-5 sm:p-6">
      <BlueprintOverlay />
      <div className="relative flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 space-y-4">
          <div>
            <div className="mt-0.5 flex flex-wrap items-center gap-3">
              <h1 className="text-balance font-mono text-2xl font-semibold tracking-tight text-foreground">
                {job.jobId}
              </h1>
              <Badge>{JOB_STATUS_LABELS[job.status]}</Badge>
            </div>
          </div>
          <p className="max-w-3xl text-pretty text-sm text-muted-foreground">
            {job.customerName} · {job.assetName} ({job.assetTag})
          </p>

          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="h-7 rounded-lg px-2.5">
              <span className="text-muted-foreground">Padrões</span>
              <span className="tabular-nums">
                {selectedStandardIds.length} selecionado(s)
              </span>
            </Badge>
            <Badge variant="secondary" className="h-7 rounded-lg px-2.5">
              <span className="text-muted-foreground">Ambiente</span>
              {environmentStatus}
            </Badge>
            <Badge
              variant={totalIssueCount > 0 ? 'destructive' : 'secondary'}
              className={`h-7 rounded-lg px-2.5 ${
                totalIssueCount === 0
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                  : ''
              }`}
            >
              <span className="opacity-70">Alertas</span>
              <span className="tabular-nums">{totalIssueCount}</span>
            </Badge>
          </div>

          {requiredFields.length > 0 && (
            <div className="max-w-md space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium">
                  Campos obrigatórios preenchidos
                </span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {completedRequiredFields.length}/{requiredFields.length} ·{' '}
                  {requiredCompletionPercent}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                    requiredComplete ? 'bg-emerald-500' : 'bg-primary'
                  }`}
                  style={{ width: `${requiredCompletionPercent}%` }}
                />
              </div>
            </div>
          )}

          {assetSpecSummaryItems.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Características do instrumento
              </p>
              <div className="flex flex-wrap gap-2">
                {assetSpecSummaryItems.map((item) => (
                  <span
                    key={item.key}
                    className="inline-flex min-h-8 items-center gap-2 rounded-lg bg-muted/50 px-2.5 text-sm shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)]"
                  >
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="font-mono tabular-nums">
                      {item.value}
                      {item.unit && (
                        <span className="ml-1 font-sans text-xs text-muted-foreground">
                          {item.unit}
                        </span>
                      )}
                    </span>
                  </span>
                ))}
              </div>
              {missingAssetSpecFields.length > 0 && (
                <div className="space-y-1">
                  {missingAssetSpecFields.map((field) => (
                    <p key={field.key} className="text-sm text-red-600">
                      O ativo não possui a especificação obrigatória "
                      {field.label}".
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {isEditable && (
          <div className="flex flex-col gap-2 sm:flex-row xl:pt-10">
            <SaveButton
              idleText="Salvar Rascunho"
              savedText="Salvo"
              disabled={missingAssetSpecFields.length > 0}
              onSave={() => onSave()}
            />
            <Button
              onClick={() => onSubmit()}
              disabled={isSubmitting || !canSubmit}
              className="h-10 justify-center px-3 shadow-[0_12px_28px_rgba(37,99,235,0.22)] active:scale-[0.96]"
            >
              <HugeiconsIcon icon={SentIcon} className="mr-2 h-4 w-4" />
              {isSubmitting ? 'Enviando...' : 'Enviar para Revisão'}
            </Button>
          </div>
        )}
      </div>
    </Panel>
  )
}
