import { useTheme } from 'next-themes'

import { useMountEffect } from '@/hooks/use-mount-effect'

import { AudienceSection } from './components/audience-section'
import { ClosingCTA } from './components/closing-cta'
import { FAQSection } from './components/faq-section'
import { FeaturesSection } from './components/features-section'
import { Hero } from './components/hero'
import { LandingFooter } from './components/landing-footer'
import { LandingNav } from './components/landing-nav'
import { WorkflowSection } from './components/workflow-section'

export function LandingPage() {
  useSystemThemeOnLanding()

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <LandingNav />
      <main>
        <Hero />
        <WorkflowSection />
        <AudienceSection />
        <FeaturesSection />
        <FAQSection />
        <ClosingCTA />
      </main>
      <LandingFooter />
    </div>
  )
}

// The public landing page should follow the visitor's OS preference, not any
// stored choice carried over from an authenticated session.
function useSystemThemeOnLanding() {
  const { setTheme } = useTheme()

  useMountEffect(() => {
    setTheme('system')
  })
}
