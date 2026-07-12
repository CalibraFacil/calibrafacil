import Image from "next/image";

import { Reveal } from "./reveal";

/**
 * Full-bleed screenshot of the dashboard, framed as a macOS window. Tilts back
 * at rest and flattens on hover. Uses design-system surfaces so the frame
 * belongs to the rest of the landing.
 *
 * Below `md` the macOS window is swapped for the dashboard captured on an
 * iPhone, composited into Apple's official iPhone 17 product bezel (white for
 * light mode, black for dark mode).
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
          <div className="group/preview mx-auto w-full transition-transform duration-[600ms] ease-[ease] [transform:perspective(2000px)_rotateX(-2deg)] hover:[transform:perspective(2000px)_rotateX(0deg)] motion-reduce:transform-none motion-reduce:transition-none">
            {/* Phone-framed variant for phones. The `1px` sizes entry keeps
                the off-breakpoint priority preload down to the smallest srcset
                candidate, so mobile and desktop each effectively preload only
                their own LCP image. */}
            <div className="md:hidden">
              <Image
                src="/hero-preview-mobile.png"
                alt="Painel do CalibraFácil no celular, com indicadores de calibração e fila de ordens de serviço."
                width={1311}
                height={2708}
                priority
                sizes="(min-width: 768px) 1px, 300px"
                draggable={false}
                className="mx-auto block h-auto w-[min(76vw,300px)] select-none dark:hidden"
              />
              <Image
                src="/hero-preview-mobile-dark.png"
                alt="Painel do CalibraFácil no celular, com indicadores de calibração e fila de ordens de serviço."
                width={1311}
                height={2708}
                sizes="(min-width: 768px) 1px, 300px"
                draggable={false}
                className="mx-auto hidden h-auto w-[min(76vw,300px)] select-none dark:block"
              />
            </div>

            <div className="hidden overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/10 ring-1 ring-black/[0.04] md:block dark:shadow-black/40 dark:ring-white/[0.04]">
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
                <span
                  aria-hidden
                  className="hidden shrink-0 sm:block sm:w-[54px]"
                />
              </div>

              {/* next/image serves resized WebP/AVIF (the source PNGs are
                  3420px wide). Only the theme-visible one is fetched: the light
                  image is the LCP so it is priority-preloaded; the dark one
                  loads lazily and never downloads in light mode (display:none →
                  no intersection). */}
              <Image
                src="/hero-preview.png"
                alt="Painel do CalibraFácil com indicadores de calibração, fila de ordens de serviço e tendência de aprovações."
                width={3420}
                height={2146}
                priority
                sizes="(max-width: 767px) 1px, (min-width: 1200px) 1136px, 100vw"
                draggable={false}
                className="block h-auto w-full select-none dark:hidden"
              />
              <Image
                src="/hero-preview-dark.png"
                alt="Painel do CalibraFácil com indicadores de calibração, fila de ordens de serviço e tendência de aprovações."
                width={3420}
                height={2146}
                sizes="(max-width: 767px) 1px, (min-width: 1200px) 1136px, 100vw"
                draggable={false}
                className="hidden h-auto w-full select-none dark:block"
              />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
