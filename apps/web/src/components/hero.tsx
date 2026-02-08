import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight01Icon,
  SecurityCheckIcon,
  BookOpen01Icon,
} from '@hugeicons/core-free-icons'
import { motion } from 'motion/react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-32 pb-16 md:pt-40 md:pb-24">
      {/* Background grid */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-30 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
      </div>

      {/* Gradient orbs */}
      <div className="pointer-events-none absolute -top-40 left-1/2 size-[600px] -translate-x-1/2 rounded-full bg-primary/8 blur-[120px]" />
      <div className="pointer-events-none absolute -right-20 top-20 size-[300px] rounded-full bg-chart-1/10 blur-[80px]" />

      <div className="relative mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Badge variant="outline" className="mb-6 gap-2 px-3 py-1.5">
              <HugeiconsIcon icon={SecurityCheckIcon} className="size-3.5 text-primary" />
              <span className="text-xs">Projetado para conformidade ISO/IEC 17025</span>
            </Badge>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl md:text-6xl"
          >
            Gestão de calibração{' '}
            <span className="bg-gradient-to-r from-primary to-chart-1 bg-clip-text text-transparent">
              simplificada
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg"
          >
            Plataforma completa para laboratórios de calibração. Gerencie ordens de
            serviço, emita certificados com cálculo de incerteza conforme o GUM e
            mantenha a rastreabilidade metrológica — tudo em um só lugar.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center"
          >
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
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground"
          >
            <div className="flex items-center gap-2">
              <div className="size-1.5 rounded-full bg-emerald-500" />
              <span>Certificados digitais</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="size-1.5 rounded-full bg-emerald-500" />
              <span>Cálculo GUM automático</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="size-1.5 rounded-full bg-emerald-500" />
              <span>Portal do cliente</span>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
