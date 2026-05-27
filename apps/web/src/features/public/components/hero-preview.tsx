import { Reveal } from './reveal'

/**
 * Full-bleed screenshot of the dashboard, framed as a macOS window.
 *
 * Sits directly under the hero. Tilts back at rest (subtle perspective on
 * rotateX) and flattens on hover — a "rises to meet you" interaction borrowed
 * from t3.codes. Uses design-system surfaces (`bg-card`, `border-border`)
 * rather than a black slab so the frame belongs to the rest of the landing.
 */
export function HeroPreview() {
  return (
    <section
      aria-label="Pré-visualização do painel do CalibraFácil"
      className="relative isolate -mt-6 pb-24 md:-mt-10 md:pb-28"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/4 mx-auto h-[420px] max-w-[1100px] bg-[radial-gradient(ellipse_70%_55%_at_50%_50%,color-mix(in_oklch,var(--primary)_10%,transparent),transparent_70%)]"
      />

      <div className="relative mx-auto max-w-[1200px] px-6 md:px-8">
        <Reveal delay={0.16}>
          <div
            className="group/preview mx-auto w-full transition-transform duration-[600ms] ease-[ease] [transform:perspective(2000px)_rotateX(-2deg)] hover:[transform:perspective(2000px)_rotateX(0deg)] motion-reduce:transform-none motion-reduce:transition-none"
          >
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/10 ring-1 ring-black/[0.04] dark:shadow-black/40 dark:ring-white/[0.04]">
              <div className="flex items-center gap-3 border-b border-border/80 bg-background/60 px-4 py-3 backdrop-blur-sm">
                <div className="flex shrink-0 gap-1.5" aria-hidden>
                  <span className="size-3 rounded-full bg-[#ff5f57] ring-1 ring-inset ring-black/10" />
                  <span className="size-3 rounded-full bg-[#febc2e] ring-1 ring-inset ring-black/10" />
                  <span className="size-3 rounded-full bg-[#28c840] ring-1 ring-inset ring-black/10" />
                </div>

                <div className="hidden flex-1 justify-center sm:flex">
                  <span className="rounded-md bg-muted/60 px-3 py-1 font-mono text-xs text-muted-foreground">
                    calibrafacil.com/dashboard
                  </span>
                </div>

                <span aria-hidden className="hidden shrink-0 sm:block sm:w-[54px]" />
              </div>

              <img
                src="/hero-preview.png"
                alt="Painel do CalibraFácil com indicadores de calibração, fila de ordens de serviço e tendência de aprovações."
                width={3394}
                height={2146}
                loading="eager"
                decoding="async"
                draggable={false}
                className="block w-full select-none"
              />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
