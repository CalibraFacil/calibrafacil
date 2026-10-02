import type { ComponentType, SVGProps } from "react";

import {
  ApiIcon,
  CapaIcon,
  CompetenceIcon,
  ControlChartIcon,
  FinanceIcon,
  LabelIcon,
  MethodIcon,
  OfflineIcon,
  PortalIcon,
  ProficiencyIcon,
  RecallIcon,
  SealIcon,
  UnitsIcon,
  VerifyIcon,
  WeightIcon,
  WorkOrderIcon,
} from "./coverage-icons";
import { SectionHeading } from "./surfaces";

// Everything the lab carries besides the calibration itself. Each item is a
// module that exists in the codebase today.
const MODULES: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  body: string;
}[] = [
  {
    icon: WeightIcon,
    title: "Padrões de referência",
    body: "Certificado, validade, status e recall com os certificados impactados.",
  },
  {
    icon: RecallIcon,
    title: "Vencimentos e recall",
    body: "Fila do que vence em 7, 30 e 90 dias, para o laboratório e para o cliente.",
  },
  {
    icon: WorkOrderIcon,
    title: "Ordens de serviço",
    body: "Avaliação técnica, orçamento com peças, execução, entrega e garantia.",
  },
  {
    icon: CapaIcon,
    title: "Não conformidades e CAPA",
    body: "Registro, análise de impacto, ações corretivas e fechamento.",
  },
  {
    icon: ProficiencyIcon,
    title: "Ensaios de proficiência",
    body: "Rodadas interlaboratoriais planejadas e registradas com os resultados.",
  },
  {
    icon: ControlChartIcon,
    title: "Controle estatístico",
    body: "Cartas de controle com padrões de verificação para acompanhar o processo.",
  },
  {
    icon: CompetenceIcon,
    title: "Pessoal e competências",
    body: "Competências com validade e trilha. Sem competência, sem atribuição.",
  },
  {
    icon: MethodIcon,
    title: "Métodos",
    body: "Catálogo por grandeza e editor de métodos próprios, com versão e publicação.",
  },
  {
    icon: FinanceIcon,
    title: "Financeiro",
    body: "Contratos, documentos, previsão de caixa e integração com Conta Azul.",
  },
  {
    icon: LabelIcon,
    title: "Etiquetas",
    body: "Etiquetas de calibração em impressora térmica, USB ou serial.",
  },
  {
    icon: UnitsIcon,
    title: "Unidades e grupos",
    body: "Várias unidades do laboratório e grupos de clientes com visão consolidada.",
  },
  {
    icon: OfflineIcon,
    title: "Trabalho sem internet",
    body: "Aplicativo para desktop com banco local e sincronização ao reconectar.",
  },
  {
    icon: PortalIcon,
    title: "Portal do cliente",
    body: "Equipamentos, vencimentos e certificados do cliente, pedidos de calibração e aprovação de orçamentos.",
  },
  {
    icon: SealIcon,
    title: "Metrologia legal",
    body: "Regulamentos do Inmetro, marcas de selagem e reparo e comprovante de entrega para oficinas permissionárias.",
  },
  {
    icon: VerifyIcon,
    title: "Verificação pública",
    body: "Página e QR code que conferem a assinatura, a cadeia e a revogação de cada certificado emitido.",
  },
  {
    icon: ApiIcon,
    title: "API e webhooks",
    body: "API pública com chaves por escopo e webhooks assinados para integrar outros sistemas.",
  },
];

export function CoverageSection() {
  return (
    <section id="modulos" className="scroll-mt-20 py-24 md:py-32">
      <div className="mx-auto max-w-[1200px] px-6 md:px-8">
        <SectionHeading
          title="Os módulos do sistema."
          body="A calibração é o centro, não o limite. Padrões, vencimentos, qualidade, pessoal, financeiro, o portal do cliente e o trabalho em campo usam o mesmo registro."
        />

        <ul className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((module) => (
            <li key={module.title} className="bg-card p-6">
              <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-muted text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
                <module.icon className="size-5" />
              </span>
              <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                {module.title}
              </h3>
              <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
                {module.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
