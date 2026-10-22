import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  Alert02Icon,
  DropletIcon,
} from '@hugeicons/core-free-icons'
import { GaugeIcon, ThermometerIcon } from '@phosphor-icons/react'
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
  buildEnvironmentWarnings,
  type EffectiveLimits,
} from '@/features/jobs/execution'
import { type ExecutionFormValues } from '@/features/jobs/execution-draft'
import type { Dispatch, SetStateAction } from 'react'

export function ExecuteEnvironmentCard({
  open,
  onOpenChange,
  envWarnings,
  envLimits,
  environment,
  setEnvironment,
  isEditable,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  envWarnings: ReturnType<typeof buildEnvironmentWarnings>
  envLimits: EffectiveLimits | null
  environment: ExecutionFormValues['environment']
  setEnvironment: Dispatch<SetStateAction<ExecutionFormValues['environment']>>
  isEditable: boolean
}) {
  return (
    <Card className="rounded-2xl border-0 py-0 bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className="group w-full text-left outline-none">
          <CardHeader className="min-h-16 cursor-pointer rounded-t-2xl px-5 py-4 transition-[background-color] group-hover:bg-muted/40">
            <div className="flex items-center justify-between">
              <CardTitle className="text-balance text-base">
                Condições Ambientais
                {envWarnings.length > 0 && (
                  <Badge variant="destructive" className="ml-2">
                    Fora dos limites
                  </Badge>
                )}
              </CardTitle>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
              />
            </div>
            <CardDescription className="text-pretty">
              Registre temperatura, umidade e pressão do ambiente
            </CardDescription>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4 px-5 pb-5 pt-0">
            {envWarnings.length > 0 && (
              <div className="rounded-xl bg-amber-50 p-3 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.25)] dark:bg-amber-950">
                {envWarnings.map((w, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200"
                  >
                    <HugeiconsIcon
                      icon={Alert02Icon}
                      className="h-4 w-4 shrink-0"
                    />
                    {w}
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel className="flex items-center gap-1.5">
                  <ThermometerIcon size={14} className="text-orange-500" />
                  Temperatura
                </FieldLabel>
                <div className="flex">
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder={
                      envLimits?.temperatureMin != null
                        ? `${envLimits.temperatureMin}–${envLimits.temperatureMax}`
                        : 'Ex: 23.0'
                    }
                    value={
                      environment.temperature != null
                        ? String(environment.temperature)
                        : ''
                    }
                    onChange={(e) => {
                      const val = e.target.value.replace(',', '.')
                      if (val === '' || /^-?\d*\.?\d*$/.test(val)) {
                        setEnvironment((prev) => ({
                          ...prev,
                          temperature: val === '' ? null : Number(val) || null,
                        }))
                      }
                    }}
                    onBlur={(e) => {
                      const val = e.target.value.replace(',', '.')
                      if (val !== '' && val !== '-' && val !== '.') {
                        const parsed = parseFloat(val)
                        if (!isNaN(parsed)) {
                          setEnvironment((prev) => ({
                            ...prev,
                            temperature: parsed,
                          }))
                        }
                      }
                    }}
                    disabled={!isEditable}
                    className="rounded-r-none"
                  />
                  <span className="inline-flex items-center px-3 text-sm text-muted-foreground bg-muted border border-l-0 border-input rounded-r-md">
                    °C
                  </span>
                </div>
              </Field>
              <Field>
                <FieldLabel className="flex items-center gap-1.5">
                  <HugeiconsIcon
                    icon={DropletIcon}
                    className="h-3.5 w-3.5 text-blue-500"
                  />
                  Umidade
                </FieldLabel>
                <div className="flex">
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder={
                      envLimits?.humidityMin != null
                        ? `${envLimits.humidityMin}–${envLimits.humidityMax}`
                        : 'Ex: 50.0'
                    }
                    value={
                      environment.humidity != null
                        ? String(environment.humidity)
                        : ''
                    }
                    onChange={(e) => {
                      const val = e.target.value.replace(',', '.')
                      if (val === '' || /^-?\d*\.?\d*$/.test(val)) {
                        setEnvironment((prev) => ({
                          ...prev,
                          humidity: val === '' ? null : Number(val) || null,
                        }))
                      }
                    }}
                    onBlur={(e) => {
                      const val = e.target.value.replace(',', '.')
                      if (val !== '' && val !== '-' && val !== '.') {
                        const parsed = parseFloat(val)
                        if (!isNaN(parsed)) {
                          setEnvironment((prev) => ({
                            ...prev,
                            humidity: parsed,
                          }))
                        }
                      }
                    }}
                    disabled={!isEditable}
                    className="rounded-r-none"
                  />
                  <span className="inline-flex items-center px-3 text-sm text-muted-foreground bg-muted border border-l-0 border-input rounded-r-md">
                    %RH
                  </span>
                </div>
              </Field>
              <Field>
                <FieldLabel className="flex items-center gap-1.5">
                  <GaugeIcon size={14} className="text-purple-500" />
                  Pressão
                </FieldLabel>
                <div className="flex">
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder={
                      envLimits?.pressureMin != null
                        ? `${envLimits.pressureMin}–${envLimits.pressureMax}`
                        : 'Ex: 1013.0'
                    }
                    value={
                      environment.pressure != null
                        ? String(environment.pressure)
                        : ''
                    }
                    onChange={(e) => {
                      const val = e.target.value.replace(',', '.')
                      if (val === '' || /^-?\d*\.?\d*$/.test(val)) {
                        setEnvironment((prev) => ({
                          ...prev,
                          pressure: val === '' ? null : Number(val) || null,
                        }))
                      }
                    }}
                    onBlur={(e) => {
                      const val = e.target.value.replace(',', '.')
                      if (val !== '' && val !== '-' && val !== '.') {
                        const parsed = parseFloat(val)
                        if (!isNaN(parsed)) {
                          setEnvironment((prev) => ({
                            ...prev,
                            pressure: parsed,
                          }))
                        }
                      }
                    }}
                    disabled={!isEditable}
                    className="rounded-r-none"
                  />
                  <span className="inline-flex items-center px-3 text-sm text-muted-foreground bg-muted border border-l-0 border-input rounded-r-md">
                    hPa
                  </span>
                </div>
              </Field>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
