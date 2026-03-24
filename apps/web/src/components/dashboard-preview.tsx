import { motion } from 'motion/react'

import { BrandMark } from '@/components/brand'

export function DashboardPreview() {
  return (
    <section id="plataforma" className="relative py-16 md:py-24">
      {/* Subtle background */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-muted/30 to-transparent" />

      <div className="relative mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.4 }}
            className="text-sm font-medium tracking-wide text-primary uppercase"
          >
            Plataforma
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl"
          >
            Projetado para metrologia
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.4, delay: 0.15 }}
            className="mt-4 text-base text-muted-foreground sm:text-lg"
          >
            Uma interface construída especificamente para o fluxo de trabalho de
            laboratórios de calibração — intuitiva, rápida e completa.
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mt-14"
        >
          {/* Browser mockup */}
          <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-2xl shadow-black/5 dark:shadow-black/20">
            {/* Title bar */}
            <div className="flex items-center gap-2 border-b border-border/60 bg-muted/50 px-4 py-3">
              <div className="flex gap-1.5">
                <div className="size-3 rounded-full bg-border" />
                <div className="size-3 rounded-full bg-border" />
                <div className="size-3 rounded-full bg-border" />
              </div>
              <div className="ml-4 flex-1">
                <div className="mx-auto max-w-xs rounded-md border border-border/60 bg-background px-3 py-1 text-center text-xs text-muted-foreground">
                  calibrafacil.com/dashboard
                </div>
              </div>
            </div>

            {/* Dashboard content */}
            <div className="flex min-h-[400px] sm:min-h-[480px]">
              {/* Sidebar */}
              <div className="hidden w-52 shrink-0 border-r border-border/40 bg-muted/20 p-4 md:block">
                <div className="mb-6 flex items-center gap-2">
                  <BrandMark className="size-7" />
                  <span className="text-xs font-semibold">MetroCal Lab</span>
                </div>

                <div className="space-y-1">
                  {[
                    { label: 'Dashboard', active: true },
                    { label: 'Clientes', active: false },
                    { label: 'Instrumentos', active: false },
                    { label: 'Padrões', active: false },
                    { label: 'Serviços', active: false },
                    { label: 'Ordens de Serviço', active: false },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className={`rounded-md px-2.5 py-1.5 text-xs ${item.active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground'}`}
                    >
                      {item.label}
                    </div>
                  ))}
                </div>

                <div className="mt-8 space-y-1">
                  <p className="mb-2 px-2.5 text-[10px] font-medium tracking-wider text-muted-foreground/60 uppercase">
                    Qualidade
                  </p>
                  {['Não Conformidades', 'Ações Corretivas'].map((item) => (
                    <div
                      key={item}
                      className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              {/* Main content */}
              <div className="flex-1 p-5 sm:p-6">
                <div className="mb-6 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">Dashboard</p>
                    <p className="text-xs text-muted-foreground">
                      Visão geral do laboratório
                    </p>
                  </div>
                  <div className="h-7 rounded-md bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                    Este mês
                  </div>
                </div>

                {/* Stats grid */}
                <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: 'Calibrações', value: '147', change: '+12%' },
                    { label: 'Em Andamento', value: '23', change: '' },
                    { label: 'Certificados', value: '124', change: '+8%' },
                    { label: 'Vencendo', value: '5', change: '', warn: true },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className="rounded-lg border border-border/40 bg-background p-3"
                    >
                      <p className="text-[10px] text-muted-foreground">
                        {stat.label}
                      </p>
                      <div className="mt-1 flex items-baseline gap-1.5">
                        <span
                          className={`text-lg font-bold ${stat.warn ? 'text-amber-500' : ''}`}
                        >
                          {stat.value}
                        </span>
                        {stat.change && (
                          <span className="text-[10px] text-emerald-500">
                            {stat.change}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Chart placeholder */}
                <div className="mb-6 rounded-lg border border-border/40 bg-background p-4">
                  <p className="mb-3 text-xs font-medium">
                    Volume de Calibrações
                  </p>
                  <div className="flex h-28 items-end gap-1.5 sm:h-32">
                    {[40, 55, 35, 70, 60, 85, 75, 90, 65, 80, 95, 88].map(
                      (height, i) => (
                        <div
                          key={i}
                          className="flex-1 rounded-t-sm bg-primary/20 transition-colors hover:bg-primary/40"
                          style={{ height: `${height}%` }}
                        />
                      ),
                    )}
                  </div>
                  <div className="mt-2 flex justify-between text-[9px] text-muted-foreground">
                    <span>Jan</span>
                    <span>Fev</span>
                    <span>Mar</span>
                    <span>Abr</span>
                    <span>Mai</span>
                    <span>Jun</span>
                    <span>Jul</span>
                    <span>Ago</span>
                    <span>Set</span>
                    <span>Out</span>
                    <span>Nov</span>
                    <span>Dez</span>
                  </div>
                </div>

                {/* Recent table */}
                <div className="rounded-lg border border-border/40 bg-background p-4">
                  <p className="mb-3 text-xs font-medium">
                    Últimas Ordens de Serviço
                  </p>
                  <div className="space-y-2">
                    {[
                      {
                        id: 'OS-2025-0147',
                        client: 'Pharma Indústria',
                        status: 'Concluída',
                        statusColor: 'bg-emerald-500',
                      },
                      {
                        id: 'OS-2025-0146',
                        client: 'AutoPeças Brasil',
                        status: 'Em Análise',
                        statusColor: 'bg-amber-500',
                      },
                      {
                        id: 'OS-2025-0145',
                        client: 'Siderúrgica Vale',
                        status: 'Em Execução',
                        statusColor: 'bg-primary',
                      },
                    ].map((row) => (
                      <div
                        key={row.id}
                        className="flex items-center justify-between rounded-md px-2 py-2 text-xs transition-colors hover:bg-muted/50"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-muted-foreground">
                            {row.id}
                          </span>
                          <span>{row.client}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div
                            className={`size-1.5 rounded-full ${row.statusColor}`}
                          />
                          <span className="text-muted-foreground">
                            {row.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
