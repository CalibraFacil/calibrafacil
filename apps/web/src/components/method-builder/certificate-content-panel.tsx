import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, Delete02Icon, File01Icon } from '@hugeicons/core-free-icons'

import type {
  MethodCertificateContent,
  MethodCertificateContentSection,
} from './types'

import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type SectionKind = MethodCertificateContentSection['kind']

const sectionKindLabels: Record<SectionKind, string> = {
  paragraphs: 'Texto',
  definition_list: 'Definições',
  bullets: 'Lista',
}

const certifiedValuesDisplayLabels = {
  full: 'Exibir tabela completa',
  hidden: 'Ocultar tabela completa',
} as const

const massCompositionDisplayLabels = {
  full: 'Exibir rastreabilidade por ponto',
  hidden: 'Ocultar rastreabilidade por ponto',
} as const

const uncertaintyBudgetDisplayLabels = {
  full: 'Exibir orçamento de incerteza',
  hidden: 'Ocultar orçamento de incerteza',
} as const

function normalizeContent(
  content: MethodCertificateContent | null | undefined,
): Required<MethodCertificateContent> {
  return {
    procedureCode: content?.procedureCode ?? '',
    referenceStandards: content?.referenceStandards ?? [],
    certifiedValuesDisplay: content?.certifiedValuesDisplay ?? 'full',
    massCompositionDisplay: content?.massCompositionDisplay ?? 'full',
    uncertaintyBudgetDisplay: content?.uncertaintyBudgetDisplay ?? 'full',
    sections: content?.sections ?? [],
  }
}

function splitParagraphs(value: string) {
  return value
    .split(/\n\s*\n/g)
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitLines(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

function createSection(kind: SectionKind): MethodCertificateContentSection {
  if (kind === 'definition_list') {
    return {
      kind,
      title: 'CONVENÇÕES',
      items: [{ term: '', definition: '' }],
    }
  }
  if (kind === 'bullets') {
    return {
      kind,
      title: '',
      items: [''],
    }
  }
  return {
    kind,
    title: 'MÉTODO',
    paragraphs: [''],
  }
}

function convertSection(
  section: MethodCertificateContentSection,
  kind: SectionKind,
): MethodCertificateContentSection {
  const title = 'title' in section ? section.title : ''
  const nextSection = createSection(kind)

  if ('title' in nextSection) {
    nextSection.title = title
  }

  return nextSection
}

interface CertificateContentPanelProps {
  content: MethodCertificateContent | null | undefined
  onChange: (content: MethodCertificateContent) => void
  disabled?: boolean
}

export function CertificateContentPanel({
  content,
  onChange,
  disabled = false,
}: CertificateContentPanelProps) {
  const current = normalizeContent(content)

  const update = (updates: Partial<MethodCertificateContent>) => {
    onChange({ ...current, ...updates })
  }

  const updateSection = (
    index: number,
    section: MethodCertificateContentSection,
  ) => {
    update({
      sections: current.sections.map((item, itemIndex) =>
        itemIndex === index ? section : item,
      ),
    })
  }

  const removeSection = (index: number) => {
    update({
      sections: current.sections.filter((_, itemIndex) => itemIndex !== index),
    })
  }

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="certificate-procedure">Procedimento</FieldLabel>
        <Input
          id="certificate-procedure"
          name="certificateProcedure"
          value={current.procedureCode}
          onChange={(event) =>
            update({ procedureCode: event.target.value.trim() || undefined })
          }
          placeholder="PBT09…"
          disabled={disabled}
          autoComplete="off"
        />
        <FieldDescription>
          Código fixo exibido no certificado, sem exigir preenchimento do
          técnico na execução.
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel>Normas de referência</FieldLabel>
        <div className="space-y-2">
          {current.referenceStandards.length === 0 ? (
            <p className="rounded border border-dashed p-3 text-sm text-muted-foreground">
              Nenhuma norma cadastrada para este método.
            </p>
          ) : (
            current.referenceStandards.map((reference, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  name={`referenceStandard-${index}`}
                  aria-label={`Norma de referência ${index + 1}`}
                  value={reference}
                  onChange={(event) =>
                    update({
                      referenceStandards: current.referenceStandards.map(
                        (item, itemIndex) =>
                          itemIndex === index ? event.target.value : item,
                      ),
                    })
                  }
                  placeholder="UKAS LAB 14"
                  disabled={disabled}
                  autoComplete="off"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remover norma ${reference || index + 1}`}
                  onClick={() =>
                    update({
                      referenceStandards: current.referenceStandards.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    })
                  }
                  disabled={disabled}
                >
                  <HugeiconsIcon
                    icon={Delete02Icon}
                    aria-hidden="true"
                    className="size-4"
                  />
                </Button>
              </div>
            ))
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 active:scale-[0.96] transition-transform"
          onClick={() =>
            update({
              referenceStandards: [...current.referenceStandards, ''],
            })
          }
          disabled={disabled}
        >
          <HugeiconsIcon
            icon={Add01Icon}
            aria-hidden="true"
            className="mr-2 size-4"
          />
          Adicionar norma
        </Button>
      </Field>

      <Field>
        <FieldLabel>Valores certificados dos padrões</FieldLabel>
        <Select
          value={current.certifiedValuesDisplay}
          onValueChange={(value) =>
            update({
              certifiedValuesDisplay:
                value as MethodCertificateContent['certifiedValuesDisplay'],
            })
          }
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue>
              {certifiedValuesDisplayLabels[current.certifiedValuesDisplay]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(certifiedValuesDisplayLabels).map(
              ([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
        <FieldDescription>
          Use a tabela completa apenas quando o modelo de certificado exigir a
          listagem de cada valor certificado do conjunto.
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel>Composição dos padrões por ponto</FieldLabel>
        <Select
          value={current.massCompositionDisplay}
          onValueChange={(value) =>
            update({
              massCompositionDisplay:
                value as MethodCertificateContent['massCompositionDisplay'],
            })
          }
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue>
              {massCompositionDisplayLabels[current.massCompositionDisplay]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(massCompositionDisplayLabels).map(
              ([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
        <FieldDescription>
          Controle a tabela detalhada de rastreabilidade criada a partir das
          composições de pesos usadas nos pontos.
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel>Orçamento de incerteza</FieldLabel>
        <Select
          value={current.uncertaintyBudgetDisplay}
          onValueChange={(value) =>
            update({
              uncertaintyBudgetDisplay:
                value as MethodCertificateContent['uncertaintyBudgetDisplay'],
            })
          }
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue>
              {uncertaintyBudgetDisplayLabels[current.uncertaintyBudgetDisplay]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(uncertaintyBudgetDisplayLabels).map(
              ([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
        <FieldDescription>
          Alguns certificados apresentam apenas os resultados finais com U, k e
          Veff, sem abrir os componentes intermediários.
        </FieldDescription>
      </Field>

      <Field>
        <div className="flex items-center justify-between gap-3">
          <div>
            <FieldLabel>Seções fixas do certificado</FieldLabel>
            <FieldDescription>
              Textos técnicos versionados com o método e congelados no job.
            </FieldDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['paragraphs', 'definition_list', 'bullets'] as const).map(
              (kind) => (
                <Button
                  key={kind}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    update({
                      sections: [...current.sections, createSection(kind)],
                    })
                  }
                  disabled={disabled}
                  className="active:scale-[0.96] transition-transform"
                >
                  <HugeiconsIcon
                    icon={Add01Icon}
                    aria-hidden="true"
                    className="mr-2 size-4"
                  />
                  {sectionKindLabels[kind]}
                </Button>
              ),
            )}
          </div>
        </div>

        {current.sections.length === 0 ? (
          <p className="mt-2 rounded border border-dashed p-3 text-sm text-muted-foreground">
            Nenhuma seção fixa cadastrada.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {current.sections.map((section, index) => (
              <div key={index} className="rounded-lg border p-3">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <HugeiconsIcon
                    icon={File01Icon}
                    aria-hidden="true"
                    className="size-4"
                  />
                  <Select
                    value={section.kind}
                    onValueChange={(kind) =>
                      updateSection(
                        index,
                        convertSection(section, kind as SectionKind),
                      )
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger className="w-[150px]">
                      <SelectValue>
                        {sectionKindLabels[section.kind]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(sectionKindLabels).map(
                        ([kind, label]) => (
                          <SelectItem key={kind} value={kind}>
                            {label}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="ml-auto"
                    aria-label={`Remover seção ${index + 1}`}
                    onClick={() => removeSection(index)}
                    disabled={disabled}
                  >
                    <HugeiconsIcon
                      icon={Delete02Icon}
                      aria-hidden="true"
                      className="size-4"
                    />
                  </Button>
                </div>

                {renderSectionEditor(
                  section,
                  (nextSection) => updateSection(index, nextSection),
                  disabled,
                )}
              </div>
            ))}
          </div>
        )}
      </Field>
    </FieldGroup>
  )
}

function renderSectionEditor(
  section: MethodCertificateContentSection,
  onChange: (section: MethodCertificateContentSection) => void,
  disabled: boolean,
) {
  if (section.kind === 'definition_list') {
    return (
      <div className="space-y-3">
        <Input
          name="definitionSectionTitle"
          aria-label="Título da seção de definições"
          value={section.title}
          onChange={(event) =>
            onChange({ ...section, title: event.target.value })
          }
          placeholder="CONVENÇÕES…"
          disabled={disabled}
          autoComplete="off"
        />
        <div className="space-y-2">
          {section.items.map((item, index) => (
            <div
              key={index}
              className="grid gap-2 md:grid-cols-[120px_1fr_auto]"
            >
              <Input
                name={`definitionTerm-${index}`}
                aria-label={`Termo da definição ${index + 1}`}
                value={item.term}
                onChange={(event) =>
                  onChange({
                    ...section,
                    items: section.items.map((currentItem, itemIndex) =>
                      itemIndex === index
                        ? { ...currentItem, term: event.target.value }
                        : currentItem,
                    ),
                  })
                }
                placeholder="VC"
                disabled={disabled}
                autoComplete="off"
              />
              <Input
                name={`definitionValue-${index}`}
                aria-label={`Texto da definição ${index + 1}`}
                value={item.definition}
                onChange={(event) =>
                  onChange({
                    ...section,
                    items: section.items.map((currentItem, itemIndex) =>
                      itemIndex === index
                        ? { ...currentItem, definition: event.target.value }
                        : currentItem,
                    ),
                  })
                }
                placeholder="Valor Convencional…"
                disabled={disabled}
                autoComplete="off"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remover definição ${index + 1}`}
                onClick={() =>
                  onChange({
                    ...section,
                    items: section.items.filter(
                      (_, itemIndex) => itemIndex !== index,
                    ),
                  })
                }
                disabled={disabled}
              >
                <HugeiconsIcon
                  icon={Delete02Icon}
                  aria-hidden="true"
                  className="size-4"
                />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange({
              ...section,
              items: [...section.items, { term: '', definition: '' }],
            })
          }
          disabled={disabled}
          className="active:scale-[0.96] transition-transform"
        >
          <HugeiconsIcon
            icon={Add01Icon}
            aria-hidden="true"
            className="mr-2 size-4"
          />
          Adicionar definição
        </Button>
      </div>
    )
  }

  if (section.kind === 'bullets') {
    return (
      <div className="space-y-3">
        <Input
          name="bulletSectionTitle"
          aria-label="Título da lista"
          value={section.title ?? ''}
          onChange={(event) =>
            onChange({ ...section, title: event.target.value || undefined })
          }
          placeholder="Título opcional…"
          disabled={disabled}
          autoComplete="off"
        />
        <Textarea
          name="bulletSectionItems"
          aria-label="Itens da lista"
          value={section.items.join('\n')}
          onChange={(event) =>
            onChange({ ...section, items: splitLines(event.target.value) })
          }
          placeholder="Uma nota por linha…"
          rows={5}
          disabled={disabled}
          autoComplete="off"
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Input
        name="paragraphSectionTitle"
        aria-label="Título da seção de texto"
        value={section.title}
        onChange={(event) =>
          onChange({ ...section, title: event.target.value })
        }
        placeholder="MÉTODO…"
        disabled={disabled}
        autoComplete="off"
      />
      <Textarea
        name="paragraphSectionContent"
        aria-label="Texto da seção"
        value={section.paragraphs.join('\n\n')}
        onChange={(event) =>
          onChange({
            ...section,
            paragraphs: splitParagraphs(event.target.value),
          })
        }
        placeholder="Separe parágrafos com uma linha em branco…"
        rows={6}
        disabled={disabled}
        autoComplete="off"
      />
    </div>
  )
}
