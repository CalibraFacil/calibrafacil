import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight01Icon,
  BookOpen01Icon,
  Certificate01Icon,
  DocumentValidationIcon,
  Link01Icon,
  SecurityCheckIcon,
} from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'

const DEMO_URL = 'https://cal.com/calibrafacil/30min?user=calibrafacil'
const DOCS_URL = 'https://docs.calibrafacil.com'

const heroMeta = [
  {
    icon: DocumentValidationIcon,
    label: 'Cálculo de incerteza conforme o GUM',
  },
  { icon: Certificate01Icon, label: 'Assinatura ICP-Brasil A1 nativa' },
  { icon: SecurityCheckIcon, label: 'Trilha de auditoria nativa' },
  { icon: Link01Icon, label: 'Rastreabilidade ponta a ponta' },
]

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden pt-20 pb-16 md:pb-20">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-50 -right-60 size-[720px] rounded-full bg-[color-mix(in_oklch,var(--primary)_14%,transparent)] blur-[140px]"
      />
      <BlueprintGrid />

      <div className="relative z-[1] mx-auto max-w-[900px] px-6 text-center md:px-8">
        <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700">
          <h1 className="text-[clamp(40px,5.4vw,68px)] leading-[1.02] font-semibold tracking-tight text-balance text-foreground">
            Da OS ao certificado,
            <br />
            <span>com a auditoria já feita.</span>
          </h1>

          <p className="mx-auto mt-5 max-w-[56ch] text-lg leading-relaxed text-pretty text-muted-foreground">
            Cada calibração já sai rastreável — orçamento de incerteza, padrões
            usados e signatário ligados ao certificado. Na aprovação, tudo
            congela numa versão que não muda mais: a evidência que o avaliador
            pede já está pronta.
          </p>

          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Button
              size="lg"
              render={
                <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" />
              }
            >
              Agendar demonstração
              <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              render={
                <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" />
              }
            >
              <HugeiconsIcon icon={BookOpen01Icon} data-icon="inline-start" />
              Ver documentação técnica
            </Button>
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-4 gap-y-3 text-xs text-muted-foreground">
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
      </div>
    </section>
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
