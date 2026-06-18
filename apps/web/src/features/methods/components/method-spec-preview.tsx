import { type ReactNode } from 'react'
import {
  DistributionIcon,
  FunctionIcon,
  TaskDone01Icon,
  TextFontIcon,
} from '@hugeicons/core-free-icons'

import type { MethodDetail } from '@/features/methods/types'
import { Badge } from '@/components/ui/badge'
import {
  BlueprintField,
  BlueprintGrid,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
} from '@/components/instrument-panel'

/**
 * The read-only "specification" view of a method: input fields, formulas,
 * acceptance criteria, type-B uncertainty components, and the certificate-content
 * summary. Extracted from the method detail page so the same surface can be reused
 * (e.g. in the from-template adoption flow) — the spec a user reviews before
 * adopting must be byte-identical to what the published detail page shows.
 *
 * Prop is a structural subset of MethodDetail so non-detail callers can pass any
 * compatible spec shape.
 */
export type MethodSpec = Pick<
  MethodDetail,
  'dataFields' | 'formulas' | 'validations' | 'uncertaintyParams' | 'certificateContent'
>

export function hasCertificateContent(method: MethodSpec): boolean {
  const content = method.certificateContent
  if (!content) return false
  return Boolean(
    (content.procedureCode ?? '').trim() ||
      (content.referenceStandards?.length ?? 0) > 0 ||
      (content.sections?.length ?? 0) > 0,
  )
}

/**
 * The four count tiles (fields / formulas / criteria / type-B components).
 * Kept separate from MethodSpecPreview so the detail page can render them in its
 * hero while the body renders the spec blocks — no layout change on extraction.
 */
export function MethodSpecCounts({ method }: { method: MethodSpec }) {
  return (
    <StaggerGroup className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
      <StaggerItem>
        <SignalTile
          icon={TextFontIcon}
          label="Campos"
          value={String(method.dataFields.length)}
          hint="entradas"
          tone="neutral"
        />
      </StaggerItem>
      <StaggerItem>
        <SignalTile
          icon={FunctionIcon}
          label="Fórmulas"
          value={String(method.formulas.length)}
          hint="cálculos"
          tone="neutral"
        />
      </StaggerItem>
      <StaggerItem>
        <SignalTile
          icon={TaskDone01Icon}
          label="Critérios"
          value={String(method.validations.length)}
          hint="aceitação"
          tone="neutral"
        />
      </StaggerItem>
      <StaggerItem>
        <SignalTile
          icon={DistributionIcon}
          label="Incerteza B"
          value={String(method.uncertaintyParams.length)}
          hint="componentes"
          tone="neutral"
        />
      </StaggerItem>
    </StaggerGroup>
  )
}

export function MethodSpecPreview({ method }: { method: MethodSpec }) {
  return (
    <>
      {/* Specification — fields / formulas / criteria / uncertainty */}
      <Panel className="divide-y divide-foreground/10">
        <SpecBlock eyebrow="Campos de entrada" count={method.dataFields.length}>
          {method.dataFields.length === 0 ? (
            <EmptyNote>Nenhum campo de entrada definido.</EmptyNote>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {method.dataFields.map((field) => (
                <div
                  key={field.key}
                  className="rounded-xl bg-muted/40 p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">
                      {field.label}
                    </span>
                    <Badge variant="outline" className="shrink-0">
                      {field.type}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {field.key}
                    </span>
                    {field.unit ? (
                      <Badge variant="secondary">{field.unit}</Badge>
                    ) : null}
                    {field.required ? (
                      <span className="text-[11px] font-medium text-destructive">
                        obrigatório
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SpecBlock>

        <SpecBlock eyebrow="Fórmulas" count={method.formulas.length}>
          {method.formulas.length === 0 ? (
            <EmptyNote>Nenhuma fórmula definida.</EmptyNote>
          ) : (
            <div className="space-y-2.5">
              {method.formulas.map((formula) => (
                <div
                  key={formula.outputKey}
                  className="rounded-xl bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">
                      {formula.label || formula.outputKey}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {formula.outputKey}
                    </span>
                    {formula.unit ? (
                      <Badge variant="secondary">{formula.unit}</Badge>
                    ) : null}
                    {formula.reporting?.role ? (
                      <Badge variant="outline">{formula.reporting.role}</Badge>
                    ) : null}
                  </div>
                  <code className="mt-2 block max-w-full overflow-x-auto rounded-md bg-muted/50 px-2.5 py-2 font-mono text-xs leading-relaxed">
                    {formula.expression}
                  </code>
                </div>
              ))}
            </div>
          )}
        </SpecBlock>

        <SpecBlock
          eyebrow="Critérios de aceitação"
          count={method.validations.length}
        >
          {method.validations.length === 0 ? (
            <EmptyNote>Nenhum critério definido.</EmptyNote>
          ) : (
            <div className="space-y-2.5">
              {method.validations.map((validation, index) => (
                <div
                  key={`${validation.leftExpression}-${validation.operator}-${validation.rightExpression}-${index}`}
                  className="rounded-xl bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted/50 px-2.5 py-2 font-mono text-xs leading-relaxed">
                      {validation.leftExpression} {validation.operator}{' '}
                      {validation.rightExpression}
                    </code>
                    <Badge
                      variant={
                        validation.severity === 'error'
                          ? 'destructive'
                          : 'outline'
                      }
                      className="shrink-0"
                    >
                      {validation.severity === 'error' ? 'Erro' : 'Aviso'}
                    </Badge>
                  </div>
                  {validation.message ? (
                    <p className="mt-1.5 text-pretty text-sm text-muted-foreground">
                      {validation.message}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </SpecBlock>

        {method.uncertaintyParams.length > 0 ? (
          <SpecBlock
            eyebrow="Componentes de incerteza (tipo B)"
            count={method.uncertaintyParams.length}
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {method.uncertaintyParams.map((component) => (
                <div
                  key={component.name}
                  className="rounded-xl bg-muted/40 p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">
                      {component.name}
                    </span>
                    <span className="shrink-0 font-mono text-sm tabular-nums">
                      {component.value}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{component.distribution}</Badge>
                    {component.degreesOfFreedom ? (
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        veff {component.degreesOfFreedom}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </SpecBlock>
        ) : null}
      </Panel>

      {hasCertificateContent(method) ? (
        <Panel className="p-4 sm:p-5">
          <PanelHeader
            eyebrow="Saída"
            title="Conteúdo do certificado"
            description="Textos e blocos que acompanham os certificados gerados."
          />
          <BlueprintGrid className="mt-4 sm:grid-cols-2">
            {method.certificateContent?.procedureCode ? (
              <BlueprintField label="Procedimento" mono>
                {method.certificateContent.procedureCode}
              </BlueprintField>
            ) : null}
            {(method.certificateContent?.referenceStandards?.length ?? 0) > 0 ? (
              <BlueprintField label="Normas de referência">
                {method.certificateContent?.referenceStandards?.join(', ')}
              </BlueprintField>
            ) : null}
            {(method.certificateContent?.sections?.length ?? 0) > 0 ? (
              <BlueprintField label="Blocos de texto">
                {method.certificateContent?.sections?.length} seç
                {(method.certificateContent?.sections?.length ?? 0) === 1
                  ? 'ão'
                  : 'ões'}
              </BlueprintField>
            ) : null}
          </BlueprintGrid>
        </Panel>
      ) : null}
    </>
  )
}

function SpecBlock({
  eyebrow,
  count,
  children,
}: {
  eyebrow: string
  count?: number
  children: ReactNode
}) {
  return (
    <section className="p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {eyebrow}
        </p>
        {count !== undefined ? (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {count}
          </span>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}
