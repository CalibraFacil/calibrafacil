import type { Metadata } from "next";
import Link from "next/link";

import { TOOLS } from "@/lib/tools";
import { absoluteUrl } from "@/lib/site";

const TITLE = "Ferramentas de metrologia";
const DESCRIPTION =
  "Calculadoras gratuitas para laboratórios de calibração: incerteza de medição conforme o GUM, sem cadastro e com o cálculo rodando no navegador.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/ferramentas") },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: absoluteUrl("/ferramentas"),
  },
};

export default function ToolsPage() {
  return (
    <article className="mx-auto max-w-2xl px-6 py-16 md:py-24">
      <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.08]">
        Ferramentas de metrologia
      </h1>
      <p className="mt-5 text-lg leading-relaxed text-pretty text-muted-foreground">
        Calculadoras gratuitas, sem cadastro, com o cálculo rodando no seu
        navegador. São os mesmos motores que o CalibraFácil usa para compor o
        que vai impresso em um certificado.
      </p>

      <ul className="mt-12 grid gap-4">
        {TOOLS.map((tool) => (
          <li key={tool.slug}>
            <Link
              href={`/ferramentas/${tool.slug}`}
              className="block rounded-xl border border-border bg-card px-6 py-5 transition-colors hover:bg-muted"
            >
              <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-foreground">
                {tool.heading}
              </h2>
              <p className="mt-1.5 text-[15px] leading-relaxed text-pretty text-muted-foreground">
                {tool.description}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </article>
  );
}
