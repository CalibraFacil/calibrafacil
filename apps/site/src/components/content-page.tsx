import Link from "next/link";

import { OPEN_SOURCE_URL, REPOSITORY_URL } from "@/lib/site";

// A minimalist, editorial content page for /recursos/* and /calibracao/*.
// Typography-led: a single readable column, hairline rules between sections,
// Geist-Mono eyebrows, and one restrained indigo accent. No cards with shadows,
// no synthetic product panels — the content and its hierarchy carry the page.

export interface ContentSpec {
  label: string;
  value: string;
}
export interface ContentStep {
  title: string;
  body: string;
}
export interface ContentPoint {
  title: string;
  body: string;
}
export interface ContentFaq {
  q: string;
  a: string;
}
export interface ContentLink {
  label: string;
  href: string;
}

export interface ContentPageModel {
  parent: { label: string; href: string };
  current: string;
  heading: string;
  intro: string;
  /** Optional prose paragraphs shown under the intro. */
  body?: string[];
  method?: { label?: string; steps: ContentStep[] };
  points?: { label?: string; items: ContentPoint[] };
  spec?: { label?: string; items: ContentSpec[] };
  faq?: ContentFaq[];
  related?: { label?: string; items: ContentLink[] };
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-7 font-mono text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
      {children}
    </p>
  );
}

const ctaPrimary =
  "inline-flex items-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90";
const ctaOutline =
  "inline-flex items-center rounded-md border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted";

export function ContentPage({ model }: { model: ContentPageModel }) {
  const {
    parent,
    current,
    heading,
    intro,
    body,
    method,
    points,
    spec,
    faq,
    related,
  } = model;

  return (
    <article className="mx-auto max-w-2xl px-6 py-16 md:py-24">
      {faq && faq.length > 0 ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: faq.map((item) => ({
                "@type": "Question",
                name: item.q,
                acceptedAnswer: { "@type": "Answer", text: item.a },
              })),
            }),
          }}
        />
      ) : null}

      <nav className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
        <Link
          href={parent.href}
          className="transition-colors hover:text-foreground"
        >
          {parent.label}
        </Link>
        <span className="mx-2 text-border">/</span>
        <span className="text-foreground/70">{current}</span>
      </nav>

      <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.08]">
        {heading}
      </h1>
      <p className="mt-5 text-lg leading-relaxed text-pretty text-muted-foreground">
        {intro}
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <a
          href={REPOSITORY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={ctaPrimary}
        >
          Ver no GitHub
        </a>
        <a href={OPEN_SOURCE_URL} className={ctaOutline}>
          Rodar localmente
        </a>
      </div>

      {body && body.length > 0 ? (
        <div className="mt-16 space-y-5 border-t border-border/60 pt-14 text-base leading-[1.75] text-foreground/80">
          {body.map((paragraph) => (
            <p key={paragraph.slice(0, 32)}>{paragraph}</p>
          ))}
        </div>
      ) : null}

      {method ? (
        <section className="mt-16 border-t border-border/60 pt-14">
          <Eyebrow>{method.label ?? "Como funciona"}</Eyebrow>
          <ol className="grid gap-x-12 gap-y-9 sm:grid-cols-2">
            {method.steps.map((step, index) => (
              <li key={step.title} className="grid grid-cols-[2rem_1fr] gap-4">
                <span className="mt-1 w-6 self-start border-t border-primary/50 pt-1 font-mono text-xs tracking-wider text-primary tabular-nums">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="text-[0.95rem] font-medium text-foreground">
                    {step.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {points ? (
        <section className="mt-16 border-t border-border/60 pt-14">
          <Eyebrow>{points.label ?? "No detalhe"}</Eyebrow>
          <div className="grid gap-x-12 gap-y-9 sm:grid-cols-2">
            {points.items.map((item) => (
              <div key={item.title}>
                <h3 className="text-[0.95rem] font-medium text-foreground">
                  {item.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {spec ? (
        <section className="mt-16 border-t border-border/60 pt-14">
          <Eyebrow>{spec.label ?? "Ficha técnica"}</Eyebrow>
          <dl className="text-sm">
            {spec.items.map((item) => (
              <div
                key={item.label}
                className="grid grid-cols-[10rem_1fr] gap-4 border-b border-border/50 py-3 first:border-t"
              >
                <dt className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
                  {item.label}
                </dt>
                <dd className="text-foreground/85">{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {faq && faq.length > 0 ? (
        <section className="mt-16 border-t border-border/60 pt-14">
          <Eyebrow>Perguntas frequentes</Eyebrow>
          <div className="divide-y divide-border/50">
            {faq.map((item) => (
              <div key={item.q} className="py-5 first:pt-0">
                <h3 className="text-[0.95rem] font-medium text-foreground">
                  {item.q}
                </h3>
                <p className="mt-2 max-w-[64ch] text-sm leading-relaxed text-muted-foreground">
                  {item.a}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {related && related.items.length > 0 ? (
        <section className="mt-16 border-t border-border/60 pt-14">
          <Eyebrow>{related.label ?? "Veja também"}</Eyebrow>
          <ul className="grid gap-px overflow-hidden rounded-lg border border-border/70 bg-border/70 sm:grid-cols-2">
            {related.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="flex h-full items-center justify-between gap-3 bg-background px-4 py-3.5 text-sm text-foreground/85 transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  {item.label}
                  <span className="font-mono text-muted-foreground">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-16 border-t border-border/60 pt-14">
        <h2 className="max-w-[24ch] text-2xl font-semibold tracking-tight text-balance">
          Quer ver rodando no seu escopo?
        </h2>
        <p className="mt-3 max-w-[54ch] text-sm leading-relaxed text-muted-foreground">
          O código é aberto. Três comandos sobem uma cópia completa na sua
          máquina, com um laboratório de demonstração pronto para testar o fluxo
          de ponta a ponta.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href={REPOSITORY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={ctaPrimary}
          >
            Ver no GitHub
          </a>
          <a href={OPEN_SOURCE_URL} className={ctaOutline}>
            Rodar localmente
          </a>
        </div>
      </section>
    </article>
  );
}
