import { AudienceSection } from './components/audience-section'
import { CaseStudySection } from './components/case-study-section'
import { ClosingCTA } from './components/closing-cta'
import { FAQSection } from './components/faq-section'
import { FeaturesSection } from './components/features-section'
import { Hero } from './components/hero'
import { HeroPreview } from './components/hero-preview'
import { LandingFooter } from './components/landing-footer'
import { LandingNav } from './components/landing-nav'
import { WorkflowSection } from './components/workflow-section'

export function LandingPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <LandingNav />
      <main>
        <Hero />
        <HeroPreview />
        <WorkflowSection />
        <AudienceSection />
        <FeaturesSection />
        <CaseStudySection />
        <FAQSection />
        <ClosingCTA />
      </main>
      <LandingFooter />
    </div>
  )
}
