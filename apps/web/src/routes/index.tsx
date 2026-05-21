import { createFileRoute, redirect } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  Analytics01Icon,
  AlertCircleIcon,
  ArrowRight01Icon,
  BookOpen01Icon,
  Calendar03Icon,
  Certificate01Icon,
  CheckmarkCircle01Icon,
  ClipboardIcon,
  FileSearchIcon,
  Home01Icon,
  Notebook01Icon,
  TaskAdd01Icon,
  RulerIcon,
  SecurityCheckIcon,
  Settings01Icon,
  Tick02Icon,
  UserGroupIcon,
  UserIcon,
  Wrench01Icon,
} from '@hugeicons/core-free-icons'

import { FAQ as LandingFAQ } from '@/components/faq'
import { Footer } from '@/components/footer'
import { Navbar } from '@/components/navbar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import certificatePreviewHtml from './certificate-preview.html?raw'
import { cn } from '@/lib/utils'
import { hasDesktopSession } from '@/runtime/desktop-auth'
import { isDesktopRuntime } from '@/runtime/desktop'

const commonProblems = [
  'Planilhas complexas para cálculo de incerteza.',
  'Geração manual de certificados.',
  'Dificuldade em manter rastreabilidade metrológica.',
  'Preparação demorada para auditorias ISO 17025.',
]

const featureGroups = [
  {
    icon: Analytics01Icon,
    title: 'Cálculo automático de incerteza',
    description:
      'Estruture o orçamento de incerteza diretamente no sistema, sem dependência de planilhas isoladas.',
    items: [
      'Implementação da metodologia GUM',
      'Incerteza Tipo A e Tipo B',
      'Combinação de incerteza via RSS',
      'Cálculo de fator de abrangência (t-Student)',
    ],
  },
  {
    icon: Certificate01Icon,
    title: 'Certificados de calibração',
    description:
      'Emita documentos padronizados com resultados, incerteza expandida e identificação do serviço.',
    items: [
      'Geração automática de certificados',
      'Layouts configuráveis',
      'Inclusão automática de resultados e incerteza',
    ],
  },
  {
    icon: Settings01Icon,
    title: 'Rastreabilidade metrológica',
    description:
      'Centralize as evidências técnicas necessárias para o controle do processo de calibração.',
    items: [
      'Histórico completo de calibrações',
      'Gestão de instrumentos e padrões',
      'Registro de métodos e medições',
    ],
  },
  {
    icon: UserGroupIcon,
    title: 'Portal do cliente',
    description:
      'Disponibilize documentos e histórico do instrumento sem depender de envio manual por e-mail.',
    items: [
      'Acesso online a certificados',
      'Histórico de instrumentos calibrados',
      'Download de documentos',
    ],
  },
]

const normativeReferences = [
  {
    title: 'GUM',
    description:
      'Base metodológica para expressão de incerteza de medição e composição do orçamento.',
  },
  {
    title: 'ISO/IEC 17025',
    description:
      'Suporte aos requisitos de competência, rastreabilidade, registros técnicos e emissão de resultados.',
  },
  {
    title: 'Tabelas estatísticas NIST',
    description:
      'Referências para graus de liberdade efetivos, fator de abrangência e verificações estatísticas.',
  },
]

const comparisonRows = [
  {
    label: 'Cálculo de incerteza',
    spreadsheet: 'Fórmulas difíceis de manter',
    platform: 'Cálculo automático de incerteza',
  },
  {
    label: 'Base matemática',
    spreadsheet: 'Risco de erro em referências',
    platform: 'Motor matemático validado',
  },
  {
    label: 'Rastreabilidade',
    spreadsheet: 'Rastreabilidade limitada',
    platform: 'Rastreabilidade completa',
  },
  {
    label: 'Certificados',
    spreadsheet: 'Geração manual de certificados',
    platform: 'Geração automática de certificados',
  },
]

const platformViews = [
  {
    title: 'Orçamento de incerteza',
    description:
      'Entradas, distribuições, coeficientes de sensibilidade, graus de liberdade e contribuição relativa.',
    accent: 'bg-primary/10 text-primary',
  },
  {
    title: 'Exemplo de certificado',
    description:
      'Documento com identificação do instrumento, resultados, incerteza expandida e rastreabilidade.',
    accent: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  {
    title: 'Histórico de instrumentos',
    description:
      'Sequência de calibrações, status documental e evidências técnicas acessíveis ao laboratório e ao cliente.',
    accent: 'bg-chart-3/10 text-chart-3',
  },
  {
    title: 'Portal do cliente',
    description:
      'Consulta de status, download de certificados e histórico de ativos em uma interface própria para o cliente.',
    accent: 'bg-chart-1/10 text-chart-1',
  },
]

const traceabilityPoints = [
  'Registro dos parâmetros de entrada utilizados no cálculo.',
  'Transparência sobre distribuição, incerteza padrão e fator de abrangência.',
  'Histórico técnico para auditoria, revisão e reemissão de certificados.',
]

const heroHighlights = [
  {
    icon: Certificate01Icon,
    label: 'Certificados digitais',
  },
  {
    icon: Analytics01Icon,
    label: 'Cálculo GUM automático',
  },
  {
    icon: UserGroupIcon,
    label: 'Portal do cliente',
  },
]

const heroProblems = [
  'Planilhas complexas para cálculo de incerteza.',
  'Geração manual de certificados.',
  'Preparação demorada para auditorias ISO 17025.',
]

const dashboardPreviewStats = [
  {
    icon: Notebook01Icon,
    label: 'Calibrações Pendentes',
    value: '28',
    badge: 'Em aberto',
  },
  {
    icon: CheckmarkCircle01Icon,
    label: 'Aprovadas Este Mês',
    value: '124',
    badge: 'Concluídas',
  },
  {
    icon: Calendar03Icon,
    label: 'Padrões Expirando',
    value: '5',
    badge: 'Próx. 30 dias',
  },
  {
    icon: AlertCircleIcon,
    label: 'Em Atraso',
    value: '3',
    badge: 'Atenção',
  },
]

const dashboardPreviewJobs = [
  {
    jobId: 'OS-2026-0147',
    customer: 'Pharma Indústria',
    asset: 'Micrômetro Externo',
    dueDate: '26/03/2026',
    status: 'Concluída',
    tone: 'default' as const,
  },
  {
    jobId: 'OS-2026-0146',
    customer: 'AutoPeças Brasil',
    asset: 'Balança Analítica',
    dueDate: '27/03/2026',
    status: 'Em Revisão',
    tone: 'outline' as const,
  },
  {
    jobId: 'OS-2026-0145',
    customer: 'Siderúrgica Vale',
    asset: 'Termômetro Padrão',
    dueDate: '25/03/2026',
    status: 'Em Execução',
    tone: 'secondary' as const,
  },
]

const dashboardPreviewChartData = [
  { date: '2026-02-03', approved: 14, rejected: 2 },
  { date: '2026-02-10', approved: 18, rejected: 1 },
  { date: '2026-02-17', approved: 16, rejected: 3 },
  { date: '2026-02-24', approved: 21, rejected: 2 },
  { date: '2026-03-03', approved: 19, rejected: 2 },
  { date: '2026-03-10', approved: 24, rejected: 4 },
  { date: '2026-03-17', approved: 22, rejected: 3 },
  { date: '2026-03-24', approved: 27, rejected: 2 },
]

const dashboardPreviewChartConfig = {
  approved: {
    label: 'Aprovadas',
    color: 'hsl(142.1 76.2% 36.3%)',
  },
  rejected: {
    label: 'Rejeitadas',
    color: 'hsl(0 84.2% 60.2%)',
  },
} satisfies ChartConfig

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    if (!isDesktopRuntime()) return

    if (await hasDesktopSession()) {
      throw redirect({ to: '/dashboard' })
    }

    throw redirect({
      to: '/sign-in',
      search: { redirect: '/dashboard' },
    })
  },
  component: LandingPage,
})

function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main>
        <HeroSection />
        <CommonProblemsSection />
        <SolutionSection />
        <ComplianceSection />
        <ComparisonSection />
        <WorkflowCardsSection />
        <PlatformSection />
        {/*<Pricing />*/}
        <LandingFAQ />
        <FinalCtaSection />
      </main>
      <Footer />
    </div>
  )
}

function HeroSection() {
  return (
    <section className="relative overflow-hidden pt-28 pb-16 md:pt-36 md:pb-24">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-30 [mask-image:radial-gradient(ellipse_at_center,black_25%,transparent_70%)]" />
      </div>
      <div className="pointer-events-none absolute -top-40 left-1/2 size-[520px] -translate-x-1/2 rounded-full bg-primary/8 blur-[120px]" />

      <div className="relative mx-auto max-w-5xl px-6">
        <div className="mx-auto max-w-4xl text-center">
          <Badge variant="outline" className="gap-2 px-3 py-1.5">
            <HugeiconsIcon
              icon={SecurityCheckIcon}
              className="size-3.5 text-primary"
            />
            <span>Software para laboratórios de calibração</span>
          </Badge>

          <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl md:text-6xl">
            Infraestrutura para calibração e emissão de certificados conforme
            ISO/IEC 17025
          </h1>

          <p className="mx-auto mt-6 max-w-3xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Substitua planilhas manuais e processos não rastreáveis por um
            sistema validado conforme GUM, com geração automática de
            certificados e rastreabilidade completa para auditorias.
          </p>

          <ul className="mx-auto mt-8 grid max-w-3xl gap-3 text-left md:grid-cols-3">
            {heroProblems.map((problem) => (
              <li
                key={problem}
                className="flex items-start gap-2 rounded-xl border border-border/60 bg-card/80 px-4 py-3 text-sm text-muted-foreground"
              >
                <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />
                <span>{problem}</span>
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {heroHighlights.map((item) => (
              <div
                key={item.label}
                className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/80 px-4 py-2 text-sm text-muted-foreground"
              >
                <HugeiconsIcon
                  icon={item.icon}
                  className="size-4 text-primary"
                />
                <span>{item.label}</span>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <a
              href="https://cal.com/calibrafacil/30min?user=calibrafacil"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button size="lg">
                Agendar demonstração técnica
                <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
              </Button>
            </a>
            <a
              href="https://docs.calibrafacil.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="lg">
                <HugeiconsIcon icon={BookOpen01Icon} data-icon="inline-start" />
                Ver documentação
              </Button>
            </a>
          </div>

          <div className="mt-10 grid gap-3 text-left sm:grid-cols-3">
            <MetricPill label="Metodologia GUM" value="JCGM 100" />
            <MetricPill label="Conforme" value="ISO/IEC 17025" />
            <MetricPill label="Validação estatística" value="NIST" />
          </div>
        </div>
      </div>
    </section>
  )
}

function CommonProblemsSection() {
  return (
    <section id="desafios" className="border-t border-border/50 py-16 md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          eyebrow="Operação técnica"
          title="Desafios comuns em laboratórios de calibração"
          description="Muitos laboratórios ainda dependem de planilhas que crescem ao longo do tempo e se tornam difíceis de manter, revisar e auditar."
        />

        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {commonProblems.map((problem) => (
            <Card
              key={problem}
              className="border-border/60 bg-card/80 py-0 shadow-none"
            >
              <CardContent className="flex h-full items-start gap-3 py-6">
                <div className="mt-0.5 rounded-md bg-destructive/10 p-2 text-destructive">
                  <HugeiconsIcon icon={FileSearchIcon} className="size-4" />
                </div>
                <p className="text-sm leading-relaxed">{problem}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}

function SolutionSection() {
  return (
    <section id="funcionalidades" className="py-16 md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          eyebrow="Solução"
          title="Uma plataforma desenvolvida para metrologia"
          description="O CalibraFácil organiza cálculo, registros técnicos, emissão documental e atendimento ao cliente em um fluxo único e rastreável."
        />

        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          {featureGroups.map((group) => (
            <Card
              key={group.title}
              className="border-border/60 bg-card/80 py-0 shadow-none"
            >
              <CardHeader className="border-b border-border/50 py-5">
                <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10">
                  <HugeiconsIcon
                    icon={group.icon}
                    className="size-5 text-primary"
                  />
                </div>
                <CardTitle>{group.title}</CardTitle>
                <CardDescription>{group.description}</CardDescription>
              </CardHeader>
              <CardContent className="py-5">
                <ul className="space-y-3">
                  {group.items.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm">
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        className="mt-0.5 size-4 text-primary"
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}

function ComplianceSection() {
  return (
    <section
      id="conformidade"
      className="border-t border-border/50 py-16 md:py-24"
    >
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          eyebrow="Conformidade normativa"
          title="Metodologia alinhada às normas internacionais"
          description="O sistema segue referências como GUM, ISO/IEC 17025 e tabelas estatísticas NIST, com rastreabilidade de cálculo e transparência metodológica em cada resultado emitido."
        />

        <div className="mt-10 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="grid gap-4">
            {normativeReferences.map((reference) => (
              <Card
                key={reference.title}
                className="border-border/60 bg-card/80 py-0 shadow-none"
              >
                <CardContent className="flex items-start gap-4 py-5">
                  <div className="rounded-lg bg-primary/10 p-2 text-primary">
                    <HugeiconsIcon icon={RulerIcon} className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{reference.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {reference.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="border-border/60 bg-card/80 py-0 shadow-none">
            <CardHeader className="border-b border-border/50 py-5">
              <CardTitle>Rastreabilidade de cálculo</CardTitle>
              <CardDescription>
                Estrutura pensada para revisão técnica, validação interna e
                auditoria.
              </CardDescription>
            </CardHeader>
            <CardContent className="py-5">
              <ul className="space-y-4">
                {traceabilityPoints.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm">
                    <div className="rounded-md bg-primary/10 p-2 text-primary">
                      <HugeiconsIcon icon={ClipboardIcon} className="size-4" />
                    </div>
                    <span className="leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  )
}

function ComparisonSection() {
  return (
    <section className="py-16 md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          eyebrow="Comparação"
          title="Planilhas Excel x CalibraFácil"
          description="A diferença central não está apenas em velocidade operacional, mas na confiabilidade do processo técnico e na facilidade de demonstrar conformidade."
        />

        <div className="mt-10 overflow-hidden rounded-2xl border border-border/60 bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="px-4">Critério</TableHead>
                <TableHead className="px-4">Planilhas Excel</TableHead>
                <TableHead className="px-4">CalibraFácil</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comparisonRows.map((row) => (
                <TableRow key={row.label}>
                  <TableCell className="px-4 py-4 font-medium">
                    {row.label}
                  </TableCell>
                  <TableCell className="px-4 py-4 text-muted-foreground">
                    {row.spreadsheet}
                  </TableCell>
                  <TableCell className="px-4 py-4">
                    <span className="inline-flex items-center gap-2 font-medium">
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        className="size-4 text-primary"
                      />
                      {row.platform}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  )
}

function WorkflowCardsSection() {
  return (
    <section className="border-t border-border/50 py-16 md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          eyebrow="Fluxos visíveis"
          title="Documentação, cálculo e histórico no mesmo ambiente"
          description="Cada módulo organiza uma etapa do processo de calibração com foco em execução técnica, emissão documental e rastreabilidade."
        />

        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          {platformViews.map((view) => (
            <Card
              key={view.title}
              className="border-border/60 bg-card/80 py-0 shadow-none"
            >
              <CardHeader className="border-b border-border/50 py-5">
                <div
                  className={cn(
                    'mb-3 inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium',
                    view.accent,
                  )}
                >
                  {view.title}
                </div>
                <CardDescription>{view.description}</CardDescription>
              </CardHeader>
              <CardContent className="py-5">
                <PlatformMock title={view.title} />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}

function PlatformSection() {
  return (
    <section
      id="plataforma"
      className="border-t border-border/50 bg-muted/20 py-16 md:py-24"
    >
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          eyebrow="Plataforma"
          title="Projetado para metrologia"
          description="Uma interface construída especificamente para o fluxo de trabalho de laboratórios de calibração, intuitiva, rápida e completa."
        />

        <div className="mt-10">
          <DashboardPreview />
        </div>
      </div>
    </section>
  )
}

function FinalCtaSection() {
  return (
    <section className="py-16 md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="rounded-3xl border border-border/60 bg-card px-6 py-10 shadow-sm sm:px-8 md:px-10 md:py-12">
          <div className="max-w-3xl">
            <Badge variant="outline" className="gap-2 px-3 py-1.5">
              <HugeiconsIcon
                icon={SecurityCheckIcon}
                className="size-3.5 text-primary"
              />
              <span>Fluxo técnico e regulatório</span>
            </Badge>
            <h2 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">
              Modernize o fluxo de trabalho do seu laboratório
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
              Automatize cálculos de incerteza, mantenha rastreabilidade
              metrológica e simplifique a emissão de certificados.
            </p>
            <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row">
              <a
                href="https://cal.com/calibrafacil/30min?user=calibrafacil"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button size="lg">
                  Agendar demonstração
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    data-icon="inline-end"
                  />
                </Button>
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div className="max-w-3xl">
      <p className="text-sm font-medium tracking-wide text-primary uppercase">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
        {title}
      </h2>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
        {description}
      </p>
    </div>
  )
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/80 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  )
}

function CertificatePreviewFrame({ expanded = false }: { expanded?: boolean }) {
  if (expanded) {
    return (
      <div className="overflow-hidden rounded-xl border border-border/60 bg-white shadow-sm">
        <iframe
          title="Exemplo de certificado"
          srcDoc={certificatePreviewHtml}
          sandbox="allow-same-origin"
          className="h-[78vh] min-h-[720px] w-full rounded-lg border-0 bg-white"
        />
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border/60 bg-white p-2">
      <div className="h-[524px] overflow-hidden rounded-lg bg-white">
        <iframe
          title="Exemplo de certificado"
          srcDoc={certificatePreviewHtml}
          sandbox="allow-same-origin"
          className="h-[780px] w-full origin-top-left scale-[0.68] border-0 bg-white"
          style={{
            width: '147%',
          }}
        />
      </div>
    </div>
  )
}

function PlatformMock({ title }: { title: string }) {
  if (title === 'Orçamento de incerteza') {
    return (
      <div className="space-y-2 rounded-lg border border-border/50 p-3 text-xs">
        {[
          ['Fonte', 'Distribuição', 'u(x)'],
          ['Repetitividade', 'Normal', '0,012'],
          ['Resolução', 'Retangular', '0,029'],
          ['Padrão', 'Normal', '0,018'],
          ['Combinada', '-', '0,036'],
        ].map((row, index) => (
          <div
            key={row.join('-')}
            className={cn(
              'grid grid-cols-[1fr_auto_auto] gap-2 rounded-md px-2 py-2',
              index === 0
                ? 'bg-muted/50 font-medium'
                : 'border border-border/40',
            )}
          >
            <span>{row[0]}</span>
            <span>{row[1]}</span>
            <span className="font-mono">{row[2]}</span>
          </div>
        ))}
      </div>
    )
  }

  if (title === 'Exemplo de certificado') {
    return <CertificatePreviewFrame />
  }

  if (title === 'Portal do cliente') {
    return (
      <div className="rounded-lg border border-border/50 p-4">
        <div className="flex items-center justify-between border-b border-border/50 pb-3">
          <div>
            <p className="text-sm font-semibold">Acompanhamento do cliente</p>
            <p className="text-xs text-muted-foreground">
              Consulta de serviços e download documental
            </p>
          </div>
          <Badge variant="outline">Portal</Badge>
        </div>
        <div className="mt-3 space-y-2 text-xs">
          {[
            ['Status da OS', 'Em revisão técnica'],
            ['Último certificado', 'CF-2026-01842 disponível'],
            ['Próximo vencimento', '15/04/2026'],
          ].map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between rounded-md border border-border/40 px-3 py-2"
            >
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium">{value}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-border/50 p-3 text-xs">
      {[
        ['TAG-001', 'Paquímetro digital', 'Certificado disponível'],
        ['TAG-014', 'Micrômetro externo', 'Em execução'],
        ['TAG-022', 'Termômetro padrão', 'Aguardando aprovação'],
      ].map(([tag, asset, status]) => (
        <div
          key={tag}
          className="grid grid-cols-[auto_1fr] gap-3 rounded-md border border-border/40 px-3 py-2"
        >
          <span className="font-mono text-muted-foreground">{tag}</span>
          <div>
            <p>{asset}</p>
            <p className="text-muted-foreground">{status}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function DashboardPreview() {
  return (
    <div className="overflow-hidden rounded-3xl border border-border/60 bg-card shadow-2xl shadow-black/5 dark:shadow-black/20">
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-4 py-3">
        <div className="flex gap-1.5">
          <div className="size-3 rounded-full bg-border" />
          <div className="size-3 rounded-full bg-border" />
          <div className="size-3 rounded-full bg-border" />
        </div>
        <div className="ml-3 rounded-md border border-border/60 bg-background px-3 py-1 text-xs text-muted-foreground">
          calibrafacil.com/dashboard
        </div>
      </div>

      <div className="grid min-h-[640px] lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="hidden border-r border-border/60 bg-muted/20 lg:flex lg:flex-col">
          <div className="border-b border-border/60 px-4 py-4">
            <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
              <p className="text-xs text-muted-foreground">Organização ativa</p>
              <p className="mt-1 text-sm font-semibold">MetroLab Nordeste</p>
            </div>
          </div>

          <div className="flex-1 px-3 py-4">
            <div className="space-y-1">
              <SidebarPreviewItem icon={Home01Icon} label="Painel" active />
              <SidebarPreviewItem icon={UserIcon} label="Clientes" />
              <SidebarPreviewItem icon={Wrench01Icon} label="Ativos" />
              <SidebarPreviewItem icon={RulerIcon} label="Padrões" />
              <SidebarPreviewItem icon={TaskAdd01Icon} label="Serviços" />
              <SidebarPreviewItem
                icon={ClipboardIcon}
                label="Ordens de Serviço"
              />
              <SidebarPreviewItem icon={Notebook01Icon} label="Solicitações" />
            </div>

            <div className="mt-6">
              <p className="px-3 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Qualidade
              </p>
              <div className="mt-2 space-y-1">
                <SidebarPreviewItem
                  icon={AlertCircleIcon}
                  label="Não Conformidades"
                />
                <SidebarPreviewItem
                  icon={Settings01Icon}
                  label="Configurações"
                />
              </div>
            </div>
          </div>
        </aside>

        <div className="flex flex-col bg-background">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 sm:px-6">
            <div>
              <p className="text-xs text-muted-foreground">Dashboard</p>
              <p className="text-sm font-semibold">
                Visão geral do laboratório
              </p>
            </div>
            <div className="hidden items-center gap-2 sm:flex">
              <Badge variant="outline">Atualizado há 2 min</Badge>
              <Button variant="outline" size="sm">
                Nova OS
              </Button>
            </div>
          </div>

          <div className="space-y-6 p-4 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {dashboardPreviewStats.map((stat) => (
                <Card
                  key={stat.label}
                  className="border-border/60 bg-card/80 py-0 shadow-none"
                >
                  <CardHeader className="py-5">
                    <CardDescription>
                      <span className="flex items-center gap-2">
                        <HugeiconsIcon icon={stat.icon} className="size-4" />
                        {stat.label}
                      </span>
                    </CardDescription>
                    <CardTitle className="text-3xl">{stat.value}</CardTitle>
                    <div>
                      <Badge variant="secondary">{stat.badge}</Badge>
                    </div>
                  </CardHeader>
                </Card>
              ))}
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <Card className="border-border/60 bg-card/80 py-0 shadow-none">
                <CardHeader className="border-b border-border/50 py-5">
                  <CardTitle>Calibrações ao Longo do Tempo</CardTitle>
                  <CardDescription>
                    Tendência recente de aprovações e rejeições
                  </CardDescription>
                </CardHeader>
                <CardContent className="py-5">
                  <ChartContainer
                    config={dashboardPreviewChartConfig}
                    className="h-56 w-full"
                  >
                    <AreaChart
                      data={dashboardPreviewChartData}
                      margin={{ left: 0, right: 0, top: 10, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="dashboardPreviewApproved"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="var(--color-approved)"
                            stopOpacity={0.28}
                          />
                          <stop
                            offset="95%"
                            stopColor="var(--color-approved)"
                            stopOpacity={0}
                          />
                        </linearGradient>
                        <linearGradient
                          id="dashboardPreviewRejected"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="var(--color-rejected)"
                            stopOpacity={0.22}
                          />
                          <stop
                            offset="95%"
                            stopColor="var(--color-rejected)"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        className="stroke-muted"
                      />
                      <XAxis
                        dataKey="date"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={24}
                        tickFormatter={(value) =>
                          new Date(value).toLocaleDateString('pt-BR', {
                            day: '2-digit',
                            month: 'short',
                          })
                        }
                        className="text-xs text-muted-foreground"
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        width={30}
                        className="text-xs text-muted-foreground"
                      />
                      <ChartTooltip
                        cursor={false}
                        content={
                          <ChartTooltipContent
                            labelFormatter={(value) =>
                              new Date(value).toLocaleDateString('pt-BR', {
                                day: '2-digit',
                                month: 'long',
                                year: 'numeric',
                              })
                            }
                            indicator="dot"
                          />
                        }
                      />
                      <Area
                        type="monotone"
                        dataKey="approved"
                        stroke="var(--color-approved)"
                        fill="url(#dashboardPreviewApproved)"
                        strokeWidth={2}
                      />
                      <Area
                        type="monotone"
                        dataKey="rejected"
                        stroke="var(--color-rejected)"
                        fill="url(#dashboardPreviewRejected)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ChartContainer>
                </CardContent>
              </Card>

              <Card className="border-border/60 bg-card/80 py-0 shadow-none">
                <CardHeader className="border-b border-border/50 py-5">
                  <CardTitle>Ordens de Serviço Recentes</CardTitle>
                  <CardDescription>
                    Últimas ordens em execução e revisão
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 py-5">
                  {dashboardPreviewJobs.map((job) => (
                    <div
                      key={job.jobId}
                      className="rounded-xl border border-border/50 bg-background/70 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-xs font-medium">
                            {job.jobId}
                          </p>
                          <p className="mt-1 text-sm">{job.customer}</p>
                          <p className="text-xs text-muted-foreground">
                            {job.asset}
                          </p>
                        </div>
                        <Badge variant={job.tone}>{job.status}</Badge>
                      </div>
                      <div className="mt-3 text-xs text-muted-foreground">
                        Prazo: {job.dueDate}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SidebarPreviewItem({
  icon,
  label,
  active = false,
}: {
  icon: Parameters<typeof HugeiconsIcon>[0]['icon']
  label: string
  active?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
        active
          ? 'bg-primary/10 font-medium text-primary'
          : 'text-muted-foreground',
      )}
    >
      <HugeiconsIcon icon={icon} className="size-4" />
      <span>{label}</span>
    </div>
  )
}
