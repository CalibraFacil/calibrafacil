import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowUpRight01Icon,
  Book02Icon,
  GitForkIcon,
  LicenseIcon,
  ServerStack01Icon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import {
  CONTRIBUTING_URL,
  DEPLOYMENT_URL,
  DISCUSSIONS_URL,
  DOCS_URL,
  LICENSE_URL,
  REPOSITORY_URL,
} from "@/lib/site";

import { SectionHeading } from "./surfaces";

const STEPS = [
  {
    label: "Clone o repositório",
    command: `git clone ${REPOSITORY_URL}.git`,
  },
  {
    label: "Suba os serviços no Docker e o laboratório de demonstração",
    command: "cd calibrafacil && pnpm install && pnpm setup:dev",
  },
  {
    label: "Rode a API, o sistema do laboratório e o portal",
    command: "pnpm dev",
  },
] as const;

const FACTS: {
  icon: IconSvgElement;
  title: string;
  body: string;
  href: string;
  external?: boolean;
}[] = [
  {
    icon: LicenseIcon,
    title: "Licença MIT",
    body: "Use, modifique e hospede onde quiser, inclusive comercialmente. O software é fornecido sem garantia.",
    href: LICENSE_URL,
    external: true,
  },
  {
    icon: ServerStack01Icon,
    title: "Hospede você mesmo",
    body: "PostgreSQL, armazenamento compatível com S3 e um serviço de e-mail. Nenhuma conta proprietária é obrigatória.",
    href: DEPLOYMENT_URL,
    external: true,
  },
  {
    icon: GitForkIcon,
    title: "Contribuições são bem-vindas",
    body: "Correções, métodos de calibração e melhorias de documentação entram por pull request.",
    href: CONTRIBUTING_URL,
    external: true,
  },
  {
    icon: UserMultiple02Icon,
    title: "Mantido pela comunidade",
    body: "Sem suporte comercial nem prazo de resposta. Dúvidas e ideias vão para as Discussions do GitHub.",
    href: DISCUSSIONS_URL,
    external: true,
  },
];

export function OpenSourceSection() {
  return (
    <section
      id="rodar"
      className="scroll-mt-20 border-t border-border py-24 md:py-32"
    >
      <div className="mx-auto max-w-[1200px] px-6 md:px-8">
        <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
          <div>
            <SectionHeading
              title="Uma cópia completa na sua máquina."
              body="Requer Node.js 24, pnpm, Bun e Docker; nenhuma conta na nuvem. O Docker sobe PostgreSQL, armazenamento S3, Gotenberg e uma caixa de entrada local, e o laboratório de demonstração entra com admin@laboratorio.test, sem senha: o link de acesso chega em localhost:8025."
            />
            <div className="mt-8 flex flex-wrap gap-3">
              <Button
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
                <HugeiconsIcon
                  icon={ArrowUpRight01Icon}
                  data-icon="inline-end"
                />
              </Button>
              <Button
                variant="outline"
                size="lg"
                render={<a href={DOCS_URL} />}
              >
                <HugeiconsIcon icon={Book02Icon} data-icon="inline-start" />
                Documentação
              </Button>
            </div>
          </div>

          <ol className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            {STEPS.map((step, index) => (
              <li
                key={step.command}
                className="border-b border-border px-5 py-4 last:border-b-0"
              >
                <p className="text-[13px] text-muted-foreground">
                  <span className="mr-2 font-mono tabular-nums text-foreground/60">
                    {index + 1}
                  </span>
                  {step.label}
                </p>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-muted px-3.5 py-2.5 font-mono text-[13px] text-foreground">
                  <code>{step.command}</code>
                </pre>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {FACTS.map((fact) => (
            <a
              key={fact.title}
              href={fact.href}
              {...(fact.external
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
              className="group rounded-2xl border border-border bg-card p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-foreground/20"
            >
              <span className="flex size-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
                <HugeiconsIcon
                  icon={fact.icon}
                  className="size-[18px]"
                  strokeWidth={1.75}
                />
              </span>
              <h3 className="mt-4 text-[16px] font-semibold tracking-[-0.01em] text-foreground">
                {fact.title}
              </h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
                {fact.body}
              </p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
