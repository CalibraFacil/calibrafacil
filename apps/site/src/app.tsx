import type { ReactNode } from "react";

import { ArchitectureSection } from "@/components/landing/architecture-section";
import { CoverageSection } from "@/components/landing/coverage-section";
import { Hero } from "@/components/landing/hero";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingNav } from "@/components/landing/landing-nav";
import { NotFound } from "@/components/landing/not-found";
import { OpenSourceSection } from "@/components/landing/open-source-section";
import { ProductSection } from "@/components/landing/product-section";
import { TrustSection } from "@/components/landing/trust-section";

function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-sm focus:text-background"
      >
        Ir para o conteúdo
      </a>
      <div className="min-h-screen overflow-x-clip bg-background text-foreground">
        <LandingNav />
        <main id="conteudo">{children}</main>
        <LandingFooter />
      </div>
    </>
  );
}

export function HomePage() {
  return (
    <Layout>
      <Hero />
      <ProductSection />
      <CoverageSection />
      <ArchitectureSection />
      <TrustSection />
      <OpenSourceSection />
    </Layout>
  );
}

export function NotFoundPage() {
  return (
    <Layout>
      <NotFound />
    </Layout>
  );
}
