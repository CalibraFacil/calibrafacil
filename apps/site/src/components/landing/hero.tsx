import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { REPOSITORY_URL, RUN_LOCALLY_URL } from "@/lib/site";

export function Hero() {
  return (
    <section className="relative isolate overflow-x-clip">
      {/* Soft brand tint at the top, nothing else behind the content. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[720px] bg-[radial-gradient(56%_60%_at_50%_0%,color-mix(in_oklch,var(--primary)_9%,transparent),transparent_72%)]"
      />
      {/* A dot grid over the tint, masked to an ellipse so it dies out well
          before it reaches the product shot and never competes with it. The
          dots are mixed off --foreground, so the same rule reads in both
          themes; dark needs the lighter mix to stay at the same weight. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[720px] [background-image:radial-gradient(color-mix(in_oklch,var(--foreground)_13%,transparent)_1px,transparent_1px)] [background-size:28px_28px] [mask-image:radial-gradient(ellipse_68%_58%_at_50%_26%,#000_26%,transparent_100%)] dark:[background-image:radial-gradient(color-mix(in_oklch,var(--foreground)_9%,transparent)_1px,transparent_1px)]"
      />

      <div className="mx-auto max-w-[1200px] px-6 pt-20 pb-6 md:px-8 md:pt-28 md:pb-10">
        <div className="mx-auto max-w-[820px] text-center">
          <h1 className="text-[clamp(38px,5.6vw,66px)] leading-[1.04] font-semibold tracking-[-0.032em] text-balance text-foreground motion-safe:animate-hero-rise">
            Gestão de laboratório de calibração, em código aberto.
          </h1>
          <p className="mx-auto mt-6 max-w-[60ch] text-[17px] leading-relaxed text-pretty text-muted-foreground motion-safe:animate-hero-rise motion-safe:[animation-delay:60ms] md:text-lg">
            O CalibraFácil acompanha cada calibração do cadastro do equipamento
            ao certificado assinado em ICP-Brasil, com incerteza calculada
            conforme o GUM, portal do cliente e um aplicativo desktop que
            funciona offline. Licença MIT, feito para laboratórios sob a ISO/IEC
            17025 e mantido pela comunidade.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 motion-safe:animate-hero-rise motion-safe:[animation-delay:120ms]">
            <Button
              size="lg"
              className="bg-[linear-gradient(180deg,#5b53ea_0%,#4f46e5_45%,#3f3ad6_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_1px_2px_rgba(20,71,230,0.35),0_8px_20px_-8px_rgba(79,70,229,0.5)] hover:brightness-[1.06]"
              render={
                <a
                  href={REPOSITORY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              Ver no GitHub
              <HugeiconsIcon icon={ArrowUpRight01Icon} data-icon="inline-end" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
              render={<a href={RUN_LOCALLY_URL} />}
            >
              Rodar localmente
            </Button>
          </div>
        </div>

        <HeroVisual />
      </div>
    </section>
  );
}

/**
 * The product, whole: the full dashboard as a window, lit from above and set
 * in a glass bezel. The bezel's corners nest around the screen's, and the
 * screen's around the app's own inset panel, so every radius is concentric.
 */
function HeroVisual() {
  return (
    <div className="relative mx-auto mt-14 max-w-[1120px] md:mt-20">
      {/* Light falling on the window from above, so the shot reads as lit
          rather than pasted on. It arrives a beat after the window. */}
      <div aria-hidden className="product-glow motion-safe:animate-hero-glow" />

      <div className="product-bezel mx-auto max-w-[360px] motion-safe:animate-hero-settle md:max-w-none">
        <div className="product-screen">
          {/* One request: the browser picks the theme and the form factor. */}
          <picture>
            <source
              media="(max-width: 767px) and (prefers-color-scheme: dark)"
              srcSet="/dashboard-preview-mobile-dark.png"
              width={780}
              height={1520}
            />
            <source
              media="(max-width: 767px)"
              srcSet="/dashboard-preview-mobile-light.png"
              width={780}
              height={1520}
            />
            <source
              media="(prefers-color-scheme: dark)"
              srcSet="/dashboard-preview-dark.png"
              width={3200}
              height={2210}
            />
            <img
              src="/dashboard-preview-light.png"
              alt="Painel do CalibraFácil: calibrações em aberto por etapa, fila de trabalho, saúde do laboratório, aprovações por dia e padrões a vencer."
              width={3200}
              height={2210}
              fetchPriority="high"
              draggable={false}
              className="block h-auto w-full select-none"
            />
          </picture>
        </div>
      </div>
    </div>
  );
}
