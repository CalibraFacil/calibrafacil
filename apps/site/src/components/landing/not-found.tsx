import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { REPOSITORY_URL } from "@/lib/site";

export function NotFound() {
  return (
    <section className="py-32 md:py-40">
      <div className="mx-auto max-w-[640px] px-6 text-center md:px-8">
        <h1 className="text-[clamp(30px,3.6vw,44px)] leading-[1.08] font-semibold tracking-[-0.028em] text-balance text-foreground">
          Página não encontrada.
        </h1>
        <p className="mx-auto mt-4 max-w-[48ch] text-[17px] leading-relaxed text-pretty text-muted-foreground">
          O site do CalibraFácil agora é uma página só. A documentação, os guias
          e o código estão no repositório.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" render={<a href="/" />}>
            Ir para o início
          </Button>
          <Button
            variant="outline"
            size="lg"
            render={
              <a
                href={REPOSITORY_URL}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            Ver no GitHub
            <HugeiconsIcon icon={ArrowUpRight01Icon} data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </section>
  );
}
