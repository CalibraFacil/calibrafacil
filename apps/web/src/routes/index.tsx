import { createFileRoute } from '@tanstack/react-router'

import { Navbar } from '@/components/navbar'
import { Hero } from '@/components/hero'
import { Features } from '@/components/features'
import { DashboardPreview } from '@/components/dashboard-preview'
import { FAQ } from '@/components/faq'
import { CTA } from '@/components/cta'
import { Footer } from '@/components/footer'

export const Route = createFileRoute('/')({
  component: LandingPage,
})

function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main>
        <Hero />
        <Features />
        <DashboardPreview />
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </div>
  )
}
