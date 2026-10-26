import { Badge } from '@calibra-facil/ui/badge'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@calibra-facil/ui/accordion'
import { Label } from '@calibra-facil/ui/label'
import {
  accreditationSealWithheldMessage,
  convertMassValue,
  formatCalibrationValue,
  normalizeAccreditationNumber,
} from '@calibra-facil/shared'
import { AccreditationSeal } from '@/components/accreditation-seal'
import {
  buildApprovedJobRecordModel,
  type ApprovedJobRecordData,
} from '@/features/jobs/detail-model'
import { formatStandardDate } from '@/features/standards/dates'
import {
  BlueprintField,
  BlueprintGrid,
  InfoHint,
  Panel,
  PanelHeader,
} from '@calibra-facil/ui/instrument-panel'
import {
  renderApprovedFieldValue,
  renderApprovedResult,
} from './approved-record-renderers'

type ApprovedRecordModel = ReturnType<typeof buildApprovedJobRecordModel>

export function ApprovedRecordMain({
  job,
  model,
  certificateAccredited,
  sealWithheldReason,
  accreditationNumber,
}: {
  job: ApprovedJobRecordData
  model: ApprovedRecordModel
  certificateAccredited: boolean
  /** Why the certificate was issued without the seal (frozen at approval), when it was. */
  sealWithheldReason: string | null
  accreditationNumber: ReturnType<typeof normalizeAccreditationNumber>
}) {
  const sealWithheldMessage =
    accreditationSealWithheldMessage(sealWithheldReason)
  const { methodSnapshot, standardsSnapshot } = job
  const {
    equipmentSpecItems,
    supportContextItems,
    assetBaseMeasurementUnit,
    displayUnitFor,
    measurementFields,
  } = model

  return (
    <main className="min-w-0 space-y-6">
      <Panel className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <PanelHeader
            title="Cliente, ativo e método"
            description="Dados congelados no momento da aprovação, que formam a base imutável deste certificado."
          />
          {certificateAccredited ? (
            <AccreditationSeal
              accreditationNumber={accreditationNumber}
              width={76}
            />
          ) : null}
        </div>
        {!certificateAccredited && sealWithheldMessage ? (
          <p
            className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
            data-testid="seal-withheld-reason"
          >
            Certificado emitido sem o símbolo de acreditação:{' '}
            {sealWithheldMessage}
          </p>
        ) : null}
        <BlueprintGrid className="mt-4 sm:grid-cols-2 lg:grid-cols-4">
          <BlueprintField label="Cliente">
            <span className="font-medium">{job.customerName || '-'}</span>
          </BlueprintField>
          <BlueprintField label="Ativo">
            {job.assetName || '-'}
            {job.assetTag && (
              <span className="ml-1 font-mono text-muted-foreground">
                ({job.assetTag})
              </span>
            )}
          </BlueprintField>
          <BlueprintField label="Serviço">
            {job.serviceName || '-'}
          </BlueprintField>
          <BlueprintField label="Método" mono>
            {methodSnapshot.methodName} v{methodSnapshot.methodVersion}
          </BlueprintField>
        </BlueprintGrid>

        {equipmentSpecItems.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Especificações do equipamento
            </p>
            <BlueprintGrid className="sm:grid-cols-2">
              {equipmentSpecItems.map((item) => (
                <BlueprintField
                  key={item.key}
                  label={item.label}
                  mono
                  className={item.value.length > 36 ? 'sm:col-span-2' : ''}
                >
                  {item.value}
                </BlueprintField>
              ))}
            </BlueprintGrid>
          </div>
        )}

        {supportContextItems.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Dados complementares
            </p>
            <div className="grid gap-2">
              {supportContextItems.map((item) => (
                <div
                  key={item.key}
                  className="min-w-0 rounded-xl bg-muted/30 px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                >
                  <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    {item.label}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-snug">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>

      <Panel className="p-4 sm:p-5">
        <PanelHeader
          title="Dados de medição"
          description="Valores capturados durante a calibração."
        />
        <div className="mt-4 space-y-5">
          {measurementFields.map((field) => (
            <div key={field.key}>
              <Label className="mb-2 block text-sm font-medium text-muted-foreground">
                {field.label}
                {displayUnitFor(field.unit) && (
                  <span className="text-xs ml-1">
                    ({displayUnitFor(field.unit)})
                  </span>
                )}
              </Label>
              <div className="min-w-0 rounded-xl bg-muted/20 p-2">
                {renderApprovedFieldValue(field, model)}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="p-4 sm:p-5">
        <Accordion>
          <AccordionItem value="approved-calculated-results">
            <AccordionTrigger className="min-h-10 py-0 hover:no-underline">
              <div className="min-w-0">
                <h2 className="text-balance text-base font-semibold">
                  Resultados Calculados
                </h2>
                <p className="text-pretty text-sm font-normal text-muted-foreground">
                  Valores armazenados no momento da aprovação.
                </p>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4">
              <div className="space-y-3">
                {methodSnapshot.formulas.map((formula) => (
                  <div key={formula.outputKey}>
                    {renderApprovedResult(formula, model)}
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Panel>

      {standardsSnapshot && standardsSnapshot.length > 0 && (
        <Panel className="p-4 sm:p-5">
          <PanelHeader
            title={
              <span className="inline-flex items-center gap-1.5">
                Padrões de referência utilizados
                <InfoHint label="Sobre rastreabilidade metrológica">
                  Cada medição se liga a referências reconhecidas por uma cadeia
                  contínua e documentada de calibrações, e cada elo contribui
                  para a incerteza do resultado.
                </InfoHint>
              </span>
            }
            description="Cada padrão tem certificado e incerteza próprios, que alimentam o orçamento de incerteza da calibração."
            action={
              <Badge variant="outline">
                <span className="tabular-nums">{standardsSnapshot.length}</span>
                {standardsSnapshot.length === 1 ? ' padrão' : ' padrões'}
              </Badge>
            }
          />
          <div className="mt-4 grid gap-2">
            {standardsSnapshot.map((std) => (
              <div
                key={std.id}
                className="rounded-xl bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] transition-[background-color,box-shadow] hover:bg-muted/20"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <span className="font-medium break-words">{std.name}</span>
                    {std.type && (
                      <p className="text-xs text-muted-foreground">
                        {std.type}
                      </p>
                    )}
                    <p className="inline-flex flex-wrap items-center gap-1 break-all text-sm text-muted-foreground">
                      Certificado: {std.certificateNumber}
                      <InfoHint label="Sobre o certificado do padrão">
                        Número do certificado de calibração do padrão, que
                        comprova documentalmente a rastreabilidade.
                      </InfoHint>
                    </p>
                  </div>
                  <div className="shrink-0 text-left text-sm sm:text-right">
                    <p>
                      Calibrado em: {formatStandardDate(std.calibrationDate)}
                    </p>
                    {std.uncertainty != null && (
                      <p className="inline-flex flex-wrap items-center gap-1 font-mono tabular-nums text-muted-foreground sm:justify-end">
                        U ={' '}
                        {formatCalibrationValue(
                          assetBaseMeasurementUnit && std.uncertaintyUnit
                            ? (convertMassValue(
                                std.uncertainty,
                                std.uncertaintyUnit,
                                assetBaseMeasurementUnit,
                              ) ?? std.uncertainty)
                            : std.uncertainty,
                        )}{' '}
                        {displayUnitFor(std.uncertaintyUnit) || ''} (k=
                        {std.coverageFactor})
                        <InfoHint
                          label="Sobre incerteza e fator de abrangência"
                          side="left"
                        >
                          <span className="font-medium">U</span>: incerteza
                          expandida do padrão.{' '}
                          <span className="font-medium">k</span>: fator de
                          abrangência; k = 2 corresponde a cerca de 95% de
                          confiança. Soma-se ao orçamento de incerteza desta
                          calibração.
                        </InfoHint>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </main>
  )
}
