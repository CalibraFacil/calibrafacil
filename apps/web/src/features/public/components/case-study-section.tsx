import { HugeiconsIcon } from '@hugeicons/react'
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'

import { Reveal } from './reveal'
import { BlueprintGrid } from './hero'

const caseMeta = [
  'Motor validado contra planilha de referência',
  'Calibração de massa',
  'Certificados em produção',
]

export function CaseStudySection() {
  return (
    <section
      id="caso"
      className="relative isolate overflow-hidden border-t border-border/70 py-24"
    >
      <BlueprintGrid fine />

      <div className="relative z-[1] mx-auto max-w-[1200px] px-6 md:px-8">
        <Reveal>
          <div className="mx-auto max-w-[860px] rounded-2xl border border-border bg-card/60 p-8 text-center sm:p-12">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-xs tracking-wider text-emerald-600 uppercase dark:text-emerald-400">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-3" />
              Em produção
            </span>

            <h2 className="mt-5 text-[clamp(28px,3.6vw,44px)] leading-[1.1] font-semibold tracking-tight text-balance">
              Em operação na Laboratório Exemplo.
            </h2>

            <p className="mx-auto mt-4 max-w-[60ch] text-lg leading-relaxed text-pretty text-muted-foreground">
              Não é piloto nem prova de conceito. O CalibraFácil emite
              certificados de calibração de massa na rotina de um laboratório
              real — com o motor de incerteza validado ponto a ponto contra a
              planilha de referência do próprio laboratório.
            </p>

            <div className="mt-8 flex items-center justify-center">
              <img
                src="/exemplo-positivo.svg"
                alt="Laboratório Exemplo"
                className="h-9 w-auto dark:hidden"
                draggable={false}
              />
              <img
                src="/exemplo-negativo.svg"
                alt="Laboratório Exemplo"
                className="hidden h-9 w-auto dark:block"
                draggable={false}
              />
            </div>

            <div className="mt-7 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 font-mono text-xs text-muted-foreground">
              {caseMeta.map((item, index) => (
                <div key={item} className="flex items-center gap-3">
                  {index > 0 && (
                    <span className="size-1 rounded-full bg-foreground/30" />
                  )}
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
