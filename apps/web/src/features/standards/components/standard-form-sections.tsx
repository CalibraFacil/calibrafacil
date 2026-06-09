import { HugeiconsIcon } from '@hugeicons/react'
import { Delete02Icon, PlusSignIcon } from '@hugeicons/core-free-icons'
import type { ReferenceStandardKind } from '@calibra-facil/schemas'

import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  createChannelsForKind,
  createStandardCertifiedValueDraft,
  createStandardChannelDraft,
  createStandardPointDraft,
  STANDARD_STATUS_LABELS,
  type StandardCertifiedValueFormData,
  type StandardFormData,
  type StandardFormField,
  type StandardMetrologyChannelFormData,
  type StandardMetrologyPointFormData,
} from '@/features/standards/forms'
import {
  METROLOGY_KIND_DEFINITIONS,
  metrologyKindDefinition,
} from '@/features/standards/metrology-kinds'

type StandardFormSectionsProps = {
  formData: StandardFormData
  errors: Partial<Record<StandardFormField, string>>
  disabled?: boolean
  onChange: (data: StandardFormData) => void
}

function parseReferenceStandardKind(value: string): ReferenceStandardKind {
  return (
    METROLOGY_KIND_DEFINITIONS.find((definition) => definition.kind === value)
      ?.kind ?? 'generic_scalar'
  )
}

function parseStandardStatus(value: string): StandardFormData['status'] {
  switch (value) {
    case 'ACTIVE':
    case 'INACTIVE':
    case 'OUT_OF_TOLERANCE':
    case 'SENT_FOR_CALIBRATION':
      return value
    default:
      return 'ACTIVE'
  }
}

function parseDegreesOfFreedomOperator(
  value: string,
): StandardMetrologyPointFormData['degreesOfFreedomOperator'] {
  switch (value) {
    case 'greater_than':
    case 'infinity':
      return value
    default:
      return 'exact'
  }
}

export function StandardFormSections({
  formData,
  errors,
  disabled = false,
  onChange,
}: StandardFormSectionsProps) {
  const definition = metrologyKindDefinition(formData.kind)

  const updateField = <TKey extends keyof StandardFormData>(
    field: TKey,
    value: StandardFormData[TKey],
  ) => {
    onChange({ ...formData, [field]: value })
  }

  const updateKind = (kind: ReferenceStandardKind) => {
    const nextDefinition = metrologyKindDefinition(kind)
    onChange({
      ...formData,
      kind,
      type: nextDefinition.typeLabel,
      channels:
        nextDefinition.mode === 'channels'
          ? createChannelsForKind(kind)
          : formData.channels,
      certifiedValues:
        nextDefinition.mode === 'mass' && formData.certifiedValues.length === 0
          ? [createStandardCertifiedValueDraft()]
          : formData.certifiedValues,
    })
  }

  const updateMassValue = (
    index: number,
    field: keyof StandardCertifiedValueFormData,
    value: string,
  ) => {
    updateField(
      'certifiedValues',
      formData.certifiedValues.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    )
  }

  const updateChannel = (
    index: number,
    field: keyof StandardMetrologyChannelFormData,
    value: string,
  ) => {
    updateField(
      'channels',
      formData.channels.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    )
  }

  const updateChannelPoint = <
    TField extends keyof StandardMetrologyPointFormData,
  >(
    channelIndex: number,
    pointIndex: number,
    field: TField,
    value: StandardMetrologyPointFormData[TField],
  ) => {
    updateField(
      'channels',
      formData.channels.map((channel, index) =>
        index === channelIndex
          ? {
              ...channel,
              points: channel.points.map((point, nextPointIndex) =>
                nextPointIndex === pointIndex
                  ? { ...point, [field]: value }
                  : point,
              ),
            }
          : channel,
      ),
    )
  }

  const addChannelPoint = (channelIndex: number) => {
    updateField(
      'channels',
      formData.channels.map((channel, index) =>
        index === channelIndex
          ? {
              ...channel,
              points: [
                ...channel.points,
                createStandardPointDraft({ unit: channel.unit }),
              ],
            }
          : channel,
      ),
    )
  }

  const removeChannelPoint = (channelIndex: number, pointIndex: number) => {
    updateField(
      'channels',
      formData.channels.map((channel, index) =>
        index === channelIndex
          ? {
              ...channel,
              points: channel.points.filter(
                (_, nextPointIndex) => nextPointIndex !== pointIndex,
              ),
            }
          : channel,
      ),
    )
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4 border-b pb-6">
        <SectionHeader
          title="Identificação"
          description="Código, categoria técnica e rastreabilidade física."
        />
        <div className="grid gap-4 lg:grid-cols-[1fr_240px_180px]">
          <Field>
            <FieldLabel htmlFor="standard-name">Código / tag *</FieldLabel>
            <Input
              id="standard-name"
              value={formData.name}
              onChange={(event) => updateField('name', event.target.value)}
              disabled={disabled}
              placeholder="JP06 - 10kg"
              autoComplete="off"
            />
            {errors.name && <FieldError>{errors.name}</FieldError>}
          </Field>

          <Field>
            <FieldLabel htmlFor="standard-kind">Grandeza</FieldLabel>
            <NativeSelect
              id="standard-kind"
              className="w-full"
              value={formData.kind}
              onChange={(event) =>
                updateKind(parseReferenceStandardKind(event.target.value))
              }
              disabled={disabled}
            >
              {METROLOGY_KIND_DEFINITIONS.map((kind) => (
                <NativeSelectOption key={kind.kind} value={kind.kind}>
                  {kind.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>{definition.description}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="standard-type">Tipo</FieldLabel>
            <Input
              id="standard-type"
              value={formData.type}
              onChange={(event) => updateField('type', event.target.value)}
              disabled={disabled}
              autoComplete="off"
            />
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <TextField
            id="standard-serial"
            label="Número de série *"
            value={formData.serialNumber}
            onChange={(value) => updateField('serialNumber', value)}
            error={errors.serialNumber}
            disabled={disabled}
          />
          <TextField
            id="standard-manufacturer"
            label="Fabricante"
            value={formData.manufacturer}
            onChange={(value) => updateField('manufacturer', value)}
            disabled={disabled}
          />
          <TextField
            id="standard-model"
            label="Modelo"
            value={formData.model}
            onChange={(value) => updateField('model', value)}
            disabled={disabled}
          />
        </div>
      </section>

      <section className="space-y-4 border-b pb-6">
        <SectionHeader
          title="Certificado"
          description="Dados do certificado que sustentam a rastreabilidade."
        />
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            id="standard-certificate"
            label="Número do certificado *"
            value={formData.certificateNumber}
            onChange={(value) => updateField('certificateNumber', value)}
            error={errors.certificateNumber}
            disabled={disabled}
          />
          <TextField
            id="standard-calibrated-by"
            label="Calibrado por"
            value={formData.calibratedBy}
            onChange={(value) => updateField('calibratedBy', value)}
            disabled={disabled}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <DateField
            id="standard-calibration-date"
            label="Data de calibração *"
            value={formData.calibrationDate}
            onChange={(value) => updateField('calibrationDate', value)}
            error={errors.calibrationDate}
            disabled={disabled}
          />
          <DateField
            id="standard-next-calibration-date"
            label="Próxima calibração *"
            value={formData.nextCalibrationDate}
            onChange={(value) => updateField('nextCalibrationDate', value)}
            error={errors.nextCalibrationDate}
            disabled={disabled}
          />
        </div>
      </section>

      <section className="space-y-5 border-b pb-6">
        <SectionHeader
          title="Dados metrológicos"
          description="Campos mudam conforme a grandeza escolhida."
        />

        {definition.mode === 'scalar' && (
          <div className="grid gap-4 md:grid-cols-3">
            <NumberField
              id="standard-reference-value"
              label="Valor de referência"
              value={formData.referenceValue}
              onChange={(value) => updateField('referenceValue', value)}
              error={errors.referenceValue}
              disabled={disabled}
            />
            <NumberField
              id="standard-uncertainty"
              label="Incerteza"
              value={formData.uncertainty}
              onChange={(value) => updateField('uncertainty', value)}
              error={errors.uncertainty}
              disabled={disabled}
            />
            <TextField
              id="standard-uncertainty-unit"
              label="Unidade"
              value={formData.uncertaintyUnit}
              onChange={(value) => updateField('uncertaintyUnit', value)}
              error={errors.uncertaintyUnit}
              disabled={disabled}
            />
          </div>
        )}

        {definition.mode === 'channels' && (
          <div className="space-y-5">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-32">Canal</TableHead>
                    <TableHead className="min-w-28">Chave</TableHead>
                    <TableHead className="min-w-28">Valor</TableHead>
                    <TableHead className="min-w-28">Correção</TableHead>
                    <TableHead className="min-w-28">Incerteza</TableHead>
                    <TableHead className="w-24">Unid.</TableHead>
                    <TableHead className="w-24">k</TableHead>
                    <TableHead className="w-24">Deriva</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {formData.channels.map((channel, index) => (
                    <TableRow key={`${channel.key}-${index}`}>
                      <EditableCell
                        value={channel.label}
                        onChange={(value) =>
                          updateChannel(index, 'label', value)
                        }
                        disabled={disabled}
                      />
                      <EditableCell
                        value={channel.key}
                        onChange={(value) => updateChannel(index, 'key', value)}
                        disabled={disabled}
                      />
                      <EditableCell
                        type="number"
                        value={channel.value}
                        onChange={(value) =>
                          updateChannel(index, 'value', value)
                        }
                        disabled={disabled}
                      />
                      <EditableCell
                        type="number"
                        value={channel.correction}
                        onChange={(value) =>
                          updateChannel(index, 'correction', value)
                        }
                        disabled={disabled}
                      />
                      <EditableCell
                        type="number"
                        value={channel.uncertainty}
                        onChange={(value) =>
                          updateChannel(index, 'uncertainty', value)
                        }
                        disabled={disabled}
                      />
                      <EditableCell
                        value={channel.unit}
                        onChange={(value) =>
                          updateChannel(index, 'unit', value)
                        }
                        disabled={disabled}
                      />
                      <EditableCell
                        type="number"
                        value={channel.coverageFactor}
                        onChange={(value) =>
                          updateChannel(index, 'coverageFactor', value)
                        }
                        disabled={disabled}
                      />
                      <EditableCell
                        type="number"
                        value={channel.drift}
                        onChange={(value) =>
                          updateChannel(index, 'drift', value)
                        }
                        disabled={disabled}
                      />
                      <TableCell>
                        <RemoveRowButton
                          label="Remover canal"
                          disabled={disabled || formData.channels.length <= 1}
                          onClick={() =>
                            updateField(
                              'channels',
                              formData.channels.filter(
                                (_, itemIndex) => itemIndex !== index,
                              ),
                            )
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() =>
                updateField('channels', [
                  ...formData.channels,
                  createStandardChannelDraft({
                    key: `channel_${formData.channels.length + 1}`,
                    label: `Canal ${formData.channels.length + 1}`,
                    quantity: 'generic',
                  }),
                ])
              }
            >
              <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
              Adicionar canal
            </Button>
            {errors.channels && <FieldError>{errors.channels}</FieldError>}
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium">Pontos calibrados</h3>
                <p className="text-sm text-muted-foreground">
                  Pontos do certificado por canal. Edite a tabela quando a
                  transcrição ou o lançamento manual estiver incorreto.
                </p>
              </div>
              {formData.channels.map((channel, channelIndex) =>
                channel.points.length > 0 ? (
                  <ChannelPointsTable
                    key={channel.key}
                    channel={channel}
                    disabled={disabled}
                    channelIndex={channelIndex}
                    onAddPoint={addChannelPoint}
                    onRemovePoint={removeChannelPoint}
                    onPointChange={updateChannelPoint}
                  />
                ) : (
                  <Button
                    key={`${channel.key}-add-point`}
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => addChannelPoint(channelIndex)}
                  >
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="mr-2 size-4"
                    />
                    Adicionar ponto em {channel.label}
                  </Button>
                ),
              )}
            </div>
          </div>
        )}

        {definition.mode === 'mass' && (
          <div className="space-y-5">
            <div className="space-y-3">
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-28">Nominal</TableHead>
                      <TableHead className="min-w-32">Autenticação</TableHead>
                      <TableHead className="min-w-28">Valor</TableHead>
                      <TableHead className="min-w-28">Incerteza</TableHead>
                      <TableHead className="w-24">Unid.</TableHead>
                      <TableHead className="w-24">Erro</TableHead>
                      <TableHead className="w-24">Deriva</TableHead>
                      <TableHead className="w-24">Empuxo</TableHead>
                      <TableHead className="w-20">k</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {formData.certifiedValues.map((value, index) => (
                      <TableRow key={`${value.nominal}-${index}`}>
                        <EditableCell
                          value={value.nominal}
                          onChange={(next) =>
                            updateMassValue(index, 'nominal', next)
                          }
                          disabled={disabled}
                        />
                        <EditableCell
                          value={value.authentication}
                          onChange={(next) =>
                            updateMassValue(index, 'authentication', next)
                          }
                          disabled={disabled}
                        />
                        <EditableCell
                          type="number"
                          value={value.value}
                          onChange={(next) =>
                            updateMassValue(index, 'value', next)
                          }
                          disabled={disabled}
                        />
                        <EditableCell
                          type="number"
                          value={value.uncertainty}
                          onChange={(next) =>
                            updateMassValue(index, 'uncertainty', next)
                          }
                          disabled={disabled}
                        />
                        <EditableCell
                          value={value.unit}
                          onChange={(next) =>
                            updateMassValue(index, 'unit', next)
                          }
                          disabled={disabled}
                        />
                        <EditableCell
                          type="number"
                          value={value.maxError}
                          onChange={(next) =>
                            updateMassValue(index, 'maxError', next)
                          }
                          disabled={disabled}
                        />
                        <EditableCell
                          type="number"
                          value={value.drift}
                          onChange={(next) =>
                            updateMassValue(index, 'drift', next)
                          }
                          disabled={disabled}
                        />
                        <EditableCell
                          type="number"
                          value={value.buoyancy}
                          onChange={(next) =>
                            updateMassValue(index, 'buoyancy', next)
                          }
                          disabled={disabled}
                        />
                        <EditableCell
                          type="number"
                          value={value.coverageFactor}
                          onChange={(next) =>
                            updateMassValue(index, 'coverageFactor', next)
                          }
                          disabled={disabled}
                        />
                        <TableCell>
                          <RemoveRowButton
                            label="Remover valor de massa"
                            disabled={
                              disabled || formData.certifiedValues.length <= 1
                            }
                            onClick={() =>
                              updateField(
                                'certifiedValues',
                                formData.certifiedValues.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              )
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  updateField('certifiedValues', [
                    ...formData.certifiedValues,
                    createStandardCertifiedValueDraft(),
                  ])
                }
              >
                <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
                Adicionar valor
              </Button>
              {errors.certifiedValues && (
                <FieldError>{errors.certifiedValues}</FieldError>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-4 border-t pt-5 md:grid-cols-3">
          <NumberField
            id="standard-coverage-factor"
            label="Fator de cobertura (k)"
            value={formData.coverageFactor}
            onChange={(value) => updateField('coverageFactor', value)}
            disabled={disabled}
          />
          <Field>
            <FieldLabel htmlFor="standard-distribution">
              Distribuição
            </FieldLabel>
            <NativeSelect
              id="standard-distribution"
              className="w-full"
              value={formData.distribution}
              onChange={(event) =>
                updateField(
                  'distribution',
                  event.target.value === 'rectangular'
                    ? 'rectangular'
                    : 'normal',
                )
              }
              disabled={disabled}
            >
              <NativeSelectOption value="normal">Normal</NativeSelectOption>
              <NativeSelectOption value="rectangular">
                Retangular
              </NativeSelectOption>
            </NativeSelect>
          </Field>
          <NumberField
            id="standard-drift"
            label="Deriva geral"
            value={formData.drift}
            onChange={(value) => updateField('drift', value)}
            disabled={disabled}
          />
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader
          title="Disponibilidade"
          description="Estado operacional do padrão no laboratório."
        />
        <Field>
          <FieldLabel htmlFor="standard-status">Status</FieldLabel>
          <NativeSelect
            id="standard-status"
            className="w-full max-w-xs"
            value={formData.status}
            onChange={(event) =>
              updateField('status', parseStandardStatus(event.target.value))
            }
            disabled={disabled}
          >
            {Object.entries(STANDARD_STATUS_LABELS).map(([value, label]) => (
              <NativeSelectOption key={value} value={value}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </section>
    </div>
  )
}

function SectionHeader({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

function TextField({
  id,
  label,
  value,
  onChange,
  error,
  disabled,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  disabled?: boolean
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        autoComplete="off"
      />
      {error && <FieldError>{error}</FieldError>}
    </Field>
  )
}

function DateField(props: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  disabled?: boolean
}) {
  return (
    <Field>
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <Input
        id={props.id}
        type="date"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        disabled={props.disabled}
        autoComplete="off"
      />
      {props.error && <FieldError>{props.error}</FieldError>}
    </Field>
  )
}

function NumberField(props: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  disabled?: boolean
}) {
  return (
    <Field>
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <Input
        id={props.id}
        type="number"
        inputMode="decimal"
        step="any"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        disabled={props.disabled}
        autoComplete="off"
        className="tabular-nums"
      />
      {props.error && <FieldError>{props.error}</FieldError>}
    </Field>
  )
}

function EditableCell({
  value,
  onChange,
  type = 'text',
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'number'
  disabled?: boolean
}) {
  return (
    <TableCell>
      <Input
        type={type}
        step={type === 'number' ? 'any' : undefined}
        inputMode={type === 'number' ? 'decimal' : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="h-8 min-w-20 tabular-nums"
      />
    </TableCell>
  )
}

function RemoveRowButton({
  label,
  disabled,
  onClick,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <HugeiconsIcon icon={Delete02Icon} className="size-4" />
    </Button>
  )
}

function ChannelPointsTable({
  channel,
  channelIndex,
  disabled,
  onAddPoint,
  onRemovePoint,
  onPointChange,
}: {
  channel: StandardMetrologyChannelFormData
  channelIndex: number
  disabled?: boolean
  onAddPoint: (channelIndex: number) => void
  onRemovePoint: (channelIndex: number, pointIndex: number) => void
  onPointChange: (
    channelIndex: number,
    pointIndex: number,
    field: keyof StandardMetrologyPointFormData,
    value: StandardMetrologyPointFormData[keyof StandardMetrologyPointFormData],
  ) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium">{channel.label}</h4>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onAddPoint(channelIndex)}
        >
          <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
          Adicionar ponto
        </Button>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-28 text-right">Referência</TableHead>
              <TableHead className="min-w-28 text-right">Indicação</TableHead>
              <TableHead className="min-w-28 text-right">Média</TableHead>
              <TableHead className="min-w-28 text-right">Tendência</TableHead>
              <TableHead className="min-w-24 text-right">U</TableHead>
              <TableHead className="w-24">Unid.</TableHead>
              <TableHead className="w-20 text-right">k</TableHead>
              <TableHead className="w-28">Operador</TableHead>
              <TableHead className="w-36 text-right">
                Graus de liberdade
              </TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {channel.points.map((point, index) => (
              <TableRow key={`${channel.key}-point-${index}`}>
                <PointCell
                  value={point.reference}
                  disabled={disabled}
                  onChange={(value) =>
                    onPointChange(channelIndex, index, 'reference', value)
                  }
                />
                <PointCell
                  value={point.indication}
                  disabled={disabled}
                  onChange={(value) =>
                    onPointChange(channelIndex, index, 'indication', value)
                  }
                />
                <PointCell
                  value={point.meanReading}
                  disabled={disabled}
                  onChange={(value) =>
                    onPointChange(channelIndex, index, 'meanReading', value)
                  }
                />
                <PointCell
                  value={point.correction}
                  disabled={disabled}
                  onChange={(value) =>
                    onPointChange(channelIndex, index, 'correction', value)
                  }
                />
                <PointCell
                  value={point.uncertainty}
                  disabled={disabled}
                  onChange={(value) =>
                    onPointChange(channelIndex, index, 'uncertainty', value)
                  }
                />
                <PointCell
                  value={point.unit}
                  disabled={disabled}
                  onChange={(value) =>
                    onPointChange(channelIndex, index, 'unit', value)
                  }
                />
                <PointCell
                  value={point.coverageFactor}
                  disabled={disabled}
                  onChange={(value) =>
                    onPointChange(channelIndex, index, 'coverageFactor', value)
                  }
                />
                <PointOperatorCell
                  value={point.degreesOfFreedomOperator}
                  disabled={disabled}
                  onChange={(value) =>
                    onPointChange(
                      channelIndex,
                      index,
                      'degreesOfFreedomOperator',
                      value,
                    )
                  }
                />
                <PointCell
                  value={
                    point.degreesOfFreedomOperator === 'infinity'
                      ? ''
                      : point.degreesOfFreedom
                  }
                  disabled={
                    disabled || point.degreesOfFreedomOperator === 'infinity'
                  }
                  onChange={(value) =>
                    onPointChange(
                      channelIndex,
                      index,
                      'degreesOfFreedom',
                      value,
                    )
                  }
                />
                <TableCell>
                  <RemoveRowButton
                    label="Remover ponto"
                    disabled={disabled}
                    onClick={() => onRemovePoint(channelIndex, index)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function PointCell({
  value,
  disabled,
  onChange,
}: {
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <TableCell>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="h-8 min-w-20 text-right font-mono tabular-nums"
      />
    </TableCell>
  )
}

function PointOperatorCell({
  value,
  disabled,
  onChange,
}: {
  value: StandardMetrologyPointFormData['degreesOfFreedomOperator']
  disabled?: boolean
  onChange: (
    value: StandardMetrologyPointFormData['degreesOfFreedomOperator'],
  ) => void
}) {
  return (
    <TableCell>
      <NativeSelect
        value={value}
        onChange={(event) =>
          onChange(parseDegreesOfFreedomOperator(event.target.value))
        }
        disabled={disabled}
        className="h-8 min-w-20"
      >
        <NativeSelectOption value="exact">=</NativeSelectOption>
        <NativeSelectOption value="greater_than">&gt;</NativeSelectOption>
        <NativeSelectOption value="infinity">Infinito</NativeSelectOption>
      </NativeSelect>
    </TableCell>
  )
}
