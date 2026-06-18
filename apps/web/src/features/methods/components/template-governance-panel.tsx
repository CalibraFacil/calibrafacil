import { type ReactNode } from 'react'
import type { MethodGovernance } from '@calibra-facil/client-runtime'

import { Badge } from '@/components/ui/badge'
import { Panel, PanelHeader } from '@/components/instrument-panel'

/**
 * Renders a template's metrology governance — the "informed, not trust-me"
 * surface a lab reviews before adopting: the measurand/model, the cited sources,
 * conformance notes, every open [VERIFICAR] item (verbatim, with severity), the
 * explicitly omitted uncertainty components, and a provenance-aware worked
 * example. All content is served verbatim from the catalog; nothing is invented
 * here.
 */

const SEVERITY: Record<
  MethodGovernance['verificarItems'][number]['severity'],
  { label: string; variant: 'secondary' | 'destructive' | 'outline' }
> = {
  info: { label: 'Informativo', variant: 'outline' },
  action: { label: 'Ação necessária', variant: 'secondary' },
  platform: { label: 'Risco de plataforma', variant: 'destructive' },
}

export function TemplateGovernancePanel({
  governance,
}: {
  governance: MethodGovernance
}) {
  const modelLabel =
    governance.model === 'gum_measurement_model'
      ? 'Modelo GUM (motor)'
      : 'Fórmulas explícitas'

  return (
    <Panel className="divide-y divide-foreground/10">
      <section className="p-4 sm:p-5">
        <PanelHeader eyebrow="Modelo de medição" title={governance.measurand} />
        <p className="mt-2 text-pretty text-sm text-muted-foreground">
          {governance.summary}
        </p>
        <Badge variant="outline" className="mt-2">
          {modelLabel}
        </Badge>
      </section>

      <Eyebrowed eyebrow="Fontes (lidas na íntegra)">
        <ul className="space-y-1.5">
          {governance.sources.map((source) => (
            <li key={`${source.title}-${source.edition}`} className="text-sm">
              {source.url ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  {source.title} {source.edition}
                </a>
              ) : (
                <span className="font-medium">
                  {source.title} {source.edition}
                </span>
              )}
              {source.section ? (
                <span className="text-muted-foreground"> · {source.section}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </Eyebrowed>

      {governance.conformanceNotes.length > 0 ? (
        <Eyebrowed eyebrow="Notas de conformidade">
          <ul className="space-y-1.5">
            {governance.conformanceNotes.map((note) => (
              <li key={note.ref} className="text-sm">
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {note.ref}
                </span>{' '}
                <span className="text-pretty text-muted-foreground">
                  {note.note}
                </span>
              </li>
            ))}
          </ul>
        </Eyebrowed>
      ) : null}

      <Eyebrowed eyebrow="Itens [VERIFICAR] — revisar antes do uso">
        <ul className="space-y-2.5">
          {governance.verificarItems.map((item, index) => {
            const sev = SEVERITY[item.severity]
            return (
              <li
                key={`${item.ref ?? 'item'}-${index}`}
                className="rounded-xl bg-muted/40 p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]"
              >
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge variant={sev.variant}>{sev.label}</Badge>
                  {item.ref ? (
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {item.ref}
                    </span>
                  ) : null}
                </div>
                <p className="text-pretty text-sm">{item.item}</p>
              </li>
            )
          })}
        </ul>
      </Eyebrowed>

      <Eyebrowed eyebrow="Componentes omitidos (responsabilidade do laboratório)">
        {governance.omittedComponents.length > 0 ? (
          <ul className="space-y-1.5">
            {governance.omittedComponents.map((omitted) => (
              <li key={omitted.ref} className="text-sm">
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {omitted.ref}
                </span>{' '}
                <span className="text-pretty">{omitted.component}</span>
                {omitted.appliesWhen ? (
                  <span className="text-muted-foreground">
                    {' '}
                    — aplica-se quando: {omitted.appliesWhen}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhum componente adicional sinalizado.
          </p>
        )}
        <p className="mt-2 text-sm font-medium text-destructive">
          Este orçamento de incerteza NÃO é declarado completo.
        </p>
      </Eyebrowed>

      {governance.workedExample ? (
        <Eyebrowed eyebrow="Exemplo verificado">
          <p className="text-sm">
            {governance.workedExample.provenance === 'cited_guide_table' ? (
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                ✓ reproduz o guia
              </span>
            ) : (
              <span className="font-medium text-muted-foreground">
                Verificação interna do motor
              </span>
            )}{' '}
            <span className="text-muted-foreground">
              ({governance.workedExample.source})
            </span>
          </p>
          {governance.workedExample.provenance !== 'cited_guide_table' ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Confere o cálculo do motor — não o processo de medição do seu
              laboratório.
            </p>
          ) : null}
        </Eyebrowed>
      ) : null}
    </Panel>
  )
}

function Eyebrowed({
  eyebrow,
  children,
}: {
  eyebrow: string
  children: ReactNode
}) {
  return (
    <section className="p-4 sm:p-5">
      <p className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {eyebrow}
      </p>
      {children}
    </section>
  )
}
