import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  ArrowRight01Icon,
  Calendar03Icon,
  Certificate01Icon,
  CheckmarkCircle02Icon,
  Table01Icon,
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
          lead="Quatro blocos sustentam a operação diária e a defesa em auditoria: geração do certificado a partir do modelo do laboratório, assinatura digital ICP-Brasil ligada à versão imutável, portal restrito ao cliente final e gestão proativa de vencimentos."
        />

        <FeatureCertificate />
        <FeatureSignature />
        <FeaturePortal />
        <FeatureExpirations />
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
}: {
  title: string;
  lead: React.ReactNode;
  bullets: readonly string[];
  visual: React.ReactNode;
  reverse?: boolean;
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
          <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card p-3 shadow-xl sm:p-6">
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

function FeatureCertificate() {
  return (
    <Feature
      title="Cada laboratório edita o próprio certificado. Em Excel mesmo."
      lead={
        <>
          O Excel (ou LibreOffice) é só o layout visual — onde o laboratório
          posiciona logo, cabeçalho e tabelas, sem aprender ferramenta nova nem
          depender de fornecedor pra cada ajuste. O que conta para a ISO/IEC
          17025 não mora nele: o cálculo e a evidência ficam no sistema
          imutável, e o que vale juridicamente é o PDF congelado e assinado na
          aprovação. O CalibraFácil preenche as variáveis nomeadas (
          <CodeChip>{"{{cliente}}"}</CodeChip>,{" "}
          <CodeChip>{"{{u_expandida}}"}</CodeChip>) e gera esse PDF — o template
          Excel nunca é o documento controlado.
        </>
      }
      bullets={[
        "O modelo Excel define só a aparência do certificado: logo, cabeçalho, tabelas, posição da assinatura",
        "O documento controlado é o PDF congelado e assinado, não a planilha. O controle de documentos da ISO/IEC 17025 vive no sistema.",
        "Múltiplos modelos por escopo (massa, temperatura, pressão, dimensional)",
        "Variáveis nomeadas pra cada dado de calibração. Sem cópia manual, sem erro de digitação.",
        "PDF gerado na aprovação, congelado e assinado em ICP-Brasil. A versão aprovada não muda.",
      ]}
      visual={<XlsxTemplate />}
    />
  );
}

function FeatureSignature() {
  return (
    <Feature
      reverse
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

const xlsxCell =
  "flex min-h-8 min-w-0 items-center overflow-hidden border-r border-b border-border/40 px-2 py-2 text-xs sm:px-2.5";
const xlsxHead =
  "flex min-h-6 min-w-0 items-center justify-center border-r border-b border-border/40 bg-muted/50 px-2 py-1.5 text-xs tracking-wider text-muted-foreground";

function Var({ children }: { children: React.ReactNode }) {
  return <span className="text-primary">{children}</span>;
}

function XlsxTemplate() {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-border bg-card font-mono text-xs">
      <div className="flex items-center gap-2.5 border-b border-border/80 bg-background/50 px-3.5 py-2.5">
        <HugeiconsIcon
          icon={Table01Icon}
          className="size-3.5 text-emerald-500"
        />
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          modelo-balanca-analitica.xlsx
        </span>
        <span className="ml-auto hidden text-xs text-primary sm:inline">
          Certificado
        </span>
      </div>

      <div className="grid grid-cols-[60px_1fr] border-b border-border/60 text-xs">
        <div className="border-r border-border/60 bg-muted/50 px-2.5 py-1.5 text-muted-foreground italic">
          D7
        </div>
        <div className="px-3 py-1.5 text-foreground">
          <Var>{"{{u_expandida}}"}</Var>
        </div>
      </div>

      <div className="grid grid-cols-[28px_repeat(5,minmax(0,1fr))] sm:grid-cols-[32px_repeat(5,minmax(0,1fr))]">
        <div className={xlsxHead} />
        <div className={xlsxHead}>A</div>
        <div className={xlsxHead}>B</div>
        <div className={xlsxHead}>C</div>
        <div className={xlsxHead}>D</div>
        <div className={xlsxHead}>E</div>

        <div className={xlsxHead}>1</div>
        <div
          className={cn(
            xlsxCell,
            "col-span-5 justify-center text-center font-semibold whitespace-nowrap text-foreground",
          )}
        >
          CERTIFICADO DE CALIBRAÇÃO
        </div>

        <div className={xlsxHead}>2</div>
        <div className={cn(xlsxCell, "text-muted-foreground")}>Cliente</div>
        <div className={cn(xlsxCell, "col-span-2")}>
          <Var>{"{{cliente_nome}}"}</Var>
        </div>
        <div className={cn(xlsxCell, "text-muted-foreground")}>Nº</div>
        <div className={xlsxCell}>
          <Var>{"{{cc_numero}}"}</Var>
        </div>

        <div className={xlsxHead}>3</div>
        <div className={cn(xlsxCell, "text-muted-foreground")}>Instrumento</div>
        <div className={cn(xlsxCell, "col-span-2")}>
          <Var>{"{{instrumento}}"}</Var>
        </div>
        <div className={cn(xlsxCell, "text-muted-foreground")}>Série</div>
        <div className={xlsxCell}>
          <Var>{"{{ns}}"}</Var>
        </div>

        <div className={xlsxHead}>4</div>
        <div className={cn(xlsxCell, "text-muted-foreground")}>Faixa</div>
        <div className={xlsxCell}>
          <Var>{"{{faixa}}"}</Var>
        </div>
        <div className={cn(xlsxCell, "text-muted-foreground")}>Resolução</div>
        <div className={cn(xlsxCell, "col-span-2")}>
          <Var>{"{{resolucao}}"}</Var>
        </div>

        <div className={xlsxHead}>5</div>
        <div className={cn(xlsxCell, "text-muted-foreground")}>Temperatura</div>
        <div className={xlsxCell}>
          <Var>{"{{temp_amb}}"}</Var>
        </div>
        <div className={cn(xlsxCell, "text-muted-foreground")}>Umidade</div>
        <div className={cn(xlsxCell, "col-span-2")}>
          <Var>{"{{umid_amb}}"}</Var>
        </div>

        <div className={xlsxHead}>6</div>
        <div className={cn(xlsxCell, "text-muted-foreground")}>
          Padrão usado
        </div>
        <div className={cn(xlsxCell, "col-span-2")}>
          <Var>{"{{padrao_id}}"}</Var>
        </div>
        <div className={cn(xlsxCell, "text-muted-foreground")}>Cert.</div>
        <div className={xlsxCell}>
          <Var>{"{{padrao_cert}}"}</Var>
        </div>

        <div className={xlsxHead}>7</div>
        <div className={cn(xlsxCell, "text-muted-foreground")}>Resultado</div>
        <div className={cn(xlsxCell, "text-xs text-muted-foreground")}>
          U (k=2)
        </div>
        <div className={cn(xlsxCell, "text-xs text-muted-foreground")}>±</div>
        <div
          className={cn(
            xlsxCell,
            "relative z-[2] bg-primary/12 outline-2 -outline-offset-2 outline-primary",
          )}
        >
          <Var>{"{{u_expandida}}"}</Var>
        </div>
        <div className={cn(xlsxCell, "text-xs text-muted-foreground")}>g</div>

        <div className={xlsxHead}>8</div>
        <div className={cn(xlsxCell, "text-muted-foreground")}>Signatário</div>
        <div className={cn(xlsxCell, "col-span-2")}>
          <Var>{"{{signatario_nome}}"}</Var>
        </div>
        <div className={cn(xlsxCell, "text-muted-foreground")}>Data</div>
        <div className={xlsxCell}>
          <Var>{"{{data_aprov}}"}</Var>
        </div>
      </div>

      <div className="grid grid-cols-1 items-center gap-4 px-3.5 py-3.5 sm:grid-cols-[1fr_auto_1fr]">
        <div className="min-w-0 text-xs text-muted-foreground">
          modelo.xlsx
          <br />
          <span className="text-xs opacity-70">
            editado pelo seu laboratório
          </span>
        </div>
        <div className="flex items-center justify-center gap-1.5 text-xs text-primary">
          preenche
          <HugeiconsIcon icon={ArrowRight01Icon} className="size-3.5" />
        </div>
        <div className="min-w-0 text-xs text-foreground sm:text-right">
          <span className="text-primary">CC-2026-0231.pdf</span>
          <br />
          <span className="text-xs text-muted-foreground opacity-70">
            versão aprovada · imutável
          </span>
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
