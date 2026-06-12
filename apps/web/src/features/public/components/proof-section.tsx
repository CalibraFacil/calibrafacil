import { Reveal } from './reveal'

export function ProofSection() {
  return (
    <section id="prova" className="border-t border-border/70 py-20">
      <div className="mx-auto max-w-[1200px] px-6 md:px-8">
        <Reveal>
          <div className="mx-auto flex max-w-[560px] flex-col items-center gap-5 text-center">
            <img
              src="/exemplo-black.svg"
              alt="Laboratório Exemplo"
              className="h-7 w-auto opacity-70 dark:hidden"
              draggable={false}
            />
            <img
              src="/exemplo-negativo.svg"
              alt="Laboratório Exemplo"
              className="hidden h-7 w-auto opacity-70 dark:block"
              draggable={false}
            />
            <p className="max-w-[52ch] text-sm leading-relaxed text-pretty text-muted-foreground">
              <span className="font-medium text-foreground">
                Em produção na Laboratório Exemplo.
              </span>{' '}
              Calibração de massa, com o motor de incerteza validado ponto a
              ponto contra a planilha de referência do próprio laboratório.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
