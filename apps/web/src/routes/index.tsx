import { createFileRoute } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Analytics01Icon,
  ArrowRight01Icon,
  BookOpen01Icon,
  Certificate01Icon,
  ClipboardIcon,
  FileSearchIcon,
  RulerIcon,
  SecurityCheckIcon,
  Settings01Icon,
  Tick02Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'

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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
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
    title: 'Dashboard de calibração',
    description:
      'Visão consolidada de ordens em execução, certificados emitidos e pendências operacionais.',
    accent: 'bg-primary/10 text-primary',
  },
  {
    title: 'Orçamento de incerteza',
    description:
      'Entradas, distribuições, coeficientes de sensibilidade, graus de liberdade e contribuição relativa.',
    accent: 'bg-chart-1/10 text-chart-1',
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
]

const traceabilityPoints = [
  'Registro dos parâmetros de entrada utilizados no cálculo.',
  'Transparência sobre distribuição, incerteza padrão e fator de abrangência.',
  'Histórico técnico para auditoria, revisão e reemissão de certificados.',
]

export const Route = createFileRoute('/')({
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
        <PlatformViewSection />
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

      <div className="relative mx-auto grid max-w-6xl gap-12 px-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <Badge variant="outline" className="gap-2 px-3 py-1.5">
            <HugeiconsIcon
              icon={SecurityCheckIcon}
              className="size-3.5 text-primary"
            />
            <span>Software para laboratórios de calibração</span>
          </Badge>

          <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl md:text-6xl">
            CalibraFácil, software para laboratórios de calibração conforme
            ISO/IEC 17025
          </h1>

          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            O CalibraFácil centraliza cálculo automático de incerteza baseado no
            GUM, rastreabilidade metrológica, ordens de serviço e geração
            automatizada de certificados em uma única plataforma.
          </p>

          <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row">
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
            <Dialog>
              <DialogTrigger render={<Button variant="outline" size="lg" />}>
                <HugeiconsIcon icon={BookOpen01Icon} data-icon="inline-start" />
                Ver exemplo de certificado
              </DialogTrigger>
              <DialogContent className="w-[min(96vw,1200px)] max-w-none overflow-hidden p-0 sm:max-w-none">
                <DialogHeader className="border-b border-border/50 px-6 pt-6">
                  <DialogTitle>
                    Exemplo de certificado de calibração
                  </DialogTitle>
                  <DialogDescription>
                    Visualização ampliada do certificado gerado a partir dos
                    dados de calibração, resultados e orçamento de incerteza.
                  </DialogDescription>
                </DialogHeader>
                <div className="bg-muted/20 p-4 md:p-6">
                  <CertificatePreviewFrame expanded />
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <MetricPill label="Metodologia" value="GUM" />
            <MetricPill label="Conformidade" value="ISO/IEC 17025" />
            <MetricPill label="Referência estatística" value="NIST" />
          </div>
        </div>

        <div className="relative">
          <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-2xl shadow-black/5 dark:shadow-black/20">
            <div className="flex items-center gap-2 border-b border-border/60 bg-muted/50 px-4 py-3">
              <div className="flex gap-1.5">
                <div className="size-3 rounded-full bg-border" />
                <div className="size-3 rounded-full bg-border" />
                <div className="size-3 rounded-full bg-border" />
              </div>
              <div className="ml-3 rounded-md border border-border/60 bg-background px-3 py-1 text-xs text-muted-foreground">
                calibrafacil.com/dashboard
              </div>
            </div>

            <div className="grid gap-4 p-4 sm:p-5">
              <div className="grid gap-3 sm:grid-cols-[1.1fr_0.9fr]">
                <Card className="border-border/60 bg-background/80 py-0 shadow-none">
                  <CardHeader className="border-b border-border/50 py-4">
                    <CardTitle className="text-sm">
                      Dashboard do laboratório
                    </CardTitle>
                    <CardDescription>
                      Indicadores operacionais e status do processo de
                      calibração.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 py-4 sm:grid-cols-2">
                    {[
                      ['Ordens ativas', '28'],
                      ['Certificados emitidos', '124'],
                      ['Pendências técnicas', '3'],
                      ['Auditorias abertas', '1'],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-lg border border-border/50 bg-muted/30 p-3"
                      >
                        <p className="text-[11px] text-muted-foreground">
                          {label}
                        </p>
                        <p className="mt-1 text-xl font-semibold">{value}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="border-border/60 bg-background/80 py-0 shadow-none">
                  <CardHeader className="border-b border-border/50 py-4">
                    <CardTitle className="text-sm">
                      Orçamento de incerteza
                    </CardTitle>
                    <CardDescription>
                      Entradas normalizadas segundo a metodologia do GUM.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="py-4">
                    <div className="space-y-2 text-xs">
                      {[
                        ['Repetitividade', 'Tipo A', '0,012'],
                        ['Resolução', 'Retangular', '0,029'],
                        ['Padrão ref.', 'Normal', '0,018'],
                        ['Ambiente', 'Normal', '0,007'],
                      ].map(([source, distribution, value]) => (
                        <div
                          key={source}
                          className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md border border-border/50 px-3 py-2"
                        >
                          <span className="truncate">{source}</span>
                          <span className="text-muted-foreground">
                            {distribution}
                          </span>
                          <span className="font-mono">{value}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card
                id="certificado"
                className="border-border/60 bg-background/80 py-0 shadow-none"
              >
                <CardHeader className="border-b border-border/50 py-4">
                  <CardTitle className="text-sm">
                    Exemplo de certificado
                  </CardTitle>
                  <CardDescription>
                    Documento técnico gerado a partir dos dados da calibração.
                  </CardDescription>
                </CardHeader>
                <CardContent className="py-4">
                  <CertificatePreviewFrame />
                </CardContent>
              </Card>
            </div>
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

function PlatformViewSection() {
  return (
    <section
      id="plataforma"
      className="border-t border-border/50 py-16 md:py-24"
    >
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          eyebrow="Visão da plataforma"
          title="Módulos visíveis no fluxo do laboratório"
          description="A plataforma reúne operação, documentação e consulta histórica em telas orientadas ao processo de calibração."
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
  if (title === 'Dashboard de calibração') {
    return (
      <div className="grid gap-3">
        <div className="grid grid-cols-3 gap-3">
          {[
            ['OS em aberto', '28'],
            ['Em aprovação', '6'],
            ['Certificados', '124'],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg border border-border/50 bg-muted/30 p-3"
            >
              <p className="text-[11px] text-muted-foreground">{label}</p>
              <p className="mt-1 text-lg font-semibold">{value}</p>
            </div>
          ))}
        </div>
        <div className="flex h-24 items-end gap-2 rounded-lg border border-border/50 p-3">
          {[36, 52, 45, 68, 74, 58, 82, 70].map((height, index) => (
            <div
              key={index}
              className="flex-1 rounded-t-sm bg-primary/30"
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
      </div>
    )
  }

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
    return (
      <div className="rounded-lg border border-border/50 p-4">
        <div className="flex items-center justify-between border-b border-border/50 pb-3">
          <div>
            <p className="text-sm font-semibold">Certificado CF-2026-01842</p>
            <p className="text-xs text-muted-foreground">
              Balança analítica | Classe I
            </p>
          </div>
          <Badge variant="outline">PDF</Badge>
        </div>
        <div className="mt-3 grid gap-2 text-xs">
          {[
            'Resultado: +0,0003 g',
            'Incerteza expandida: 0,0008 g',
            'k = 2,14 | 95 % de abrangência',
            'Rastreável ao padrão BAL-REF-07',
          ].map((line) => (
            <div key={line} className="rounded-md bg-muted/30 px-3 py-2">
              {line}
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
