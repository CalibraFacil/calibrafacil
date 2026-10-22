import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { Badge } from '@calibra-facil/ui/badge'
import { Input } from '@calibra-facil/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@calibra-facil/ui/card'
import { Field, FieldLabel } from '@calibra-facil/ui/field'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@calibra-facil/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@calibra-facil/ui/select'
import {
  formatAddress,
  formatLabAddress,
  type CalibrationLocationSnapshot,
  type JobData,
} from '@/features/jobs/execution'
import type { Dispatch, SetStateAction } from 'react'
import { toCalibrationLocationType } from '../execute-page-helpers'

export function ExecuteLocationCard({
  open,
  onOpenChange,
  job,
  calibrationLocation,
  setCalibrationLocation,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  job: JobData
  calibrationLocation: CalibrationLocationSnapshot
  setCalibrationLocation: Dispatch<SetStateAction<CalibrationLocationSnapshot>>
}) {
  return (
    <Card className="rounded-2xl border-0 py-0 bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className="group w-full text-left outline-none">
          <CardHeader className="min-h-16 cursor-pointer rounded-t-2xl px-5 py-4 transition-[background-color] group-hover:bg-muted/40">
            <div className="flex items-center justify-between">
              <CardTitle className="text-balance text-base">
                Local da Calibração
                {calibrationLocation.addressText.trim() && (
                  <Badge variant="secondary" className="ml-2">
                    Registrado
                  </Badge>
                )}
              </CardTitle>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
              />
            </div>
            <CardDescription className="max-w-3xl text-pretty">
              Informe se a calibração foi realizada no cliente, no laboratório
              ou em outro local. O valor será congelado no certificado.
            </CardDescription>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="grid gap-4 px-5 pb-5 pt-0 md:grid-cols-[240px_minmax(0,1fr)]">
            <Field>
              <FieldLabel>Tipo</FieldLabel>
              <Select
                value={calibrationLocation.type}
                onValueChange={(value) => {
                  const type = toCalibrationLocationType(value)
                  const customerAddress = formatAddress(job.customerAddress)
                  const labAddress = formatLabAddress(job)
                  setCalibrationLocation((current) => ({
                    ...current,
                    type,
                    addressText:
                      type === 'customer_site'
                        ? customerAddress
                        : type === 'lab'
                          ? labAddress
                          : '',
                  }))
                }}
              >
                <SelectTrigger className="w-full">
                  <span>
                    {calibrationLocation.type === 'customer_site'
                      ? 'No cliente'
                      : calibrationLocation.type === 'lab'
                        ? 'No laboratório'
                        : 'Outro'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="customer_site">No cliente</SelectItem>
                  <SelectItem value="lab">No laboratório</SelectItem>
                  <SelectItem value="other">Outro</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Endereço/local</FieldLabel>
              <Input
                value={calibrationLocation.addressText}
                onChange={(event) =>
                  setCalibrationLocation((current) => ({
                    ...current,
                    addressText: event.target.value,
                  }))
                }
                placeholder="Endereço ou descrição do local"
              />
            </Field>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
