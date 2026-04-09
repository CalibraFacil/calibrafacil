import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon, BookOpen01Icon } from '@hugeicons/core-free-icons'
import { motion } from 'motion/react'

import { Button } from '@/components/ui/button'

export function CTA() {
  return (
    <section className="relative py-16 md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5 }}
          className="relative overflow-hidden rounded-2xl border border-border/60 bg-card"
        >
          {/* Background pattern */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:3rem_3rem] opacity-20" />
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-chart-1/5" />
          </div>

          <div className="relative px-8 py-16 text-center sm:px-16 sm:py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Pronto para modernizar seu laboratório?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
              Agende uma demonstração personalizada e descubra como o CalibraFácil
              pode otimizar seus processos de calibração e preparar seu laboratório
              para acreditação.
            </p>

            <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <a
                href="https://cal.com/calibrafacil/30min?user=calibrafacil"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button size="lg" className="text-sm">
                  Agendar Demonstração
                  <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
                </Button>
              </a>
              <a
                href="https://docs.calibrafacil.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" size="lg" className="text-sm">
                  <HugeiconsIcon icon={BookOpen01Icon} data-icon="inline-start" />
                  Ver Documentação
                </Button>
              </a>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
