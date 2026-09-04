"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

import { Reveal } from "./reveal";
import {
  NumberedPoints,
  SectionHeading,
  type NumberedPoint,
} from "./landing-primitives";

type AudienceKey = "rbc" | "oficinas";

type Audience = {
  key: AudienceKey;
  short: string;
  tag: string;
  title: string;
  lead: string;
  image: string;
  alt: string;
  items: readonly NumberedPoint[];
};

const audiences: Record<AudienceKey, Audience> = {
  rbc: {
    key: "rbc",
    short: "Laboratórios acreditados",
    tag: "Acreditação Cgcre",
    title: "Para laboratórios sob acreditação Cgcre.",
    lead: "O sistema gerencia a evidência exigida pelo escopo acreditado. Sem planilha solta, sem documentação avulsa.",
    image: "/landing/audience-rbc.webp",
    alt: "Laboratório de calibração acreditado",
    items: [
      [
        "01",
        "Cálculo de incerteza no sistema",
        "O orçamento de incerteza fica ligado ao método e ao certificado, não em planilha à parte. Cada contribuição é rastreável até a sua origem.",
      ],
      [
        "02",
        "Auditoria sem retrabalho",
        'Quando o avaliador pede evidência, você abre o sistema. Tudo registrado com autor, data e signatário. Não tem o que "preparar".',
      ],
      [
        "03",
        "Defensabilidade da emissão",
        "O certificado aprovado não muda. Reedição vira nova revisão; a versão original continua exatamente como foi assinada.",
      ],
      [
        "04",
        "Rastreabilidade pronta",
        "Cada calibração liga ao certificado do padrão usado. A cadeia metrológica completa fica visível em uma tela.",
      ],
      [
        "05",
        "Cliente se serve sozinho",
        "Cliente baixa certificado, vê histórico do parque e o que está vencendo. Menos email pedindo documento, menos tempo da sua equipe reagindo a chamado.",
      ],
    ],
  },
  oficinas: {
    key: "oficinas",
    short: "Oficinas permissionárias",
    tag: "Portaria Inmetro nº 157",
    title: "Para oficinas autorizadas pelo Inmetro.",
    lead: "Registra cada verificação e cada marca de selagem, no formato que a fiscalização pede. Sem montar planilha pra inspeção.",
    image: "/landing/audience-oficinas.webp",
    alt: "Oficina permissionária do Inmetro",
    items: [
      [
        "01",
        "Marcas de selagem sob controle",
        "Numeração de marcas de selagem apostas e retiradas pelo sistema. Acaba o caderno avulso e a planilha pessoal. Cada marca rastreada até o instrumento.",
      ],
      [
        "02",
        "Histórico imediato",
        "Cada instrumento com a sua linha do tempo de verificações, reparos e proprietários. Achar histórico antigo deixa de ser arqueologia.",
      ],
      [
        "03",
        "Padronização entre técnicos",
        "Verificação inicial, periódica, eventual e reparo registradas no mesmo formato, com responsável e data. Não importa quem fez.",
      ],
      [
        "04",
        "Rastreabilidade comprovada",
        "Padrões e equipamentos usados ligados a cada serviço. Comprova a cadeia metrológica sem montar relatório à parte.",
      ],
      [
        "05",
        "Fiscalização sem dor",
        "Você concede acesso somente-leitura ao fiscal do Inmetro. A documentação que ele pede já está toda lá.",
      ],
    ],
  },
};

const audienceList = [audiences.rbc, audiences.oficinas];

export function AudienceSection() {
  const [active, setActive] = useState<AudienceKey>("rbc");
  const current = audiences[active];

  return (
    <section id="audiencias" className="border-t border-border/70 py-24">
      <div className="mx-auto max-w-[1200px] px-6 md:px-8">
        <SectionHeading
          title="Dois mercados regulados. Escolha o seu."
          lead="A regulamentação brasileira reúne duas realidades: laboratórios sob acreditação científica e oficinas permissionárias do Inmetro. O CalibraFácil tem módulos próprios para cada uma; cada organização entra no fluxo que corresponde ao seu escopo."
        />

        <Reveal delay={0.08}>
          <div className="relative isolate aspect-[16/7] min-h-[360px] w-full overflow-hidden rounded-2xl bg-muted">
            {audienceList.map((audience) => (
              <img
                key={audience.key}
                src={audience.image}
                alt={audience.alt}
                aria-hidden={active !== audience.key}
                loading="lazy"
                className={cn(
                  "absolute inset-0 z-[0] size-full object-cover transition-opacity duration-500",
                  active === audience.key ? "opacity-100" : "opacity-0",
                )}
              />
            ))}

            <div
              aria-hidden
              className="absolute inset-0 z-[1] [background:linear-gradient(180deg,rgba(8,11,18,0.15)_0%,rgba(8,11,18,0.35)_40%,rgba(8,11,18,0.85)_100%),linear-gradient(90deg,rgba(8,11,18,0.55)_0%,rgba(8,11,18,0.10)_50%,rgba(8,11,18,0)_100%)]"
            />

            <div className="absolute inset-x-0 top-5 z-[3] flex justify-center px-4 md:top-7">
              <div
                role="group"
                aria-label="Audiência"
                className="relative grid grid-cols-2 rounded-full border border-white/10 bg-[rgba(15,18,25,0.55)] p-1 backdrop-blur-xl"
              >
                {/* Placed in the grid rather than sized with a percentage so the
                    highlight always matches the real width and height of the
                    active column, whatever the labels measure. */}
                <span
                  aria-hidden
                  className={cn(
                    "col-start-1 row-start-1 rounded-full bg-white/15 transition-transform duration-300 ease-in-out",
                    active === "oficinas"
                      ? "translate-x-full"
                      : "translate-x-0",
                  )}
                />
                {audienceList.map((audience, index) => (
                  <button
                    key={audience.key}
                    type="button"
                    aria-pressed={active === audience.key}
                    onClick={() => setActive(audience.key)}
                    className={cn(
                      "relative z-[1] row-start-1 rounded-full px-3 py-2 text-center text-xs leading-tight font-medium text-balance transition-colors sm:px-5 sm:py-2.5 sm:text-sm",
                      index === 0 ? "col-start-1" : "col-start-2",
                      active === audience.key ? "text-white" : "text-white/70",
                    )}
                  >
                    {audience.short}
                  </button>
                ))}
              </div>
            </div>

            <div
              key={current.key}
              className="absolute inset-x-0 bottom-0 z-[2] max-w-[720px] p-9 text-white motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-300 md:px-14 md:py-13"
            >
              <span className="inline-flex items-center gap-1.5 rounded border border-white/20 bg-[rgba(15,18,25,0.35)] px-2.5 py-1 font-mono text-xs tracking-wider text-white/80 uppercase backdrop-blur">
                {current.tag}
              </span>
              <h3 className="mt-3.5 mb-3 text-[clamp(26px,3.2vw,38px)] leading-[1.1] font-semibold tracking-tight text-white [text-shadow:0_2px_18px_rgba(0,0,0,0.35)]">
                {current.title}
              </h3>
              <p className="max-w-[56ch] text-base leading-normal text-white/85 [text-shadow:0_1px_12px_rgba(0,0,0,0.3)]">
                {current.lead}
              </p>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.14}>
          <div
            key={current.key}
            className="mt-9 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300"
          >
            <NumberedPoints items={current.items} columns={2} />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
