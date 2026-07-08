import type { Metadata } from "next";

import { FEATURES } from "@/lib/features";
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

export default function RecursosPage() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-20">
      <div className="max-w-2xl">
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Recursos da plataforma
        </h1>
        <p className="mt-4 text-lg text-muted-foreground text-pretty">
          Da medição ao certificado assinado — o que sustenta a operação de um
          laboratório de calibração alinhado à ISO/IEC 17025.
        </p>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {FEATURES.map((feature) => (
          <a
            key={feature.slug}
            href={`/recursos/${feature.slug}`}
            className="group rounded-2xl border border-border p-6 transition-colors hover:border-primary"
          >
            <h2 className="text-base font-semibold tracking-tight group-hover:text-primary">
              {feature.heading}
            </h2>
            <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
              {feature.intro}
            </p>
          </a>
        ))}
      </div>
    </section>
  );
}
