"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

import { SectionHeading } from "./landing-primitives";

const faqItems = [
  {
    q: "O cálculo de incerteza segue o JCGM 100:2008 (GUM)?",
    a: "Sim. O motor implementa contribuições Tipo A e Tipo B, composição quadrática e fator de abrangência. Cada componente fica registrado no orçamento de incerteza, com referência ao item que o originou (certificado do padrão, resolução do instrumento, repetibilidade medida).",
  },
  {
    q: "Como é o layout do certificado?",
    a: "O layout é do sistema — não há modelo para o laboratório montar nem manter. Ele foi construído campo a campo contra a ISO/IEC 17025 (7.8) e as exigências do Cgcre (NIT-DICLA-021, NIE-Cgcre-009): identificação do cliente e do item, datas, método, padrões e rastreabilidade, condições ambientais, resultados, incerteza, declaração de conformidade e signatário. O sistema preenche cada campo a partir da evidência registrada na calibração, aplica a regra de arredondamento da incerteza (A.6.3) e gera o PDF na aprovação. O laboratório entra com a própria identidade — logo, CNPJ, endereço — e o símbolo de acreditação só é impresso quando o escopo cobre o serviço. Seções que o método não usa simplesmente não aparecem.",
  },
  {
    q: "O que muda quando uma calibração é aprovada?",
    a: "A aprovação congela o certificado e todas as evidências referenciadas (orçamento de incerteza, certificados dos padrões usados, condições ambientais, identidade do signatário). A partir desse momento, a versão aprovada não pode mais ser editada. Se for preciso corrigir, o sistema gera uma nova revisão; a versão original permanece exatamente como foi assinada.",
  },
  {
    q: "Os certificados são assinados digitalmente com ICP-Brasil?",
    a: "Sim, de forma nativa. Na aprovação, o PDF é assinado com o certificado digital ICP-Brasil A1 (.p12/.pfx) do responsável técnico, no padrão PAdES — com carimbo de tempo (RFC-3161) e validação da cadeia até a AC-Raiz da ICP-Brasil. A assinatura fica embutida no próprio arquivo e cobre a versão congelada: qualquer alteração posterior quebra a validação. Cada unidade gerencia a própria carteira de certificados e define o padrão de assinatura.",
  },
  {
    q: "Como funciona o controle de acesso?",
    a: "Cada organização entra com seus próprios usuários e não enxerga dados de outra. É o padrão, não uma configuração opcional. Dentro da organização, cada usuário tem um papel (técnico, revisor, signatário, administrador) que define o que ele pode ver, criar, revisar e aprovar.",
  },
  {
    q: "O sistema atende laboratórios e oficinas no mesmo cadastro?",
    a: "Não. Cada organização declara seu escopo (laboratório acreditado, oficina permissionária, ou ambos como entidades separadas) e o sistema apresenta o fluxo correspondente. Grupos com mais de uma unidade usam organizações distintas, isoladas por padrão.",
  },
  {
    q: "Onde os dados ficam armazenados?",
    a: "Em servidores hospedados no Brasil. Nenhum dado é compartilhado com terceiros nem usado para treinar modelos de IA. Backup diário e em conformidade com a LGPD.",
  },
  {
    q: "Como funciona durante uma auditoria?",
    a: 'O avaliador recebe um acesso somente-leitura, com escopo limitado e tempo definido. A trilha de auditoria já registra tudo que foi feito antes. Você não "prepara documentação para auditoria"; você concede acesso ao que já está registrado.',
  },
];

// Google reads FAQPage structured data (not the visual accordion) to award FAQ
// rich results, so every answer is emitted here regardless of what's expanded.
const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqItems.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
};

export function FAQSection() {
  const [open, setOpen] = useState(0);

  return (
    <section id="perguntas" className="border-t border-border/70 py-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <div className="mx-auto max-w-[1200px] px-6 md:px-8">
        <SectionHeading
          center
          title="Perguntas frequentes"
          lead="O que a sua área de qualidade vai querer saber antes da demonstração."
        />

        <div className="mx-auto grid max-w-[880px]">
          {faqItems.map((item, index) => {
            const isOpen = open === index;
            return (
              <div
                key={item.q}
                className="border-t border-border/80 last:border-b last:border-border/80"
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? -1 : index)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 py-5 text-left text-base font-medium tracking-tight text-foreground"
                >
                  <span className="flex items-center">
                    <span className="mr-3.5 font-mono text-xs text-muted-foreground">
                      0{index + 1}
                    </span>
                    {item.q}
                  </span>
                  <span className="relative size-[18px] shrink-0">
                    <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-muted-foreground" />
                    <span
                      className={cn(
                        "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-muted-foreground transition-transform duration-200",
                        isOpen && "scale-y-0",
                      )}
                    />
                  </span>
                </button>
                {/* Every answer stays in the DOM (CSS-collapsed, not unmounted)
                    so crawlers and AI fetchers read all of them, not just the
                    expanded one. */}
                <div
                  className={cn(
                    "grid transition-[grid-template-rows] duration-200 ease-out",
                    isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                  )}
                >
                  <div className="overflow-hidden" aria-hidden={!isOpen}>
                    <div className="max-w-[70ch] pb-6 pl-8 text-sm leading-relaxed text-muted-foreground">
                      {item.a}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
