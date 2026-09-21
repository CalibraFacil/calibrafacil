"use client";

import { useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  CreditCardIcon,
  Invoice01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";

import { PixIcon } from "@/components/payment-brand-icons";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics/track";
import {
  formatBRL,
  PRICING_FAQ,
  PRICING_TIERS,
  type PricingTier,
} from "@/lib/pricing";
import { DEMO_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

import { usePlanIntent } from "./plan-intent";
import { SectionHeading } from "./surfaces";
import { TrackedLink } from "./tracked-link";

type Cycle = "yearly" | "monthly";

export function PricingSection() {
  const [cycle, setCycle] = useState<Cycle>("yearly");

  return (
    <section
      id="planos"
      className="scroll-mt-20 border-t border-border py-24 md:py-32"
    >
      <div className="mx-auto max-w-[1200px] px-6 md:px-8">
        {/* No standfirst: it said the headline's point again ("um valor por
            CNPJ, com a equipe inteira dentro") and the box below's point again
            ("os planos separam o tamanho da operação, não a norma"). */}
        <SectionHeading
          center
          title="Preço por laboratório, não por usuário."
        />

        <CycleToggle cycle={cycle} onChange={setCycle} />

        <div className="mt-8 grid items-stretch gap-4 md:grid-cols-2 lg:grid-cols-4">
          {PRICING_TIERS.map((tier) => (
            <TierCard key={tier.id} tier={tier} cycle={cycle} />
          ))}
        </div>

        <p className="mx-auto mt-8 max-w-[640px] text-center text-[13px] leading-relaxed text-muted-foreground">
          No plano anual você paga dez mensalidades: dois meses ficam por nossa
          conta. O mensal existe para quem prefere entrar sem compromisso de
          doze meses, sem prazo mínimo e sem multa.
        </p>

        {/* These used to be bundled into the top tier, so a customer paid for
            a one-time service every year and only labs needing that tier's
            volume could buy it at all. They are one-off now. Escala still
            includes implantação and migração, per SUPPORT_POLICIES.ADVANCED,
            so the disclaimer has to say which plan it is talking about. */}
        <p className="mx-auto mt-3 max-w-[640px] text-center text-[13px] leading-relaxed text-muted-foreground">
          No Essencial e no Profissional, implantação assistida e migração dos
          seus dados são contratadas à parte, uma única vez. No Escala já vêm
          incluídas. O dossiê de validação do motor de cálculo é sempre
          contratado à parte, em qualquer plano.
        </p>

        <DemoBanner />

        <Faq />
      </div>
    </section>
  );
}

function CycleToggle({
  cycle,
  onChange,
}: {
  cycle: Cycle;
  onChange: (next: Cycle) => void;
}) {
  const select = (next: Cycle) => {
    onChange(next);
    track("pricing_cycle_change", { cycle: next });
  };

  return (
    <div className="mt-12 flex flex-col items-center gap-2.5">
      <div
        role="group"
        aria-label="Ciclo de cobrança"
        className="inline-flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-[0_1px_2px_rgba(15,23,42,0.05)]"
      >
        <CycleOption
          selected={cycle === "yearly"}
          onSelect={() => select("yearly")}
        >
          Anual
          <span
            className={cn(
              "ml-1.5 rounded-full px-1.5 py-px text-[11px] font-medium transition-colors",
              cycle === "yearly"
                ? "bg-white/20 text-white"
                : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-400",
            )}
          >
            2 meses grátis
          </span>
        </CycleOption>
        <CycleOption
          selected={cycle === "monthly"}
          onSelect={() => select("monthly")}
        >
          Mensal
        </CycleOption>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[12.5px] text-muted-foreground">
        <span>Sem fidelidade no mensal</span>
        <span aria-hidden>·</span>
        <ul
          aria-label="Formas de pagamento"
          className="flex items-center gap-3.5"
        >
          <li className="inline-flex items-center gap-1.5">
            <PixIcon className="size-6" />
            Pix
          </li>
          <li className="inline-flex items-center gap-1.5">
            <HugeiconsIcon icon={Invoice01Icon} className="size-4" />
            Boleto
          </li>
          <li className="inline-flex items-center gap-1.5">
            <HugeiconsIcon icon={CreditCardIcon} className="size-4" />
            Cartão
          </li>
        </ul>
      </div>
    </div>
  );
}

function CycleOption({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "inline-flex items-center rounded-full px-3.5 py-1.5 text-[13.5px] font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        selected
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function TierCard({ tier, cycle }: { tier: PricingTier; cycle: Cycle }) {
  const highlighted = tier.highlighted === true;

  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-2xl border bg-card p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        highlighted
          ? "border-indigo-600/25 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_24px_48px_-28px_rgba(79,70,229,0.5)] dark:border-indigo-400/25"
          : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-foreground">
          {tier.name}
        </h3>
        {highlighted ? (
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11.5px] font-medium text-indigo-700 ring-1 ring-indigo-600/15 ring-inset dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-400/20">
            Mais escolhido
          </span>
        ) : null}
      </div>

      <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
        {tier.audience}
      </p>

      <TierPrice tier={tier} cycle={cycle} />

      <TierCta tier={tier} cycle={cycle} highlighted={highlighted} />

      <p className="mt-5 rounded-lg bg-muted px-3 py-2 text-center font-mono text-[12px] tracking-[-0.01em] tabular-nums text-foreground">
        {tier.scale}
      </p>

      {tier.featuresIntro ? (
        <p className="mt-5 text-[12.5px] font-medium text-foreground">
          {tier.featuresIntro}
        </p>
      ) : null}
      {/* The base tier carries no intro, so its list opens the same distance
          from the scale line that an intro would have. */}
      <ul className={cn("grid gap-2.5", tier.featuresIntro ? "mt-3" : "mt-5")}>
        {tier.features.map((feature) => (
          <li
            key={feature}
            className="grid grid-cols-[16px_1fr] gap-2 text-[13px] leading-relaxed text-muted-foreground"
          >
            <HugeiconsIcon
              icon={Tick02Icon}
              className="mt-[3px] size-4 text-indigo-600 dark:text-indigo-400"
              strokeWidth={2.25}
            />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Price block, kept at one height so the CTAs line up across the row. */
function TierPrice({ tier, cycle }: { tier: PricingTier; cycle: Cycle }) {
  if (tier.price.kind === "quote") {
    return (
      <div className="mt-5 min-h-[82px]">
        <p className="text-[27px] leading-[1.1] font-semibold tracking-[-0.025em] text-foreground">
          Sob consulta
        </p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
          Escopo, número de unidades e migração definem o valor.
        </p>
      </div>
    );
  }

  const { yearlyMonthly, yearlyTotal, monthly } = tier.price;
  const amount = cycle === "yearly" ? yearlyMonthly : monthly;

  return (
    <div className="mt-5 min-h-[82px]">
      <p className="flex items-baseline gap-1.5">
        <span className="text-[34px] leading-[1.05] font-semibold tracking-[-0.03em] tabular-nums text-foreground">
          {formatBRL(amount)}
        </span>
        <span className="text-[14px] text-muted-foreground">/mês</span>
      </p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
        {cycle === "yearly"
          ? `${formatBRL(yearlyTotal)} por ano · ou ${formatBRL(monthly)}/mês no mensal`
          : `Cobrança mensal · ${formatBRL(yearlyMonthly)}/mês pagando o ano`}
      </p>
    </div>
  );
}

function TierCta({
  tier,
  cycle,
  highlighted,
}: {
  tier: PricingTier;
  cycle: Cycle;
  highlighted: boolean;
}) {
  const { setPlan } = usePlanIntent();
  // A published price should be buyable without a sales call — R$ 349 does not
  // pay for one. Only the quoted tier routes to the team.
  const selfServe = tier.planId !== undefined;
  // A bare fragment, not CONTACT_URL. This section only ever renders on the
  // landing page, and "/#contato" makes the browser navigate to the root
  // document: the plan just written to context is destroyed on the way, and the
  // lead form's "Plano de interesse" arrives blank. Scrolling in place keeps it.
  const href = selfServe
    ? `/sign-up?plano=${tier.planId}&ciclo=${cycle === "yearly" ? "YEARLY" : "MONTHLY"}`
    : "#contato";

  return (
    <Button
      variant={highlighted ? "default" : "outline"}
      className={cn(
        "mt-6 w-full",
        highlighted &&
          "bg-[linear-gradient(180deg,#5b53ea_0%,#4f46e5_45%,#3f3ad6_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_1px_2px_rgba(20,71,230,0.35),0_8px_20px_-8px_rgba(79,70,229,0.5)] hover:brightness-[1.06]",
      )}
      render={
        <TrackedLink
          href={href}
          event="pricing_cta_click"
          params={{ plan: tier.id, cycle, location: "pricing", selfServe }}
          onClick={() => setPlan(tier.name)}
        />
      }
    >
      {selfServe ? "Criar conta" : "Falar com vendas"}
      <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
    </Button>
  );
}

function DemoBanner() {
  return (
    <div className="mt-10 flex flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card px-6 py-5 text-center sm:flex-row sm:text-left">
      <p className="text-[14.5px] leading-relaxed text-foreground">
        Prefere ver funcionando antes de escolher?{" "}
        <span className="text-muted-foreground">
          A demonstração é sobre a sua operação, não um tour genérico. Os
          horários são aos sábados e à noite, em número limitado.
        </span>
      </p>
      <Button
        variant="outline"
        className="shrink-0"
        render={
          <TrackedLink
            href={DEMO_URL}
            event="demo_click"
            params={{ location: "pricing" }}
            external
          />
        }
      >
        Agendar demonstração
      </Button>
    </div>
  );
}

function Faq() {
  return (
    <div className="mt-16">
      <h3 className="text-center text-[20px] font-semibold tracking-[-0.02em] text-foreground">
        Perguntas sobre preço
      </h3>
      <dl className="mx-auto mt-8 grid max-w-[980px] gap-x-10 gap-y-7 md:grid-cols-2">
        {PRICING_FAQ.map((item) => (
          <div key={item.question}>
            <dt className="text-[14.5px] font-medium text-foreground">
              {item.question}
            </dt>
            <dd className="mt-1.5 text-[13.5px] leading-relaxed text-pretty text-muted-foreground">
              {item.answer}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
