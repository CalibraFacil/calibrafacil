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

function normalizeContent(
  content: MethodCertificateContent | null | undefined,
): Required<MethodCertificateContent> {
  return {
    procedureCode: content?.procedureCode ?? '',
    referenceStandards: content?.referenceStandards ?? [],
    certifiedValuesDisplay: content?.certifiedValuesDisplay ?? 'full',
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
          value={current.procedureCode}
          onChange={(event) =>
            update({ procedureCode: event.target.value.trim() || undefined })
          }
          placeholder="PBT09"
          disabled={disabled}
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
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    update({
                      referenceStandards: current.referenceStandards.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    })
                  }
                  disabled={disabled}
                >
                  <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() =>
            update({
              referenceStandards: [...current.referenceStandards, ''],
            })
          }
          disabled={disabled}
        >
          <HugeiconsIcon icon={Add01Icon} className="mr-2 h-4 w-4" />
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
                >
                  <HugeiconsIcon icon={Add01Icon} className="mr-2 h-4 w-4" />
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
                  <HugeiconsIcon icon={File01Icon} className="h-4 w-4" />
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
                    onClick={() => removeSection(index)}
                    disabled={disabled}
                  >
                    <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" />
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
          value={section.title}
          onChange={(event) =>
            onChange({ ...section, title: event.target.value })
          }
          placeholder="CONVENÇÕES"
          disabled={disabled}
        />
        <div className="space-y-2">
          {section.items.map((item, index) => (
            <div
              key={index}
              className="grid gap-2 md:grid-cols-[120px_1fr_auto]"
            >
              <Input
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
              />
              <Input
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
                placeholder="Valor Convencional..."
                disabled={disabled}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
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
                <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" />
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
        >
          <HugeiconsIcon icon={Add01Icon} className="mr-2 h-4 w-4" />
          Adicionar definição
        </Button>
      </div>
    )
  }

  if (section.kind === 'bullets') {
    return (
      <div className="space-y-3">
        <Input
          value={section.title ?? ''}
          onChange={(event) =>
            onChange({ ...section, title: event.target.value || undefined })
          }
          placeholder="Título opcional"
          disabled={disabled}
        />
        <Textarea
          value={section.items.join('\n')}
          onChange={(event) =>
            onChange({ ...section, items: splitLines(event.target.value) })
          }
          placeholder="Uma nota por linha"
          rows={5}
          disabled={disabled}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Input
        value={section.title}
        onChange={(event) =>
          onChange({ ...section, title: event.target.value })
        }
        placeholder="MÉTODO"
        disabled={disabled}
      />
      <Textarea
        value={section.paragraphs.join('\n\n')}
        onChange={(event) =>
          onChange({
            ...section,
            paragraphs: splitParagraphs(event.target.value),
          })
        }
        placeholder="Separe parágrafos com uma linha em branco."
        rows={6}
        disabled={disabled}
      />
    </div>
  )
}
