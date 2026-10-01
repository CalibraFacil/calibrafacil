import { Hero } from "@/components/landing/hero";
import { ProductSection } from "@/components/landing/product-section";
import { PortalSection } from "@/components/landing/portal-section";
import { CoverageSection } from "@/components/landing/coverage-section";
import { TrustSection } from "@/components/landing/trust-section";
import { VideoSection } from "@/components/landing/video-section";
import { OpenSourceSection } from "@/components/landing/open-source-section";
import { LICENSE_URL, REPOSITORY_URL, SITE_URL } from "@/lib/site";

const projectJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareSourceCode",
      name: "CalibraFácil",
      url: SITE_URL,
      codeRepository: REPOSITORY_URL,
      license: LICENSE_URL,
      programmingLanguage: "TypeScript",
      description:
        "Software de código aberto para laboratórios de calibração: cálculo de incerteza conforme o GUM, certificados com revisão e aprovação, assinatura ICP-Brasil e portal do cliente.",
    },
    {
      "@type": "SoftwareApplication",
      name: "CalibraFácil",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, Windows, macOS, Linux",
      url: SITE_URL,
      description:
        "Gestão de laboratórios de calibração sob a ISO/IEC 17025: clientes, equipamentos, calibrações, cálculo de incerteza, certificados, rastreabilidade, histórico e portal do cliente.",
      offers: {
        "@type": "Offer",
        price: 0,
        priceCurrency: "BRL",
      },
    },
  ],
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(projectJsonLd) }}
      />
      <Hero />
      <ProductSection />
      <PortalSection />
      <CoverageSection />
      <TrustSection />
      <VideoSection />
      <OpenSourceSection />
    </>
  );
}
