import { Reveal } from './reveal'
import {
  NumberedPoints,
  SectionHeading,
  type NumberedPoint,
} from './landing-primitives'

const steps: readonly NumberedPoint[] = [
  [
    '01',
    'Rascunho',
    'Técnico registra leituras, anexa padrões usados e monta o orçamento de incerteza. Toda edição fica registrada com autor e data/hora, sem ação manual.',
  ],
  [
    '02',
    'Revisão',
    'Revisor confere o orçamento de incerteza, padrões usados e condições ambientais. Pode pedir correção ou aprovar. O autor não consegue aprovar o próprio trabalho.',
  ],
  [
    '03',
    'Aprovado',
    'A aprovação congela tudo: certificado, orçamento de incerteza, padrões usados e identidade do signatário viram um pacote imutável. Reedição gera uma nova revisão; a versão aprovada continua exatamente como foi assinada.',
  ],
]

export function WorkflowSection() {
  return (
    <section id="fluxo" className="border-t border-border/70 py-24">
      <div className="mx-auto max-w-[1200px] px-6 md:px-8">
        <SectionHeading
          title="A documentação já está pronta quando o auditor chegar."
          lead="Toda calibração passa por três estados: Rascunho, Revisão e Aprovado. Quem cria não aprova; quem aprova assina. A versão aprovada não pode ser editada e vira a evidência que o auditor consulta."
        />
        <Reveal delay={0.08}>
          <NumberedPoints items={steps} columns={3} />
        </Reveal>
      </div>
    </section>
  )
}
