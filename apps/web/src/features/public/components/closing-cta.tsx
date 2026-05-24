import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon, BookOpen01Icon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'

import { Reveal } from './reveal'
import { BlueprintGrid } from './hero'

const DEMO_URL = 'https://cal.com/calibrafacil/30min?user=calibrafacil'
const DOCS_URL = 'https://docs.calibrafacil.com'

export function ClosingCTA() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-[1200px] px-6 md:px-8">
        <Reveal>
          <div className="relative isolate overflow-hidden rounded-2xl border border-border bg-card px-6 py-16 text-center sm:px-12 sm:py-22">
            <BlueprintGrid fine />
            <div className="relative z-[1]">
              <h2 className="mx-auto my-4 max-w-[22ch] text-[clamp(28px,3.6vw,44px)] leading-[1.1] font-semibold tracking-tight text-balance">
                Pronto para a próxima auditoria sem passar uma semana montando
                pastas?
              </h2>
              <p className="mx-auto mb-7 max-w-[56ch] text-base leading-normal text-pretty text-muted-foreground">
                Uma demonstração de 30 minutos. A nossa equipe mostra o produto
                rodando com a sequência de telas que o avaliador do Cgcre (ou o
                fiscal do Inmetro) costuma pedir. Sem slide-deck, sem promessa
                de roadmap.
              </p>
              <div className="inline-flex flex-wrap justify-center gap-3">
                <Button
                  size="lg"
                  render={
                    <a
                      href={DEMO_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  Agendar demonstração
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    data-icon="inline-end"
                  />
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  render={
                    <a
                      href={DOCS_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  <HugeiconsIcon
                    icon={BookOpen01Icon}
                    data-icon="inline-start"
                  />
                  Ver documentação técnica
                </Button>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
