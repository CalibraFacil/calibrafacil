import { HugeiconsIcon } from '@hugeicons/react'
import {
  Certificate01Icon,
  Settings01Icon,
  UserGroupIcon,
  Analytics01Icon,
  FlipPhoneIcon,
  SecurityCheckIcon,
  ArrowRight01Icon,
} from '@hugeicons/core-free-icons'
import { motion } from 'motion/react'

const features = [
  {
    icon: Certificate01Icon,
    title: 'Certificados Automatizados',
    description:
      'Gere certificados de calibração com layout personalizado, cálculo de incerteza conforme o GUM e assinatura digital integrada.',
    accent: 'from-primary/20 to-chart-1/20',
  },
  {
    icon: Settings01Icon,
    title: 'Métodos Configuráveis',
    description:
      'Editor de procedimentos de calibração flexível que se adapta a qualquer grandeza — massa, temperatura, pressão, dimensional e muito mais.',
    accent: 'from-chart-2/20 to-chart-3/20',
  },
  {
    icon: UserGroupIcon,
    title: 'Portal do Cliente',
    description:
      'Ofereça aos seus clientes acesso direto para acompanhar o status de calibrações, baixar certificados e consultar o histórico dos instrumentos.',
    accent: 'from-chart-3/20 to-chart-4/20',
  },
  {
    icon: Analytics01Icon,
    title: 'Rastreabilidade Completa',
    description:
      'Trilha de auditoria automática para todas as ações, histórico de revisões de certificados e rastreabilidade metrológica dos padrões de referência.',
    accent: 'from-chart-4/20 to-chart-5/20',
  },
  {
    icon: FlipPhoneIcon,
    title: 'Gestão de Ativos',
    description:
      'Cadastre instrumentos e padrões, controle intervalos de calibração, receba alertas de vencimento e mantenha o inventário atualizado.',
    accent: 'from-chart-5/20 to-primary/20',
  },
  {
    icon: SecurityCheckIcon,
    title: 'Conformidade Normativa',
    description:
      'Fluxos de trabalho projetados para atender os requisitos de acreditação de laboratórios segundo a ISO/IEC 17025, com controle de não conformidades e ações corretivas.',
    accent: 'from-primary/20 to-chart-2/20',
  },
]

export function Features() {
  return (
    <section id="funcionalidades" className="relative py-16 md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.4 }}
            className="text-sm font-medium tracking-wide text-foreground uppercase"
          >
            Funcionalidades
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl"
          >
            Tudo que seu laboratório precisa
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.4, delay: 0.15 }}
            className="mt-4 text-base text-muted-foreground sm:text-lg"
          >
            Do recebimento do instrumento à emissão do certificado — cada etapa
            do processo de calibração, integrada e rastreável.
          </motion.p>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className="group relative rounded-xl border border-border/60 bg-card p-6 transition-all hover:border-border hover:shadow-sm"
            >
              <div
                className={`mb-4 flex size-10 items-center justify-center rounded-lg bg-gradient-to-br ${feature.accent}`}
              >
                <HugeiconsIcon
                  icon={feature.icon}
                  className="size-5 text-foreground"
                  strokeWidth={1.5}
                />
              </div>
              <h3 className="text-base font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="mt-12 text-center"
        >
          <a
            href="https://docs.calibrafacil.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Explore todas as funcionalidades na documentação
            <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
          </a>
        </motion.div>
      </div>
    </section>
  )
}
