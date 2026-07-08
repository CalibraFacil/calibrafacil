import type { Metadata } from "next";

import { SEGMENTS } from "@/lib/segments";
import { absoluteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Soluções por perfil",
  description:
    "O CalibraFácil para laboratórios de calibração acreditados pela Cgcre e para oficinas permissionárias do Inmetro — cada perfil com o fluxo certo.",
  alternates: { canonical: absoluteUrl("/solucoes") },
  openGraph: {
    title: "Soluções por perfil — CalibraFácil",
    description:
      "Para laboratórios acreditados Cgcre e oficinas permissionárias do Inmetro.",
    url: absoluteUrl("/solucoes"),
  },
};

export default function SolucoesPage() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-20">
      <div className="max-w-2xl">
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Dois mercados regulados. Escolha o seu.
        </h1>
        <p className="mt-4 text-lg text-muted-foreground text-pretty">
          A calibração acreditada e a metrologia legal têm exigências
          diferentes. O sistema apresenta o fluxo correto para cada perfil.
        </p>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {SEGMENTS.map((segment) => (
          <a
            key={segment.slug}
            href={`/solucoes/${segment.slug}`}
            className="group rounded-2xl border border-border p-6 transition-colors hover:border-primary"
          >
            <h2 className="text-base font-semibold tracking-tight group-hover:text-primary">
              {segment.heading}
            </h2>
            <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
              {segment.intro}
            </p>
          </a>
        ))}
      </div>
    </section>
  );
}
