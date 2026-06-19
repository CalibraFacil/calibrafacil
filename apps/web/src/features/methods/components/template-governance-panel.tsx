import { type ReactNode } from 'react'
import type { MethodGovernance } from '@calibra-facil/client-runtime'

import { Badge } from '@/components/ui/badge'
import { Panel, PanelHeader } from '@/components/instrument-panel'
import { cn } from '@/lib/utils'

/**
 * Renders a template's metrology governance — the "informed, not trust-me"
 * surface a lab reviews before adopting: the measurand/model, the open
 * [VERIFICAR] items (promoted to the top, action-first), the situational
 * components, the cited sources, conformance notes, and a provenance-aware worked
 * example. Content is served verbatim from the catalog; nothing is invented here.
 */

type VerificarSeverity = MethodGovernance['verificarItems'][number]['severity']

/**
 * Visible treatment per severity. No "platform"/destructive branch — that item is
 * gone from the data (it never applied to the single-scalar platform templates),
 * so nothing here screams "do not use". `action` reads as a warning to act on;
 * everything else reads neutral.
 */
function severityMeta(severity: VerificarSeverity): {
  label: string
  className: string
} {
  if (severity === 'action') {
    return {
      label: 'Verificar antes do uso',
      className:
        'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    }
  }
  return { label: 'Informativo', className: '' }
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

  // Promote action items to the top — they are the most actionable content.
  // Spread first so the original array is not mutated (no toSorted: the web
  // tsconfig lib target predates ES2023).
  const verificarItems = [...governance.verificarItems].sort(
    (a, b) =>
      (a.severity === 'action' ? 0 : 1) - (b.severity === 'action' ? 0 : 1),
  )

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

      <Eyebrowed eyebrow="A verificar antes do uso">
        <ul className="space-y-2.5">
          {verificarItems.map((item, index) => {
            const sev = severityMeta(item.severity)
            return (
              <li
                key={`${item.ref ?? 'item'}-${index}`}
                className="rounded-xl bg-muted/40 p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]"
              >
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={cn(sev.className)}>
                    {sev.label}
                  </Badge>
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

      {governance.omittedComponents.length > 0 ? (
        <Eyebrowed eyebrow="Componentes situacionais">
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
          <p className="mt-2 text-pretty text-sm text-muted-foreground">
            Avalie se algum destes componentes se aplica ao seu processo antes
            de declarar o orçamento de incerteza.
          </p>
        </Eyebrowed>
      ) : null}

      <Eyebrowed eyebrow="Fontes">
        <ul className="space-y-1.5">
          {governance.sources.map((source) => (
            <li
              key={`${source.title}-${source.edition}`}
              className="flex items-baseline justify-between gap-3 text-sm"
            >
              <span className="min-w-0">
                <span className="font-medium">{source.title}</span>{' '}
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {source.edition}
                </span>
                {source.section ? (
                  <span className="text-muted-foreground">
                    {' '}
                    · {source.section}
                  </span>
                ) : null}
              </span>
              {source.url ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Abrir ${source.title} em PDF`}
                  className="shrink-0 font-mono text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  PDF ↗
                </a>
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

      {governance.workedExample ? (
        <Eyebrowed eyebrow="Exemplo verificado">
          <div className="flex flex-wrap items-center gap-2">
            {governance.workedExample.provenance === 'cited_guide_table' ? (
              <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                Reproduz o guia
              </Badge>
            ) : (
              <Badge variant="outline">Verificação interna do motor</Badge>
            )}
            <span className="text-sm text-muted-foreground">
              {governance.workedExample.source}
            </span>
          </div>
          {governance.workedExample.provenance !== 'cited_guide_table' ? (
            <p className="mt-1 text-pretty text-xs text-muted-foreground">
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
