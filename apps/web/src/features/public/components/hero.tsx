import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight01Icon,
  BookOpen01Icon,
  CloudIcon,
  CustomerSupportIcon,
  DocumentValidationIcon,
  SecurityCheckIcon,
  UserIcon,
} from '@hugeicons/core-free-icons'

import { BrandMark } from '@/components/brand'
import { Button } from '@/components/ui/button'

const DEMO_URL = 'https://cal.com/calibrafacil/30min?user=calibrafacil'
const DOCS_URL = 'https://docs.calibrafacil.com'

const heroMeta = [
  { icon: SecurityCheckIcon, label: 'Trilha de auditoria nativa' },
  { icon: CloudIcon, label: 'Dados no Brasil, em conformidade com a LGPD' },
  { icon: CustomerSupportIcon, label: 'Suporte em português' },
]

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden pt-20 pb-24">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-50 -right-60 size-[720px] rounded-full bg-[color-mix(in_oklch,var(--primary)_14%,transparent)] blur-[140px]"
      />
      <BlueprintGrid />

      <div className="relative z-[1] mx-auto max-w-[1200px] px-6 md:px-8">
        <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16">
          <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700">
            <h1 className="text-[clamp(40px,5.4vw,68px)] leading-[1.02] font-semibold tracking-tight text-balance text-foreground">
              Da OS ao certificado,
              <br />
              <span>com a auditoria já feita.</span>
            </h1>

            <p className="mt-5 max-w-[56ch] text-lg leading-relaxed text-pretty text-muted-foreground">
              Para parar de perder dias montando documentação antes da
              auditoria. Para padronizar o cálculo de incerteza entre todos os
              técnicos. Para o cliente baixar o certificado sem precisar te
              ligar. Tudo em um único sistema.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <Button
                size="lg"
                render={
                  <a
                    href={DEMO_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                Agendar demonstração
                <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                render={
                  <a
                    href={DOCS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                <HugeiconsIcon icon={BookOpen01Icon} data-icon="inline-start" />
                Ver documentação técnica
              </Button>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-3 text-xs text-muted-foreground">
              {heroMeta.map((item, index) => (
                <div key={item.label} className="flex items-center gap-3">
                  {index > 0 && (
                    <span className="size-1 rounded-full bg-foreground/30" />
                  )}
                  <span className="flex items-center gap-1.5">
                    <HugeiconsIcon
                      icon={item.icon}
                      className="size-3.5 text-emerald-500"
                    />
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 motion-safe:[animation-delay:120ms] motion-safe:fill-mode-backwards">
            <GumMemorialCard />
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * Static preview of the "memorial de incerteza" screen. Math is correct
 * (u_c = sqrt(sum(u_i^2)), U = k·u_c, k=2); values are illustrative. No live
 * sliders — it's a preview of the screen, not a working calculator.
 */
function GumMemorialCard() {
  const components = [
    { id: 'rep', label: 'Repetibilidade', type: 'A · Normal', uMg: 1.2 },
    { id: 'res', label: 'Resolução', type: 'B · Retangular', uMg: 0.3 },
    { id: 'pad', label: 'Padrão de referência', type: 'B · Normal', uMg: 0.5 },
    { id: 'der', label: 'Deriva temporal', type: 'B · Retangular', uMg: 0.4 },
  ]

  const uCombinedMg = Math.sqrt(
    components.reduce((sum, c) => sum + c.uMg * c.uMg, 0),
  )
  const expandedG = (2 * uCombinedMg) / 1000

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
      <div className="flex items-center gap-2.5 border-b border-border/80 bg-background/50 px-4 py-3">
        <span className="size-2 rounded-full bg-foreground/20" />
        <span className="size-2 rounded-full bg-foreground/20" />
        <span className="size-2 rounded-full bg-foreground/20" />
        <span className="flex-1 text-center font-mono text-xs text-muted-foreground">
          /calibracao/CAL-2026-0231 · memorial de incerteza
        </span>
      </div>

      <div className="p-6">
        <div className="flex items-start justify-between gap-4 border-b border-dashed border-border pb-4">
          <div className="flex items-center gap-3">
            <BrandMark alt="" aria-hidden className="size-5" />
            <div>
              <div className="text-sm font-semibold">Memorial de incerteza</div>
              <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                CAL-2026-0231 · Balança analítica AS-220 · ponto 100,000 g
              </div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/15 px-2.5 py-1 font-mono text-xs font-medium tracking-wide text-amber-500 uppercase">
            <span className="size-1.5 rounded-full bg-current shadow-[0_0_0_3px_color-mix(in_oklch,currentColor_14%,transparent)]" />
            Em Revisão
          </span>
        </div>

        <table className="mt-4 w-full font-mono text-xs">
          <thead>
            <tr>
              <th className="border-b border-border/60 py-2 text-left text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Componente
              </th>
              <th className="border-b border-border/60 py-2 text-left text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Distribuição
              </th>
              <th className="border-b border-border/60 py-2 text-right text-xs font-medium tracking-wider text-muted-foreground uppercase">
                u (mg)
              </th>
            </tr>
          </thead>
          <tbody>
            {components.map((c) => (
              <tr key={c.id}>
                <td className="border-b border-border/40 py-2.5 text-muted-foreground">
                  {c.label}
                </td>
                <td className="border-b border-border/40 py-2.5 text-xs text-muted-foreground">
                  {c.type}
                </td>
                <td className="border-b border-border/40 py-2.5 text-right tabular-nums">
                  {c.uMg.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-2 flex items-baseline justify-between border-t border-dashed border-border pt-4 pb-1">
          <span className="font-mono text-xs tracking-wide text-muted-foreground">
            u<sub>c</sub> = {uCombinedMg.toFixed(3)} mg
            <span className="ml-3.5 opacity-60">composição quadrática</span>
          </span>
          <span className="font-mono text-lg font-semibold tabular-nums">
            U = ± {expandedG.toFixed(4)} g
            <span className="ml-1.5 text-xs text-primary">k = 2</span>
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-border pt-3.5 font-mono text-xs tracking-wide text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <HugeiconsIcon
              icon={DocumentValidationIcon}
              className="size-3 text-muted-foreground"
            />
            JCGM 100:2008 (GUM)
          </span>
          <span className="flex items-center gap-1.5">
            <HugeiconsIcon
              icon={UserIcon}
              className="size-3 text-muted-foreground"
            />
            autor: Carlos M. · aguarda Patrícia M.
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * Blueprint grid backdrop — hairline grid masked to a soft ellipse.
 * Shared by the hero and closing CTA.
 */
export function BlueprintGrid({ fine = false }: { fine?: boolean }) {
  return (
    <div
      aria-hidden
      className={
        fine
          ? 'pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,color-mix(in_oklch,var(--foreground)_6%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklch,var(--foreground)_6%,transparent)_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_60%_40%_at_50%_50%,black_30%,transparent_80%)]'
          : 'pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,color-mix(in_oklch,var(--foreground)_6%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklch,var(--foreground)_6%,transparent)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_80%_60%_at_50%_30%,black_30%,transparent_75%)]'
      }
    />
  )
}
