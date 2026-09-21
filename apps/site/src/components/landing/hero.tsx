import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { CONTACT_URL, DEMO_URL } from "@/lib/site";

import { TrackedLink } from "./tracked-link";

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
            Calibração, incerteza e certificado no mesmo registro.
          </h1>
          <p className="mx-auto mt-6 max-w-[60ch] text-[17px] leading-relaxed text-pretty text-muted-foreground motion-safe:animate-hero-rise motion-safe:[animation-delay:60ms] md:text-lg">
            O CalibraFácil acompanha cada calibração do cadastro do equipamento
            à aprovação do certificado, com cálculo de incerteza, assinatura
            ICP-Brasil e portal do cliente. Feito para laboratórios sob a
            ISO/IEC 17025, acreditados ou em implantação.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 motion-safe:animate-hero-rise motion-safe:[animation-delay:120ms]">
            <Button
              size="lg"
              className="bg-[linear-gradient(180deg,#5b53ea_0%,#4f46e5_45%,#3f3ad6_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_1px_2px_rgba(20,71,230,0.35),0_8px_20px_-8px_rgba(79,70,229,0.5)] hover:brightness-[1.06]"
              render={
                <TrackedLink
                  href={CONTACT_URL}
                  event="lead_cta_click"
                  params={{ location: "hero" }}
                />
              }
            >
              Falar com a equipe
              <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
              render={
                <TrackedLink
                  href={DEMO_URL}
                  event="demo_click"
                  params={{ location: "hero" }}
                  external
                />
              }
            >
              Agendar demonstração
            </Button>
          </div>
        </div>

        <HeroVisual />
      </div>
    </section>
  );
}

/**
 * The product, framed once and dissolving into the page, with two real
 * moments of a calibration floating over it: the approved certificate and
 * the expanded uncertainty behind it.
 */
function HeroVisual() {
  return (
    <div className="relative mx-auto mt-14 max-w-[1120px] motion-safe:animate-hero-rise motion-safe:[animation-delay:180ms] md:mt-20">
      <div className="relative mx-auto aspect-[390/844] max-w-[430px] overflow-hidden rounded-t-2xl border border-b-0 border-border bg-card shadow-[0_0_0_1px_rgba(255,255,255,0.6)_inset,0_2px_6px_rgba(15,23,42,0.04),0_40px_80px_-32px_rgba(15,23,42,0.28)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset,0_40px_80px_-32px_rgba(0,0,0,0.7)] [mask-image:linear-gradient(180deg,#000_62%,transparent_100%)] md:aspect-auto md:h-[560px] md:max-w-none">
        <picture className="block dark:hidden">
          <source
            media="(max-width: 767px)"
            srcSet="/dashboard-preview-mobile-light.png"
            width={780}
            height={1688}
          />
          <Image
            src="/dashboard-preview-light.png"
            alt="Painel do CalibraFácil com indicadores da operação, pipeline de calibração por etapa e fila de calibrações a vencer."
            width={3420}
            height={2146}
            priority
            sizes="(min-width: 1200px) 1120px, 100vw"
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
          <Image
            src="/dashboard-preview-dark.png"
            alt="Painel do CalibraFácil com indicadores da operação, pipeline de calibração por etapa e fila de calibrações a vencer."
            width={3420}
            height={2146}
            sizes="(min-width: 1200px) 1120px, 100vw"
            draggable={false}
            className="block h-auto w-full select-none"
          />
        </picture>
      </div>

      <CertificateCard className="absolute bottom-6 left-0 hidden w-[300px] md:block lg:-left-6" />
      <UncertaintyCard className="absolute top-10 right-0 hidden w-[288px] md:block lg:-right-6" />

      {/* Below md the two cards sit under the frame instead of over it. */}
      <div className="mt-4 grid gap-3 md:hidden">
        <CertificateCard />
        <UncertaintyCard />
      </div>
    </div>
  );
}

const floating =
  "rounded-xl border border-border bg-card/95 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_20px_40px_-16px_rgba(15,23,42,0.28)] backdrop-blur-sm";

function CertificateCard({ className = "" }: { className?: string }) {
  return (
    <div className={`${floating} ${className}`}>
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/12 px-2 py-0.5 text-[12px] font-medium text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-600/15 dark:ring-emerald-400/20 ring-inset">
          <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
          Aprovado
        </span>
        <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
          CAL-2026-0231
        </span>
      </div>
      <div className="px-4 pt-2.5 pb-3.5">
        <p className="text-[14px] font-medium text-foreground">
          Balança analítica{" "}
          <span className="font-normal text-muted-foreground">· BAL-07</span>
        </p>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          Certificado assinado com ICP-Brasil A1 · 14/08/2026
        </p>
        <div className="mt-3 flex items-center gap-2.5 border-t border-border pt-3">
          <span
            aria-hidden
            className="flex size-6 items-center justify-center rounded-full bg-[linear-gradient(135deg,#4f46e5,#1447e6)] text-[10px] font-semibold text-white"
          >
            CM
          </span>
          <span className="text-[12.5px] text-foreground">
            Carla Menezes{" "}
            <span className="text-muted-foreground">· Responsável técnica</span>
          </span>
        </div>
      </div>
    </div>
  );
}

const BUDGET = [
  ["Repetibilidade", 100],
  ["Resolução", 40],
  ["Excentricidade", 60],
  ["Padrão", 30],
  ["Deriva", 12],
  ["Empuxo", 10],
] as const;

function UncertaintyCard({ className = "" }: { className?: string }) {
  return (
    <div className={`${floating} ${className}`}>
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
        <span className="text-[12.5px] font-medium text-foreground">
          Incerteza expandida{" "}
          <span className="font-normal text-muted-foreground">· 200 g</span>
        </span>
        <span className="text-[11.5px] text-muted-foreground">GUM</span>
      </div>
      <div className="px-4 pt-2 pb-4">
        <div className="flex items-baseline gap-3">
          <span className="text-[26px] font-semibold tracking-[-0.02em] tabular-nums text-foreground">
            U = 0,25 mg
          </span>
          <span className="text-[13px] tabular-nums text-muted-foreground">
            k = 2,00
          </span>
        </div>
        <ul
          className="mt-3 grid gap-1.5"
          aria-label="Contribuições do orçamento de incerteza"
        >
          {BUDGET.map(([label, value]) => (
            <li
              key={label}
              className="grid grid-cols-[92px_1fr] items-center gap-2 text-[11.5px] text-muted-foreground"
            >
              <span className="truncate">{label}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-border">
                <span
                  className="block h-full rounded-full bg-[linear-gradient(90deg,#4f46e5,#1447e6)]"
                  style={{ width: `${value}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
