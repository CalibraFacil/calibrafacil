import { createFileRoute } from '@tanstack/react-router'
import {
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { Navbar } from '@/components/navbar'
import { Hero } from '@/components/hero'

const FeaturesSection = lazy(async () => {
  const module = await import('@/components/features')
  return { default: module.Features }
})

const DashboardPreviewSection = lazy(async () => {
  const module = await import('@/components/dashboard-preview')
  return { default: module.DashboardPreview }
})

const FAQSection = lazy(async () => {
  const module = await import('@/components/faq')
  return { default: module.FAQ }
})

const CTASection = lazy(async () => {
  const module = await import('@/components/cta')
  return { default: module.CTA }
})

const FooterSection = lazy(async () => {
  const module = await import('@/components/footer')
  return { default: module.Footer }
})

export const Route = createFileRoute('/')({
  component: LandingPage,
})

function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main>
        <Hero />
        <DeferredSection fallback={<SectionFallback />}>
          <FeaturesSection />
        </DeferredSection>
        <DeferredSection fallback={<SectionFallback />}>
          <DashboardPreviewSection />
        </DeferredSection>
        <DeferredSection fallback={<SectionFallback />}>
          <FAQSection />
        </DeferredSection>
        <DeferredSection fallback={<SectionFallback />}>
          <CTASection />
        </DeferredSection>
      </main>
      <DeferredSection fallback={<FooterFallback />}>
        <FooterSection />
      </DeferredSection>
    </div>
  )
}

function DeferredSection({
  children,
  fallback,
}: {
  children: ReactNode
  fallback: ReactNode
}) {
  const [isVisible, setIsVisible] = useState(false)
  const sectionRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (isVisible) return

    const element = sectionRef.current
    if (!element) return

    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return

        setIsVisible(true)
        observer.disconnect()
      },
      { rootMargin: '0px' },
    )

    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [isVisible])

  return (
    <div ref={sectionRef}>
      {isVisible ? (
        <Suspense fallback={fallback}>{children}</Suspense>
      ) : (
        fallback
      )}
    </div>
  )
}

function SectionFallback() {
  return <section className="min-h-[420px] py-16 md:min-h-[520px] md:py-24" />
}

function FooterFallback() {
  return <footer className="border-t border-border/50 py-12 md:py-16" />
}
