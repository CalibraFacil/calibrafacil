import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { REPOSITORY_URL, RUN_LOCALLY_URL } from "@/lib/site";

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
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

      <div className="mx-auto max-w-[1200px] px-6 pt-20 md:px-8 md:pt-28">
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

/** The product, framed once and dissolving into the page. */
function HeroVisual() {
  return (
    <div className="mx-auto mt-14 max-w-[1120px] motion-safe:animate-hero-rise motion-safe:[animation-delay:180ms] md:mt-20">
      <div className="relative mx-auto aspect-[390/844] max-w-[430px] overflow-hidden rounded-t-2xl border border-b-0 border-border bg-card shadow-[0_0_0_1px_rgba(255,255,255,0.6)_inset,0_2px_6px_rgba(15,23,42,0.04),0_40px_80px_-32px_rgba(15,23,42,0.28)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset,0_40px_80px_-32px_rgba(0,0,0,0.7)] [mask-image:linear-gradient(180deg,#000_62%,transparent_100%)] md:aspect-auto md:h-[560px] md:max-w-none">
        <picture className="block dark:hidden">
          <source
            media="(max-width: 767px)"
            srcSet="/dashboard-preview-mobile-light.png"
            width={780}
            height={1688}
          />
          <img
            src="/dashboard-preview-light.png"
            alt="Painel do CalibraFácil com indicadores da operação, pipeline de calibração por etapa e fila de calibrações a vencer."
            width={3420}
            height={2146}
            fetchPriority="high"
            draggable={false}
            className="block h-auto w-full select-none"
          />
        </picture>
        <picture className="hidden dark:block">
          <source
            media="(max-width: 767px)"
            srcSet="/dashboard-preview-mobile-dark.png"
            width={780}
            height={1688}
          />
          <img
            src="/dashboard-preview-dark.png"
            alt="Painel do CalibraFácil com indicadores da operação, pipeline de calibração por etapa e fila de calibrações a vencer."
            width={3420}
            height={2146}
            loading="lazy"
            draggable={false}
            className="block h-auto w-full select-none"
          />
        </picture>
      </div>
    </div>
  );
}
