import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  FingerPrintIcon,
  Layers01Icon,
  LockIcon,
  SecurityCheckIcon,
  ShieldKeyIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";

import { SectionHeading } from "./surfaces";

// Mechanisms the product enforces at runtime, stated as mechanisms.
const PILLARS: { icon: IconSvgElement; title: string; body: string }[] = [
  {
    icon: LockIcon,
    title: "Versão aprovada imutável",
    body: "A aprovação congela leituras, padrões, orçamento de incerteza, signatário e PDF. O que existe depois é retificação, com nova versão e a anterior preservada.",
  },
  {
    icon: ShieldKeyIcon,
    title: "Assinatura ICP-Brasil A1",
    body: "PDF assinado no padrão PAdES com o certificado digital do laboratório, guardado cifrado, com carimbo de tempo. A verificação pública valida assinatura, cadeia e revogação.",
  },
  {
    icon: FingerPrintIcon,
    title: "Cálculo reproduzível",
    body: "Cada resultado registra a versão do motor e uma impressão digital dos dados de entrada. O mesmo cálculo pode ser conferido depois.",
  },
  {
    icon: UserGroupIcon,
    title: "Papéis distintos",
    body: "Executar, revisar e aprovar são permissões de papéis diferentes. Membro, operador, técnico, administrador e proprietário têm alcances próprios.",
  },
  {
    icon: SecurityCheckIcon,
    title: "Isolamento por organização e unidade",
    body: "Cada laboratório vê apenas os próprios dados, cada unidade os seus, e cada cliente do portal só o que é dele.",
  },
  {
    icon: Layers01Icon,
    title: "Bloqueios na origem",
    body: "Padrão vencido não é vinculado. Pessoa sem competência registrada não é atribuída. O sistema impede, em vez de apontar depois.",
  },
];

export function TrustSection() {
  return (
    <section
      id="fundamentos"
      className="scroll-mt-20 border-t border-border bg-[linear-gradient(180deg,var(--muted)_0%,var(--background)_100%)] py-24 md:py-32"
    >
      <div className="mx-auto max-w-[1200px] px-6 md:px-8">
        <SectionHeading
          title="Confiança vem do mecanismo."
          body="O CalibraFácil não substitui o responsável técnico, o sistema de gestão da qualidade nem a decisão técnica. Ele estrutura o registro para que essas decisões fiquem documentadas, rastreáveis e reproduzíveis."
        />

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map((pillar) => (
            <div
              key={pillar.title}
              className="rounded-2xl border border-border bg-card p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
            >
              <span className="flex size-9 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-300">
                <HugeiconsIcon
                  icon={pillar.icon}
                  className="size-[18px]"
                  strokeWidth={1.75}
                />
              </span>
              <h3 className="mt-4 text-[16px] font-semibold tracking-[-0.01em] text-foreground">
                {pillar.title}
              </h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
                {pillar.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
