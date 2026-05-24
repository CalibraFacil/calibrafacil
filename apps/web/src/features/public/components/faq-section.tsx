import { useState } from 'react'

import { cn } from '@/lib/utils'

import { SectionHeading } from './landing-primitives'

const faqItems = [
  {
    q: 'O cálculo de incerteza segue o JCGM 100:2008 (GUM)?',
    a: 'Sim. O motor implementa contribuições Tipo A e Tipo B, composição quadrática e fator de abrangência. Cada componente fica registrado no memorial, com referência ao item que o originou (certificado do padrão, resolução do instrumento, repetibilidade medida).',
  },
  {
    q: 'Como funciona o modelo do certificado?',
    a: 'O layout do certificado é uma planilha Excel (.xlsx) que o próprio laboratório edita. Você posiciona logo, cabeçalho, tabelas, assinatura. Onde precisa de dado dinâmico, escreve uma variável nomeada (ex.: {{cliente}}, {{u_expandida}}). Na emissão, o sistema preenche e gera o PDF. Permite múltiplos modelos por escopo (massa, temperatura, etc.).',
  },
  {
    q: 'O que muda quando uma calibração é aprovada?',
    a: 'A aprovação congela o certificado e todas as evidências referenciadas (memorial GUM, certificados dos padrões usados, condições ambientais, identidade do signatário). A partir desse momento, a versão aprovada não pode mais ser editada. Se for preciso corrigir, o sistema gera uma nova revisão; a versão original permanece exatamente como foi assinada.',
  },
  {
    q: 'Como funciona o controle de acesso?',
    a: 'Cada organização entra com seus próprios usuários e não enxerga dados de outra. É o padrão, não uma configuração opcional. Dentro da organização, cada usuário tem um papel (técnico, revisor, signatário, administrador) que define o que ele pode ver, criar, revisar e aprovar.',
  },
  {
    q: 'O sistema atende laboratórios e oficinas no mesmo cadastro?',
    a: 'Não. Cada organização declara seu escopo (laboratório acreditado, oficina permissionária, ou ambos como entidades separadas) e o sistema apresenta o fluxo correspondente. Grupos com mais de uma unidade usam organizações distintas, isoladas por padrão.',
  },
  {
    q: 'Onde os dados ficam armazenados?',
    a: 'Em servidores hospedados no Brasil. Nenhum dado é compartilhado com terceiros nem usado para treinar modelos de IA. Backup diário e em conformidade com a LGPD.',
  },
  {
    q: 'Como funciona durante uma auditoria?',
    a: 'O avaliador recebe um acesso somente-leitura, com escopo limitado e tempo definido. A trilha de auditoria já registra tudo que foi feito antes. Você não "prepara documentação para auditoria"; você concede acesso ao que já está registrado.',
  },
  {
    q: 'Os certificados têm assinatura digital?',
    a: 'O signatário do certificado é identificado pelo sistema (nome e perfil) e a aprovação fica vinculada à conta dele. Integração com assinadores externos (ICP-Brasil) é tratada caso a caso na implantação.',
  },
]

export function FAQSection() {
  const [open, setOpen] = useState(0)

  return (
    <section id="perguntas" className="border-t border-border/70 py-24">
      <div className="mx-auto max-w-[1200px] px-6 md:px-8">
        <SectionHeading
          center
          title="Perguntas frequentes"
          lead="O que a sua área de qualidade vai querer saber antes da demonstração."
        />

        <div className="mx-auto grid max-w-[880px]">
          {faqItems.map((item, index) => {
            const isOpen = open === index
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
                        'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-muted-foreground transition-transform duration-200',
                        isOpen && 'scale-y-0',
                      )}
                    />
                  </span>
                </button>
                {isOpen && (
                  <div className="max-w-[70ch] pb-6 pl-8 text-sm leading-relaxed text-muted-foreground">
                    {item.a}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
