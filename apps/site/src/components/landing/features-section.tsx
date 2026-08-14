import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  ArrowRight01Icon,
  Calendar03Icon,
  Certificate01Icon,
  CheckmarkCircle02Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";

import { Reveal } from "./reveal";
import { SectionHeading } from "./landing-primitives";

export function FeaturesSection() {
  return (
    <section id="capacidades" className="border-t border-border/70 py-24">
      <div className="mx-auto max-w-[1200px] px-6 md:px-8">
        <SectionHeading
          title="Recursos da plataforma"
          lead="Cinco blocos sustentam a operação diária e a defesa em auditoria: assinatura digital ICP-Brasil ligada à versão imutável, verificação pública do certificado, portal restrito ao cliente final, gestão proativa de vencimentos e análise de periodicidade a partir do histórico."
        />

        <FeatureSignature />
        <FeatureVerification />
        <FeaturePortal />
        <FeatureExpirations />
        <FeatureInterval />
      </div>
    </section>
  );
}

function Feature({
  title,
  lead,
  bullets,
  visual,
  reverse = false,
  bare = false,
}: {
  title: string;
  lead: React.ReactNode;
  bullets: readonly string[];
  visual: React.ReactNode;
  reverse?: boolean;
  /**
   * Drop the card chrome around the visual. The console-style panels bring
   * their own surface (ring + layered shadow, copied from the portal), so the
   * default wrapper would frame a frame.
   */
  bare?: boolean;
}) {
  return (
    <div className="grid min-w-0 items-center gap-10 py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-20">
      <div className={cn("min-w-0", reverse && "lg:order-2")}>
        <Reveal>
          <div className="min-w-0 max-w-[480px]">
            <h3 className="mb-3.5 max-w-[22ch] text-[clamp(24px,2.6vw,34px)] leading-[1.1] font-semibold tracking-tight text-balance">
              {title}
            </h3>
            <p className="max-w-[56ch] text-sm leading-normal text-pretty text-muted-foreground">
              {lead}
            </p>
            <ul className="mt-[22px] grid gap-3">
              {bullets.map((bullet) => (
                <li
                  key={bullet}
                  className="grid grid-cols-[18px_1fr] gap-3 text-sm leading-normal text-foreground/90"
                >
                  <span className="mt-2 ml-1.5 size-1.5 rounded-full bg-primary shadow-[0_0_0_4px_color-mix(in_oklch,var(--primary)_12%,transparent)]" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
      <div className={cn("min-w-0", reverse && "lg:order-1")}>
        <Reveal delay={0.1}>
          <div
            className={cn(
              "min-w-0",
              !bare &&
                "overflow-hidden rounded-lg border border-border bg-card p-3 shadow-xl sm:p-6",
            )}
          >
            {visual}
          </div>
        </Reveal>
      </div>
    </div>
  );
}

function CodeChip({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted/70 px-1.5 py-px font-mono text-xs">
      {children}
    </code>
  );
}

function FeatureSignature() {
  return (
    <Feature
      title="O certificado sai assinado em ICP-Brasil. Com validade legal, não só um nome no rodapé."
      lead={
        <>
          A aprovação não apenas congela o PDF — assina o arquivo com o
          certificado digital ICP-Brasil A1 (<CodeChip>.p12</CodeChip>/
          <CodeChip>.pfx</CodeChip>) do responsável técnico, no padrão PAdES.
          Carimbo de tempo (RFC-3161) e cadeia validada até a AC-Raiz ficam
          embutidos no próprio documento. Qualquer validador oficial
          (validar.iti.gov.br, Adobe Reader) confirma quem assinou e que nada
          mudou desde a aprovação.
        </>
      }
      bullets={[
        "Assinatura PAdES com certificado ICP-Brasil A1 (.p12/.pfx), aplicada na própria aprovação do certificado",
        "Carimbo de tempo RFC-3161 (PAdES-T) e validação da cadeia até a AC-Raiz da ICP-Brasil",
        "Atende à identificação do signatário exigida pela ISO/IEC 17025 (7.8.2.1)",
        "Cada unidade mantém sua carteira de certificados e define o padrão de assinatura",
        "A assinatura cobre a versão congelada — qualquer alteração posterior quebra a validação.",
      ]}
      visual={<SignedCertificate />}
    />
  );
}

function FeatureVerification() {
  return (
    <Feature
      reverse
      bare
      title="Quem recebe o certificado confere sozinho se ele é verdadeiro."
      lead={
        <>
          Cada certificado carrega um token único e imprevisível, impresso como
          texto e como QR. Auditor, cliente ou terceiro abre a página pública
          sem credencial nenhuma e vê qual laboratório emitiu, para quem, qual
          ativo e — o que mais importa — se aquela versão continua valendo. A
          página ainda confere a assinatura do arquivo e diz, em bom português,
          se o conteúdo bate com o que foi assinado.
        </>
      }
      bullets={[
        "Token único por certificado, em texto e em QR. Confere sem login e sem pedir nada ao laboratório.",
        "Status explícito: autêntico ou substituído. PDF antigo circulando não passa por vigente.",
        "Conferência criptográfica do arquivo: conteúdo íntegro, assinatura válida e cadeia até a AC-Raiz da ICP-Brasil.",
        "Download do PDF original pra comparar com o arquivo que chegou por e-mail.",
        "Laboratório emissor, cliente, ativo, serviço e data da calibração na mesma tela.",
      ]}
      visual={<PublicVerification />}
    />
  );
}

function FeaturePortal() {
  return (
    <Feature
      title="Cliente baixa o que é dele. Você ganha o tempo de volta."
      lead="Menos email pedindo certificado. Menos tempo procurando documento antigo. Zero risco de mandar PDF errado pro cliente errado. Pro cliente final, autonomia pra baixar certificado, conferir histórico e ver o que está vencendo — direto no portal, sem depender da sua equipe."
      bullets={[
        "Cliente baixa certificado e consulta histórico sem abrir chamado",
        "Alerta de vencimento por instrumento. Cliente se antecipa, você não.",
        "Cada organização vê só os próprios dados. Isolamento é o padrão.",
        "Baixa apenas a versão aprovada. Rascunho fica interno, nunca vaza.",
      ]}
      visual={<PortalPreview />}
    />
  );
}

function FeatureExpirations() {
  return (
    <Feature
      reverse
      title="Vencimento de padrão nunca pega de surpresa."
      lead="O sistema acompanha cada padrão de referência do laboratório e cada certificado emitido para os clientes. Você sabe quem vence em 30, 60 e 90 dias; o cliente recebe aviso pelo portal antes da calibração expirar. Acaba o padrão vencido pego em auditoria."
      bullets={[
        "Cronograma de vencimento dos padrões de referência e dos equipamentos do laboratório",
        "Alerta automático ao cliente antes de a calibração do instrumento dele vencer",
        "Visibilidade da fila: o que entra, o que está atrasado, o que vence essa semana",
        "Padrão vencido não pode ser usado como referência. O sistema bloqueia.",
      ]}
      visual={<ExpirationsAgenda />}
    />
  );
}

function FeatureInterval() {
  return (
    <Feature
      bare
      title="A periodicidade para de ser doze meses por hábito."
      lead={
        <>
          O motor de confiabilidade lê o histórico de calibração do instrumento
          e o classifica: estável, derivando, ou sem dados suficientes pra
          opinar. Daí calcula confiabilidade e cobertura sobre os ciclos
          observados e sugere estender, manter ou encurtar o intervalo — pelo
          método da ILAC-G24 / NCSL RP-1. Quem aplica é o cliente, no portal
          dele.
        </>
      }
      bullets={[
        "Classificação a partir do histórico do instrumento: estável, derivando ou dados insuficientes.",
        "Histórico curto demais? O motor recorre aos instrumentos iguais do parque — mesmo tipo e modelo — em vez de chutar.",
        "Confiabilidade e cobertura calculadas sobre os ciclos observados, não uma média solta.",
        "Sugestão explícita — estender, manter ou encurtar — com o intervalo proposto em meses.",
        "O laboratório recomenda, mas não decide no lugar do cliente: quem aplica a periodicidade é ele, no portal, e a mudança fica registrada com a justificativa do motor.",
      ]}
      visual={<IntervalInsight />}
    />
  );
}

/**
 * Local mirrors of the portal's `instrument-panel` vocabulary
 * (apps/portal/src/components/instrument-panel.tsx) — flat console surface,
 * blueprint grid, tonal tiles with an inset ring, mono uppercase eyebrows and
 * tabular numerics. The site can't import from apps/portal, so the utilities
 * are duplicated verbatim; keep them in sync when the portal's change, or the
 * landing stops looking like the product.
 */
const consolePanel =
  "min-w-0 rounded-2xl bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10";
const consoleTileRing =
  "shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]";
const consoleEyebrow =
  "font-mono text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase";
const blueprintOverlay =
  "pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,rgba(15,23,42,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.05)_1px,transparent_1px)] [background-size:24px_24px] [mask-image:radial-gradient(130%_130%_at_0%_0%,black,transparent_72%)] dark:[background-image:linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.06)_1px,transparent_1px)]";

type ConsoleTone = "ok" | "warning" | "neutral";

const consoleToneSurface: Record<ConsoleTone, string> = {
  ok: "bg-emerald-500/10",
  warning: "bg-amber-500/10",
  neutral: "bg-muted/45",
};
const consoleToneText: Record<ConsoleTone, string> = {
  ok: "text-emerald-700 dark:text-emerald-400",
  warning: "text-amber-700 dark:text-amber-400",
  neutral: "text-foreground",
};

/** Mirrors `BlueprintField`: hairline-separated cells on the panel surface. */
function BlueprintField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-background p-3">
      <p className="text-[11px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
        {label}
      </p>
      <div className="mt-1 font-mono text-sm tabular-nums">{children}</div>
    </div>
  );
}

/** Mirrors `SignalTile` — the tonal indicator used for each integrity check. */
function SignalTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: ConsoleTone;
}) {
  return (
    <div
      className={cn(
        "rounded-xl p-3",
        consoleTileRing,
        consoleToneSurface[tone],
      )}
    >
      <span className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </span>
      <div
        className={cn(
          "mt-1 font-mono text-sm font-semibold tabular-nums",
          consoleToneText[tone],
        )}
      >
        {value}
      </div>
    </div>
  );
}

function PublicVerification() {
  return (
    <div className={cn(consolePanel, "relative overflow-hidden")}>
      <div aria-hidden className={blueprintOverlay} />

      <div className="relative flex flex-col items-center gap-3 p-6 text-center">
        <div
          className={cn(
            "flex size-14 items-center justify-center rounded-full",
            consoleToneSurface.ok,
          )}
        >
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            strokeWidth={2}
            className={cn("size-7", consoleToneText.ok)}
          />
        </div>
        <div className="min-w-0">
          <p className={consoleEyebrow}>Verificação de certificado</p>
          <h4 className={cn("mt-1 text-xl font-semibold", consoleToneText.ok)}>
            Certificado autêntico
          </h4>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums break-all text-foreground">
            CC-2026-0231
          </p>
        </div>
      </div>

      <div className="relative px-5 pb-5">
        {/* Same fields, same labels, same order as the real page's
            identification block — Ativo / Cliente / Serviço / Data /
            Laboratório. `Data` is the calibration date (performedAt). */}
        <div className="grid gap-px overflow-hidden rounded-xl bg-foreground/10 sm:grid-cols-2">
          <BlueprintField label="Ativo">AS-220 · 55219</BlueprintField>
          <BlueprintField label="Cliente">Indústria São José</BlueprintField>
          <BlueprintField label="Serviço">Calibração de massa</BlueprintField>
          <BlueprintField label="Data">12/06/2026</BlueprintField>
        </div>

        <div
          className={cn(
            "mt-3 rounded-xl p-3",
            consoleTileRing,
            consoleToneSurface.ok,
          )}
        >
          <p
            className={cn(
              "flex items-center gap-2 text-sm font-medium",
              consoleToneText.ok,
            )}
          >
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              className="size-4 shrink-0"
            />
            Assinatura íntegra e confiável
          </p>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <SignalTile label="Conteúdo" value="OK" tone="ok" />
          <SignalTile label="Assinatura" value="OK" tone="ok" />
          <SignalTile label="Cadeia ICP-Brasil" value="OK" tone="ok" />
        </div>
      </div>
    </div>
  );
}

function IntervalInsight() {
  return (
    <div className={cn(consolePanel, "p-5")}>
      <p className={consoleEyebrow}>Programa metrológico</p>
      <h4 className="mt-1 text-base font-semibold sm:text-lg">
        Análise de periodicidade
      </h4>
      <p className="mt-1 text-sm text-pretty text-muted-foreground">
        Sugestão baseada no histórico de calibração (ILAC-G24 / NCSL RP-1).
        Apenas indicativo — você decide.
      </p>

      <div className="mt-4 space-y-4">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
            consoleToneSurface.ok,
            consoleToneText.ok,
          )}
        >
          <span className="size-1.5 rounded-full bg-emerald-600 dark:bg-emerald-500" />
          Estável
        </span>

        <div className="grid gap-px overflow-hidden rounded-xl bg-foreground/10 sm:grid-cols-2">
          <BlueprintField label="Confiabilidade">94%</BlueprintField>
          <BlueprintField label="Cobertura">87%</BlueprintField>
        </div>

        <div
          className={cn(
            "rounded-xl p-4 text-sm",
            consoleTileRing,
            consoleToneSurface.neutral,
          )}
        >
          Sugestão:{" "}
          <strong className="font-semibold">Estender para 18 meses</strong>.
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex min-h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                strokeWidth={2}
                className="size-4"
              />
              Aplicar sugestão
            </span>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              atual 12 meses
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const signatureRows: { label: string; value: React.ReactNode }[] = [
  { label: "Signatário", value: "Mariana Silva · Resp. Técnica" },
  { label: "CPF", value: "123.456.789-00" },
  { label: "Emissor (AC)", value: "AC SOLUTI Múltipla v5" },
  { label: "Padrão", value: "PAdES-T · SHA-256" },
  { label: "Carimbo de tempo", value: "12/06/2026 14:32 (RFC-3161)" },
  { label: "Cadeia", value: "validada até a AC-Raiz ICP-Brasil" },
];

function SignedCertificate() {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-border bg-card font-mono text-xs">
      <div className="flex items-center gap-2.5 border-b border-border/80 bg-background/50 px-3.5 py-2.5">
        <HugeiconsIcon
          icon={Certificate01Icon}
          className="size-3.5 text-emerald-500"
        />
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          CC-2026-0231.pdf
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 rounded bg-emerald-500/15 px-2 py-1 text-xs tracking-wider text-emerald-500 uppercase">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-3" />
          Assinatura válida
        </span>
      </div>

      <div className="divide-y divide-border/40">
        {signatureRows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3 px-3.5 py-2.5 sm:grid-cols-[132px_minmax(0,1fr)]"
          >
            <span className="text-muted-foreground">{row.label}</span>
            <span className="min-w-0 truncate text-foreground">
              {row.value}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-3.5 py-3.5">
        <img
          src="/icp-brasil.svg"
          alt="ICP-Brasil"
          className="h-7 w-auto shrink-0 dark:hidden"
          draggable={false}
        />
        <img
          src="/icp-brasil-dark.svg"
          alt="ICP-Brasil"
          className="hidden h-7 w-auto shrink-0 dark:block"
          draggable={false}
        />
        <div className="min-w-0 text-right text-xs text-muted-foreground">
          <span className="text-foreground/80">hash a3f1…e9b7</span>
          <br />
          <span className="opacity-70">versão aprovada · imutável</span>
        </div>
      </div>
    </div>
  );
}

const portalRows = [
  {
    id: "CC-2026-0231",
    inst: "Balança analítica AS-220",
    ok: true,
    label: "Vigente",
  },
  {
    id: "CC-2026-0224",
    inst: "Termômetro digital Fluke 1551",
    ok: true,
    label: "Vigente",
  },
  {
    id: "CC-2026-0219",
    inst: "Paquímetro digital 0–150 mm",
    ok: false,
    label: "37 dias",
  },
  {
    id: "CC-2025-1188",
    inst: "Manômetro 0–10 bar",
    ok: false,
    label: "12 dias",
  },
];

function PortalPreview() {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border/80 bg-card/60 px-3.5 py-2.5">
        <span className="size-2 rounded-full bg-foreground/20" />
        <span className="size-2 rounded-full bg-foreground/20" />
        <span className="size-2 rounded-full bg-foreground/20" />
        <span className="min-w-0 flex-1 text-center font-mono text-xs text-muted-foreground">
          portal · cliente: Indústria São José Ltda.
        </span>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border/60 px-3 py-4.5 sm:px-5">
        <div className="text-sm font-semibold">Certificados ativos</div>
        <div className="min-w-0 text-right font-mono text-xs text-muted-foreground">
          Mariana, Qualidade
        </div>
      </div>
      <div className="py-2">
        {portalRows.map((row, index) => (
          <div
            key={row.id}
            className={cn(
              "grid grid-cols-[88px_minmax(0,1fr)_auto_12px] items-center gap-2 px-3 py-3 text-sm sm:grid-cols-[110px_minmax(0,1fr)_auto_16px] sm:gap-3.5 sm:px-5",
              index < portalRows.length - 1 && "border-b border-border/40",
            )}
          >
            <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
              {row.id}
            </span>
            <span className="min-w-0 text-foreground">{row.inst}</span>
            <span
              className={cn(
                "shrink-0 rounded px-2 py-1 font-mono text-xs tracking-wider uppercase",
                row.ok
                  ? "bg-emerald-500/15 text-emerald-500"
                  : "bg-amber-500/15 text-amber-500",
              )}
            >
              {row.label}
            </span>
            <span className="text-muted-foreground">
              <HugeiconsIcon icon={ArrowRight01Icon} className="size-3" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

type Severity = "crit" | "warn" | "ok";

const agendaRows: {
  type: "PADRÃO" | "CLIENTE";
  id: string;
  label: string;
  days: number;
  severity: Severity;
}[] = [
  {
    type: "PADRÃO",
    id: "PR-MASS-08",
    label: "Padrão massa 1 kg classe E2",
    days: -3,
    severity: "crit",
  },
  {
    type: "PADRÃO",
    id: "PR-TEMP-02",
    label: "Termorresistência Pt-100",
    days: 8,
    severity: "crit",
  },
  {
    type: "CLIENTE",
    id: "CC-2026-0118",
    label: "Pharma Indústria · Balança AS-220",
    days: 22,
    severity: "warn",
  },
  {
    type: "PADRÃO",
    id: "PR-PRES-01",
    label: "Padrão pressão 10 bar",
    days: 35,
    severity: "warn",
  },
  {
    type: "CLIENTE",
    id: "CC-2026-0224",
    label: "ACME Met. · Termômetro Fluke",
    days: 54,
    severity: "ok",
  },
  {
    type: "CLIENTE",
    id: "CC-2026-0231",
    label: "São José Ind. · Balança AS-220",
    days: 87,
    severity: "ok",
  },
];

function formatDays(days: number) {
  if (days < 0) {
    const abs = Math.abs(days);
    return `venceu há ${abs} ${abs === 1 ? "dia" : "dias"}`;
  }
  if (days === 0) return "vence hoje";
  if (days === 1) return "1 dia";
  return `${days} dias`;
}

const severityBar: Record<Severity, string> = {
  crit: "bg-destructive",
  warn: "bg-amber-500",
  ok: "bg-emerald-500/60",
};
const severityWhen: Record<Severity, string> = {
  crit: "text-destructive font-medium",
  warn: "text-amber-500",
  ok: "text-muted-foreground",
};

function ExpirationsAgenda() {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-border bg-card">
      <div className="flex min-w-0 items-center gap-2.5 border-b border-border/80 bg-background/50 px-3 py-3 sm:px-4">
        <HugeiconsIcon
          icon={Calendar03Icon}
          className="size-3.5 text-muted-foreground"
        />
        <span className="min-w-0 flex-1 text-sm font-medium">
          Próximos vencimentos · 90 dias
        </span>
        <span className="shrink-0 rounded bg-destructive/15 px-2.5 py-1 font-mono text-xs tracking-wider text-destructive uppercase">
          2 críticos
        </span>
      </div>

      <div className="py-1">
        {agendaRows.map((row, index) => (
          <div
            key={row.id}
            className={cn(
              "relative grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 px-3 py-3 text-sm sm:grid-cols-[76px_110px_minmax(0,1fr)_auto] sm:gap-3.5 sm:px-4",
              index < agendaRows.length - 1 && "border-b border-border/40",
            )}
          >
            <span
              className={cn(
                "absolute inset-y-0 left-0 w-1",
                severityBar[row.severity],
              )}
            />
            <span
              className={cn(
                "rounded px-2 py-1 text-center font-mono text-xs tracking-wider uppercase",
                row.type === "PADRÃO"
                  ? "bg-amber-500/15 text-amber-500"
                  : "bg-muted-foreground/15 text-muted-foreground",
              )}
            >
              {row.type}
            </span>
            <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
              {row.id}
            </span>
            <span className="col-span-2 min-w-0 text-foreground sm:col-span-1">
              {row.label}
            </span>
            <span
              className={cn(
                "col-start-3 row-start-1 text-right font-mono text-xs tabular-nums sm:col-start-auto sm:row-start-auto",
                severityWhen[row.severity],
              )}
            >
              {formatDays(row.days)}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-4.5 border-t border-border/60 px-4 py-3 font-mono text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <HugeiconsIcon
            icon={AlertCircleIcon}
            className="size-3 text-amber-500"
          />
          Padrões do laboratório
        </span>
        <span className="flex items-center gap-1.5">
          <HugeiconsIcon
            icon={UserGroupIcon}
            className="size-3 text-muted-foreground"
          />
          Equipamentos do cliente
        </span>
      </div>
    </div>
  );
}
