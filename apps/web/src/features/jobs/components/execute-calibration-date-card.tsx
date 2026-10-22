import { Input } from '@calibra-facil/ui/input'
import { DateInput } from '@/components/ui/date-input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@calibra-facil/ui/card'
import { Field, FieldDescription, FieldLabel } from '@calibra-facil/ui/field'
import { Textarea } from '@calibra-facil/ui/textarea'
import { parseExecutionPerformedAt } from '@/features/jobs/forms'
import {
  formatDateForInput,
  PERFORMED_AT_PRESETS,
} from '../execute-page-helpers'

export function ExecuteCalibrationDateCard({
  performedAt,
  requiresBackdateReason,
  backdateDays,
  backdateReason,
  methodDeviations,
  isEditable,
  onPerformedAtChange,
  onBackdateReasonChange,
  onMethodDeviationsChange,
}: {
  performedAt: string
  requiresBackdateReason: boolean
  backdateDays: ReturnType<typeof parseExecutionPerformedAt>['backdateDays']
  backdateReason: string
  methodDeviations: string
  isEditable: boolean
  onPerformedAtChange: (performedAt: string) => void
  onBackdateReasonChange: (reason: string) => void
  onMethodDeviationsChange: (deviations: string) => void
}) {
  const performedDate = performedAt ? new Date(`${performedAt}T00:00:00`) : null

  return (
    <Card className="rounded-2xl border-0 py-0 bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10">
      <CardHeader className="px-5 py-4">
        <CardTitle className="text-base">Data da calibração</CardTitle>
        <CardDescription>
          Informe a data real de execução da calibração.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-5 pb-5">
        <Field>
          <FieldLabel>Data realizada</FieldLabel>
          <DateInput
            value={
              performedDate && !Number.isNaN(performedDate.getTime())
                ? performedDate
                : undefined
            }
            disabled={!isEditable}
            onChange={(date) =>
              onPerformedAtChange(date ? formatDateForInput(date) : '')
            }
            max={formatDateForInput(new Date())}
            presets={PERFORMED_AT_PRESETS}
            calendarProps={{ disabled: { after: new Date() } }}
          />
        </Field>
        {requiresBackdateReason && (
          <Field>
            <FieldLabel>
              Motivo do registro retroativo ({backdateDays} dias)
            </FieldLabel>
            <Input
              type="text"
              value={backdateReason}
              disabled={!isEditable}
              onChange={(e) => onBackdateReasonChange(e.target.value)}
              placeholder="Descreva o motivo do lançamento retroativo"
            />
          </Field>
        )}
        {/*
                ISO/IEC 17025 §7.8.2.1(n). Deliberately NOT a generic
                "observações" box: it answers one question, and whatever is
                typed here is printed on the certificate under that heading.
                Left blank on a calibration run exactly per method, which is
                the normal case.
              */}
        <Field className="md:col-span-2">
          <FieldLabel>Desvios em relação ao método</FieldLabel>
          <Textarea
            value={methodDeviations}
            disabled={!isEditable}
            rows={2}
            maxLength={2000}
            onChange={(e) => onMethodDeviationsChange(e.target.value)}
            placeholder="Adições, desvios ou exclusões em relação ao método, se houver"
          />
          <FieldDescription>
            Impresso no certificado (ISO/IEC 17025 §7.8.2.1n). Deixe em branco
            se a calibração seguiu o método sem alterações.
          </FieldDescription>
        </Field>
      </CardContent>
    </Card>
  )
}
