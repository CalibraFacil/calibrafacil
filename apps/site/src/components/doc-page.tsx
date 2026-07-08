import { CONTACT_URL, DEMO_URL } from "@/lib/site";

export interface DocContent {
  slug: string;
  metaTitle: string;
  description: string;
  heading: string;
  intro: string;
  highlights: { title: string; body: string }[];
}

// Shared layout for a marketing content page (a feature or a segment). Keeps
// /recursos and /solucoes visually and structurally identical.
export function DocPage({
  eyebrow,
  eyebrowHref,
  content,
}: {
  eyebrow: string;
  eyebrowHref: string;
  content: DocContent;
}) {
  return (
    <article className="mx-auto max-w-3xl px-6 py-20">
      <a
        href={eyebrowHref}
        className="font-mono text-xs text-muted-foreground uppercase hover:text-foreground"
      >
        {eyebrow}
      </a>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance">
        {content.heading}
      </h1>
      <p className="mt-4 text-lg text-muted-foreground text-pretty">
        {content.intro}
      </p>

      <div className="mt-12 grid gap-6">
        {content.highlights.map((item) => (
          <div
            key={item.title}
            className="rounded-2xl border border-border p-6"
          >
            <h2 className="text-base font-semibold tracking-tight">
              {item.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {item.body}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-12 flex flex-wrap gap-3">
        <a
          href={CONTACT_URL}
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Falar com um especialista
        </a>
        <a
          href={DEMO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          Agendar demonstração
        </a>
      </div>
    </article>
  );
}
