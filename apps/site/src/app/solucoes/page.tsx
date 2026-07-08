import type { Metadata } from "next";
import Link from "next/link";

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
    <div className="mx-auto max-w-3xl px-6 py-16 md:py-24">
      <p className="font-mono text-xs tracking-[0.14em] text-muted-foreground uppercase">
        Soluções
      </p>
      <h1 className="mt-6 max-w-[18ch] text-4xl font-semibold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.08]">
        Dois mercados regulados, dois fluxos
      </h1>
      <p className="mt-5 max-w-[56ch] text-lg leading-relaxed text-pretty text-muted-foreground">
        A calibração acreditada e a metrologia legal têm exigências diferentes.
        O sistema apresenta o fluxo correto para cada perfil.
      </p>

      <section className="mt-16 border-t border-border/60 pt-14">
        <ul className="grid gap-px overflow-hidden rounded-xl border border-border/70 bg-border/70 sm:grid-cols-2">
          {SEGMENTS.map((segment) => (
            <li key={segment.slug}>
              <Link
                href={`/solucoes/${segment.slug}`}
                className="group flex h-full flex-col bg-background px-5 py-6 transition-colors hover:bg-muted/40"
              >
                <span className="text-base font-medium text-foreground group-hover:text-primary">
                  {segment.heading}
                </span>
                <span className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                  {segment.intro}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
