import { HeadContent, createFileRoute } from '@tanstack/react-router'
import Navbar from '@/components/navbar'
import Hero from '@/components/hero'
import TrustedBy from '@/components/trusted-by'
import DashboardPreview from '@/components/dashboard-preview'
import Features from '@/components/features'
import FAQ from '@/components/faq'
import CTA from '@/components/cta'
import Footer from '@/components/footer'

export const Route = createFileRoute('/')({
  component: LandingPage,
  head: () => ({
    meta: [
      {
        title: 'CalibraFácil | Gestão de Calibrações',
        description: 'O dashboard definitivo para laboratórios acreditados RBC/Inmetro. Automatize certificados, gerencie equipamentos e ofereça um portal premium para seus clientes.',
      },
    ],
  }),
})

function LandingPage() {
  return (
    <>
      <HeadContent />
      <div className="min-h-screen bg-white dark:bg-slate-950">
        <Navbar />
        <main>
          <Hero />
          <TrustedBy />
          <DashboardPreview />
          <Features />
          <FAQ />
          <CTA />
        </main>
        <Footer />
      </div>
    </>
  )
}
