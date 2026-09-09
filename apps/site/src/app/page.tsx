import { Hero } from "@/components/landing/hero";
import { ProductSection } from "@/components/landing/product-section";
import { PortalSection } from "@/components/landing/portal-section";
import { CoverageSection } from "@/components/landing/coverage-section";
import { TrustSection } from "@/components/landing/trust-section";
import { VideoSection } from "@/components/landing/video-section";
import { PricingSection } from "@/components/landing/pricing-section";
import { PlanIntentProvider } from "@/components/landing/plan-intent";
import { LeadFormSection } from "@/components/landing/lead-form-section";
import { PRICING_FAQ, PRICING_TIERS } from "@/lib/pricing";
import { SITE_URL } from "@/lib/site";

const orgJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "CalibraFácil",
      url: SITE_URL,
      logo: `${SITE_URL}/logo-mark-light.svg`,
      description:
        "Software para laboratórios de calibração: cálculo de incerteza conforme o GUM, certificados com revisão e aprovação, assinatura ICP-Brasil e portal do cliente.",
    },
    {
      "@type": "SoftwareApplication",
      name: "CalibraFácil",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: SITE_URL,
      description:
        "Gestão de laboratórios de calibração sob a ISO/IEC 17025: clientes, equipamentos, calibrações, cálculo de incerteza, certificados, rastreabilidade, histórico e portal do cliente.",
      offers: PRICING_TIERS.flatMap((tier) =>
        tier.price.kind === "fixed"
          ? [
              {
                "@type": "Offer",
                name: tier.name,
                description: tier.audience,
                url: `${SITE_URL}/#planos`,
                priceCurrency: "BRL",
                price: tier.price.yearlyMonthly,
                priceSpecification: {
                  "@type": "UnitPriceSpecification",
                  priceCurrency: "BRL",
                  price: tier.price.yearlyMonthly,
                  unitCode: "MON",
                  billingDuration: 12,
                  billingIncrement: 1,
                  description:
                    "Mensalidade equivalente no plano anual, por laboratório.",
                },
              },
            ]
          : [],
      ),
    },
    {
      "@type": "FAQPage",
      mainEntity: PRICING_FAQ.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      })),
    },
  ],
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
      />
      <Hero />
      <ProductSection />
      <PortalSection />
      <CoverageSection />
      <TrustSection />
      <VideoSection />
      {/* One provider so a plan clicked in the table lands preselected in the
          form a few hundred pixels below it. */}
      <PlanIntentProvider>
        <PricingSection />
        <LeadFormSection />
      </PlanIntentProvider>
    </>
  );
}
