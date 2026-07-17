import { Hero } from "@/components/landing/hero";
import { HeroPreview } from "@/components/landing/hero-preview";
import { WorkflowSection } from "@/components/landing/workflow-section";
import { AudienceSection } from "@/components/landing/audience-section";
import { FeaturesSection } from "@/components/landing/features-section";
import { VideoSection } from "@/components/landing/video-section";
import { FAQSection } from "@/components/landing/faq-section";
import { LeadFormSection } from "@/components/landing/lead-form-section";
import { ClosingCTA } from "@/components/landing/closing-cta";
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
        "Software para laboratórios de calibração com cálculo de incerteza conforme o GUM e conformidade ISO/IEC 17025.",
    },
    {
      "@type": "SoftwareApplication",
      name: "CalibraFácil",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: SITE_URL,
      description:
        "Software para laboratórios de calibração e oficinas permissionárias do Inmetro: gestão de ordens de serviço, rastreabilidade metrológica e emissão automática de certificados.",
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
      <HeroPreview />
      <WorkflowSection />
      <AudienceSection />
      <FeaturesSection />
      <VideoSection />
      <FAQSection />
      <LeadFormSection />
      <ClosingCTA />
    </>
  );
}
