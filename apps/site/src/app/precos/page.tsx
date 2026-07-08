import type { Metadata } from "next";
import {
  ENTITLEMENT_METADATA,
  FEATURE_FLAGS,
  PLANS,
  PLAN_PRICES,
  formatPrice,
  hasEntitlement,
  type PlanId,
} from "@calibra-facil/shared";

import { CONTACT_URL, absoluteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Preços",
  description:
    "Planos do CalibraFácil para laboratórios de calibração e oficinas: cálculo de incerteza GUM, portal do cliente, assinatura ICP-Brasil e certificados ISO/IEC 17025. Veja preços e recursos por plano.",
  alternates: { canonical: absoluteUrl("/precos") },
  openGraph: {
    title: "Preços — CalibraFácil",
    description:
      "Planos para laboratórios acreditados e oficinas permissionárias do Inmetro.",
    url: absoluteUrl("/precos"),
  },
};

const ORDER: PlanId[] = ["FREE", "STANDARD", "PROFESSIONAL", "ENTERPRISE"];
const PAID_PLANS: Exclude<PlanId, "FREE">[] = [
  "STANDARD",
  "PROFESSIONAL",
  "ENTERPRISE",
];

function priceLabel(id: PlanId) {
  if (id === "FREE") return "Gratuito";
  if (id === "ENTERPRISE") return formatPrice(PLAN_PRICES.ENTERPRISE.monthly);
  if (id === "STANDARD") return formatPrice(PLAN_PRICES.STANDARD.monthly);
  return formatPrice(PLAN_PRICES.PROFESSIONAL.monthly);
}

function enabledFeatureNames(id: PlanId): string[] {
  return FEATURE_FLAGS.filter((flag) => hasEntitlement(id, flag)).map(
    (flag) => ENTITLEMENT_METADATA[flag].name,
  );
}

function Check() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="mt-0.5 size-4 shrink-0 text-primary"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

const pricingJsonLd = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "CalibraFácil",
  description:
    "Software de gestão para laboratórios de calibração e oficinas permissionárias do Inmetro.",
  brand: { "@type": "Brand", name: "CalibraFácil" },
  offers: PAID_PLANS.map((id) => ({
    "@type": "Offer",
    name: PLANS[id].name,
    price: (PLAN_PRICES[id].monthly / 100).toFixed(2),
    priceCurrency: "BRL",
    url: absoluteUrl("/precos"),
  })),
};

export default function PrecosPage() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pricingJsonLd) }}
      />
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Planos para laboratórios de calibração e oficinas
        </h1>
        <p className="mt-4 text-lg text-muted-foreground text-pretty">
          Cálculo de incerteza conforme o GUM, portal do cliente e certificados
          ISO/IEC 17025 — do plano de avaliação ao multiunidade. Contratação
          assistida pela nossa equipe.
        </p>
      </div>

      <div className="mt-14 grid gap-6 lg:grid-cols-4">
        {ORDER.map((id) => {
          const plan = PLANS[id];
          const popular = plan.isPopular === true;
          const features = enabledFeatureNames(id);
          return (
            <div
              key={id}
              className={`flex flex-col rounded-2xl border p-6 ${
                popular
                  ? "border-primary shadow-lg shadow-primary/10"
                  : "border-border"
              }`}
            >
              {popular ? (
                <span className="mb-3 w-fit rounded-full bg-primary/10 px-2.5 py-1 font-mono text-xs font-medium text-primary uppercase">
                  Recomendado
                </span>
              ) : null}
              <h2 className="text-lg font-semibold tracking-tight">
                {plan.name}
              </h2>
              <p className="mt-1 min-h-10 text-sm text-muted-foreground">
                {plan.description}
              </p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="font-mono text-3xl font-semibold tracking-tight">
                  {priceLabel(id)}
                </span>
                {id !== "FREE" ? (
                  <span className="text-sm text-muted-foreground">/mês</span>
                ) : null}
              </div>

              <a
                href={CONTACT_URL}
                className={`mt-6 rounded-lg px-4 py-2.5 text-center text-sm font-medium transition-opacity hover:opacity-90 ${
                  popular
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-foreground"
                }`}
              >
                {id === "ENTERPRISE"
                  ? "Falar com vendas"
                  : "Solicitar proposta"}
              </a>

              <ul className="mt-6 grid gap-2.5 text-sm">
                <li className="flex gap-2">
                  <Check />
                  {plan.limits.certificates >= 999999
                    ? "Certificados ilimitados"
                    : `${plan.limits.certificates} certificados/mês`}
                </li>
                <li className="flex gap-2">
                  <Check />
                  {plan.limits.users >= 999
                    ? "Usuários ilimitados"
                    : `${plan.limits.users} usuário(s)`}
                </li>
                {features.map((name) => (
                  <li key={name} className="flex gap-2">
                    <Check />
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="mt-10 text-center text-sm text-muted-foreground">
        Precisa de algo específico?{" "}
        <a href={CONTACT_URL} className="font-medium text-foreground underline">
          Fale com um especialista
        </a>
        .
      </p>
    </section>
  );
}
