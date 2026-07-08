import type { Metadata } from "next";
import Link from "next/link";

import { FEATURES } from "@/lib/features";
import { GRANDEZAS } from "@/lib/grandezas";
import { absoluteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Recursos",
  description:
    "Recursos do CalibraFácil para laboratórios de calibração e oficinas: cálculo de incerteza GUM, certificados ISO/IEC 17025, assinatura ICP-Brasil e portal do cliente.",
  alternates: { canonical: absoluteUrl("/recursos") },
  openGraph: {
    title: "Recursos — CalibraFácil",
    description:
      "Cálculo de incerteza GUM, certificados ISO/IEC 17025, assinatura ICP-Brasil e portal do cliente.",
    url: absoluteUrl("/recursos"),
  },
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-6 font-mono text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
      {children}
    </p>
  );
}

export default function RecursosPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 md:py-24">
      <p className="font-mono text-xs tracking-[0.14em] text-muted-foreground uppercase">
        Recursos
      </p>
      <h1 className="mt-6 max-w-[18ch] text-4xl font-semibold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.08]">
        Da medição ao certificado assinado
      </h1>
      <p className="mt-5 max-w-[56ch] text-lg leading-relaxed text-pretty text-muted-foreground">
        O que sustenta a operação de um laboratório de calibração alinhado à
        ISO/IEC 17025 — cada peça é uma página com o detalhe técnico.
      </p>

      <section className="mt-16 border-t border-border/60 pt-14">
        <SectionLabel>Plataforma</SectionLabel>
        <ul className="grid gap-px overflow-hidden rounded-xl border border-border/70 bg-border/70 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <li key={feature.slug}>
              <Link
                href={`/recursos/${feature.slug}`}
                className="group flex h-full flex-col bg-background px-5 py-5 transition-colors hover:bg-muted/40"
              >
                <span className="text-[0.95rem] font-medium text-foreground group-hover:text-primary">
                  {feature.heading}
                </span>
                <span className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                  {feature.intro}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {GRANDEZAS.length > 0 ? (
        <section className="mt-16 border-t border-border/60 pt-14">
          <SectionLabel>Calibração por grandeza</SectionLabel>
          <ul className="grid gap-px overflow-hidden rounded-xl border border-border/70 bg-border/70 sm:grid-cols-2">
            {GRANDEZAS.map((grandeza) => (
              <li key={grandeza.slug}>
                <Link
                  href={`/calibracao/${grandeza.slug}`}
                  className="group flex h-full items-center justify-between gap-3 bg-background px-5 py-4 text-[0.95rem] text-foreground transition-colors hover:bg-muted/40 hover:text-primary"
                >
                  {grandeza.heading}
                  <span className="font-mono text-muted-foreground">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
