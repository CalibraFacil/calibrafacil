import { Add01Icon, Delete02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { Button } from '@/components/ui/button'
import { Panel, PanelHeader } from '@/components/instrument-panel'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { FormField as Field } from '@/shared/forms/form-field'

import type { MethodDraftCertificateContent } from './types'

type CertificateSection = NonNullable<
  MethodDraftCertificateContent['sections']
>[number]

const certificateDisplayOptions = ['full', 'hidden'] as const

export function CertificateContentSection({
  certificate,
  onCertificateChange,
  onAddSection,
  onSectionChange,
  onSectionRemove,
}: {
  certificate: MethodDraftCertificateContent | null
  onCertificateChange: (patch: Partial<MethodDraftCertificateContent>) => void
  onAddSection: () => void
  onSectionChange: (index: number, section: CertificateSection) => void
  onSectionRemove: (index: number) => void
}) {
  return (
    <Panel className="p-4 sm:p-5">
      <PanelHeader
        eyebrow="Saída"
        title="Certificado"
        description="Conteúdo persistido no rascunho para emissão."
      />
      <div className="mt-4 space-y-4">
        <Field label="Código do procedimento">
          <Input
            value={certificate?.procedureCode ?? ''}
            onChange={(event) =>
              onCertificateChange({ procedureCode: event.target.value })
            }
          />
        </Field>
        <div className="grid gap-3 md:grid-cols-3">
          <CertificateDisplaySelect
            label="Valores certificados"
            value={certificate?.certifiedValuesDisplay ?? 'full'}
            onChange={(value) =>
              onCertificateChange({ certifiedValuesDisplay: value })
            }
          />
          <CertificateDisplaySelect
            label="Composição de massa"
            value={certificate?.massCompositionDisplay ?? 'full'}
            onChange={(value) =>
              onCertificateChange({ massCompositionDisplay: value })
            }
          />
          <CertificateDisplaySelect
            label="Orçamento de incerteza"
            value={certificate?.uncertaintyBudgetDisplay ?? 'full'}
            onChange={(value) =>
              onCertificateChange({ uncertaintyBudgetDisplay: value })
            }
          />
        </div>
        <Field label="Gráfico da curva de calibração (motor visual)">
          <div className="space-y-2">
            {(certificate?.resultCharts ?? []).map((chart, index) => (
              <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                <Input
                  value={chart.tableKey}
                  onChange={(event) => {
                    const next = [...(certificate?.resultCharts ?? [])]
                    next[index] = { ...chart, tableKey: event.target.value }
                    onCertificateChange({ resultCharts: next })
                  }}
                  placeholder="Tabela (ex.: pontos_indicacao)"
                />
                <Input
                  value={chart.xKey}
                  onChange={(event) => {
                    const next = [...(certificate?.resultCharts ?? [])]
                    next[index] = { ...chart, xKey: event.target.value }
                    onCertificateChange({ resultCharts: next })
                  }}
                  placeholder="Eixo X (ex.: valor_padrao)"
                />
                <Input
                  value={chart.yKey}
                  onChange={(event) => {
                    const next = [...(certificate?.resultCharts ?? [])]
                    next[index] = { ...chart, yKey: event.target.value }
                    onCertificateChange({ resultCharts: next })
                  }}
                  placeholder="Eixo Y (ex.: erro_indicacao_antes)"
                />
                <Input
                  value={chart.uncertaintyKey ?? ''}
                  onChange={(event) => {
                    const next = [...(certificate?.resultCharts ?? [])]
                    next[index] = {
                      ...chart,
                      uncertaintyKey: event.target.value || undefined,
                    }
                    onCertificateChange({ resultCharts: next })
                  }}
                  placeholder="Barra U (opcional)"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onCertificateChange({
                      resultCharts: (certificate?.resultCharts ?? []).filter(
                        (_item, itemIndex) => itemIndex !== index,
                      ),
                    })
                  }
                >
                  Remover
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={(certificate?.resultCharts ?? []).length >= 4}
              onClick={() =>
                onCertificateChange({
                  resultCharts: [
                    ...(certificate?.resultCharts ?? []),
                    { tableKey: '', xKey: '', yKey: '' },
                  ],
                })
              }
            >
              Adicionar gráfico
            </Button>
          </div>
        </Field>
        <Field label="Regra de decisão (ISO/IEC 17025 §7.8.6)">
          <Textarea
            value={certificate?.decisionRuleStatement ?? ''}
            onChange={(event) =>
              onCertificateChange({
                decisionRuleStatement: event.target.value || undefined,
              })
            }
            placeholder="Texto impresso no certificado quando o modelo incluir o bloco de regra de decisão"
            rows={2}
          />
        </Field>
        <Field label="Padrões de referência">
          <Textarea
            value={(certificate?.referenceStandards ?? []).join('\n')}
            onChange={(event) =>
              onCertificateChange({
                referenceStandards: event.target.value
                  .split('\n')
                  .map((item) => item.trim())
                  .filter(Boolean),
              })
            }
            rows={3}
          />
        </Field>
        <Separator />
        <div className="flex items-center justify-between gap-3">
          <Label>Seções fixas</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAddSection}
          >
            <HugeiconsIcon icon={Add01Icon} className="mr-2 h-4 w-4" />
            Adicionar seção
          </Button>
        </div>
        <div className="space-y-3">
          {(certificate?.sections ?? []).map((section, index) => (
            <CertificateSectionEditor
              key={index}
              section={section}
              onChange={(nextSection) => onSectionChange(index, nextSection)}
              onRemove={() => onSectionRemove(index)}
            />
          ))}
        </div>
      </div>
    </Panel>
  )
}

function CertificateDisplaySelect({
  label,
  value,
  onChange,
}: {
  label: string
  value: 'full' | 'hidden'
  onChange: (value: 'full' | 'hidden') => void
}) {
  return (
    <Field label={label}>
      <Select
        value={value}
        onValueChange={(nextValue) => {
          if (nextValue === 'full' || nextValue === 'hidden') {
            onChange(nextValue)
          }
        }}
      >
        <SelectTrigger>
          <span>{value === 'full' ? 'Exibir' : 'Ocultar'}</span>
        </SelectTrigger>
        <SelectContent>
          {certificateDisplayOptions.map((option) => (
            <SelectItem key={option} value={option}>
              {option === 'full' ? 'Exibir' : 'Ocultar'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

function CertificateSectionEditor({
  section,
  onChange,
  onRemove,
}: {
  section: CertificateSection
  onChange: (section: CertificateSection) => void
  onRemove: () => void
}) {
  const textValue =
    section.kind === 'paragraphs'
      ? section.paragraphs.join('\n')
      : section.kind === 'bullets'
        ? section.items.join('\n')
        : section.items
            .map((item) => `${item.term}: ${item.definition}`)
            .join('\n')

  return (
    <div className="rounded-md border p-3">
      <div className="grid gap-3 md:grid-cols-[150px_1fr_auto]">
        <Field label="Tipo">
          <Select
            value={section.kind}
            onValueChange={(kind) => {
              if (kind === 'definition_list') {
                onChange({
                  kind,
                  title: section.title ?? 'Definições',
                  items: [],
                })
                return
              }
              if (kind === 'bullets') {
                onChange({
                  kind,
                  title: section.title,
                  items: [],
                })
                return
              }
              onChange({
                kind: 'paragraphs',
                title: section.title ?? 'Seção',
                paragraphs: [],
              })
            }}
          >
            <SelectTrigger>
              <span>{section.kind}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="paragraphs">Parágrafos</SelectItem>
              <SelectItem value="bullets">Lista</SelectItem>
              <SelectItem value="definition_list">Definições</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Título">
          <Input
            value={section.title ?? ''}
            onChange={(event) =>
              onChange({ ...section, title: event.target.value })
            }
          />
        </Field>
        <div className="flex items-end justify-end">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remover seção"
            onClick={onRemove}
          >
            <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <Field label="Conteúdo">
        <Textarea
          value={textValue}
          onChange={(event) => {
            const lines = event.target.value
              .split('\n')
              .map((item) => item.trim())
              .filter(Boolean)

            if (section.kind === 'paragraphs') {
              onChange({ ...section, paragraphs: lines })
              return
            }
            if (section.kind === 'bullets') {
              onChange({ ...section, items: lines })
              return
            }
            onChange({
              ...section,
              items: lines.map((line) => {
                const [term, ...definition] = line.split(':')
                return {
                  term: term?.trim() || 'Termo',
                  definition: definition.join(':').trim(),
                }
              }),
            })
          }}
          rows={4}
        />
      </Field>
    </div>
  )
}
