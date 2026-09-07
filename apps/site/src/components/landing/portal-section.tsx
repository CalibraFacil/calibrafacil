import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";

import { Chip, panel, SectionHeading } from "./surfaces";

const FLEET = [
  {
    label: "Vencidas",
    value: "1",
    tone: "text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-500/12",
  },
  {
    label: "Vencem em breve",
    value: "2",
    tone: "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/12",
  },
  {
    label: "Em dia",
    value: "8",
    tone: "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/12",
  },
  {
    label: "No laboratório",
    value: "1",
    tone: "text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/15",
  },
];

const ASSETS = [
  {
    name: "Balança analítica",
    tag: "BAL-07",
    due: "08/2027",
    state: "Em dia",
    tone: "ok",
  },
  {
    name: "Paquímetro digital",
    tag: "PAQ-02",
    due: "09/2026",
    state: "Vence em breve",
    tone: "warn",
  },
  {
    name: "Manômetro",
    tag: "MAN-11",
    due: "07/2026",
    state: "Vencida",
    tone: "bad",
  },
] as const;

const CHECKS = [
  "Conteúdo",
  "Assinatura",
  "Cadeia ICP-Brasil",
  "Validade",
  "Carimbo do tempo",
  "Revogação (LCR)",
];

const POINTS = [
  {
    title: "Frota e vencimentos",
    body: "Status de cada equipamento por unidade ou consolidado. O cliente vê o que vence antes de você precisar avisar.",
  },
  {
    title: "Certificados aprovados, só eles",
    body: "Download do PDF assinado e link de verificação. Rascunho nunca aparece do lado do cliente.",
  },
  {
    title: "Solicitações e orçamentos",
    body: "O cliente abre a solicitação, individual ou em lote, e aprova o orçamento da ordem de serviço por link.",
  },
  {
    title: "Verificação pública",
    body: "Quem receber o PDF confere, sem login, se o arquivo corresponde à versão aprovada e se ela ainda é a vigente.",
  },
];

export function PortalSection() {
  return (
    <section
      id="portal"
      className="scroll-mt-20 border-t border-border bg-[linear-gradient(180deg,var(--muted)_0%,var(--background)_100%)] py-24 md:py-32"
    >
      <div className="mx-auto max-w-[1200px] px-6 md:px-8">
        <SectionHeading
          title="O cliente acompanha pelo portal, com o mesmo registro."
          body="A calibração não termina quando o laboratório termina. O cliente entra com o acesso que você concede e vê o parque de equipamentos, os certificados aprovados e o que está vencendo."
        />

        <div className="mt-12 grid items-start gap-10 lg:grid-cols-12 lg:gap-12">
          <div className="relative min-w-0 lg:col-span-7 lg:min-h-[470px]">
            <FleetPanel className="relative z-[1] w-full max-w-[560px]" />
            <VerificationPanel className="mt-4 w-full max-w-[440px] lg:absolute lg:top-[318px] lg:right-0 lg:mt-0 lg:z-[2]" />
          </div>

          <dl className="grid min-w-0 gap-6 lg:col-span-5 lg:pt-2">
            {POINTS.map((point) => (
              <div key={point.title} className="grid gap-1">
                <dt className="text-[16px] font-semibold tracking-[-0.01em] text-foreground">
                  {point.title}
                </dt>
                <dd className="text-[15px] leading-relaxed text-muted-foreground">
                  {point.body}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

function FleetPanel({ className }: { className?: string }) {
  return (
    <div className={cn(panel, "overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <p className="text-[11.5px] text-muted-foreground">
            Portal do cliente
          </p>
          <p className="text-[14px] font-medium text-foreground">
            Metalúrgica Santa Rita Ltda.
          </p>
        </div>
        <span className="text-[12px] text-muted-foreground">
          12 equipamentos
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
        {FLEET.map((item) => (
          <div
            key={item.label}
            className={cn("rounded-lg px-3 py-2.5", item.tone)}
          >
            <p className="text-[11px] font-medium opacity-80">{item.label}</p>
            <p className="mt-0.5 text-[20px] font-semibold tracking-tight tabular-nums">
              {item.value}
            </p>
          </div>
        ))}
      </div>
      <ul className="divide-y divide-border border-t border-border">
        {ASSETS.map((asset) => (
          <li
            key={asset.tag}
            className="flex items-center justify-between gap-3 px-4 py-2.5 text-[12.5px]"
          >
            <span className="min-w-0 truncate text-foreground">
              {asset.name}{" "}
              <span className="font-mono text-[11.5px] text-muted-foreground">
                · {asset.tag}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
                {asset.due}
              </span>
              <Chip tone={asset.tone}>{asset.state}</Chip>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VerificationPanel({ className }: { className?: string }) {
  return (
    <div className={cn(panel, "overflow-hidden", className)}>
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="flex size-8 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            className="size-5"
            strokeWidth={2}
          />
        </span>
        <div className="min-w-0">
          <p className="text-[11.5px] text-muted-foreground">
            Verificação pública
          </p>
          <p className="text-[14px] font-medium text-emerald-700 dark:text-emerald-400">
            Certificado autêntico
          </p>
        </div>
        <span className="ml-auto font-mono text-[11.5px] tabular-nums text-muted-foreground">
          CAL-2026-0231
        </span>
      </div>
      <ul className="grid grid-cols-2 gap-px bg-border">
        {CHECKS.map((check) => (
          <li
            key={check}
            className="flex items-center justify-between gap-2 bg-card px-4 py-2 text-[12px]"
          >
            <span className="text-muted-foreground">{check}</span>
            <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">
              OK
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
