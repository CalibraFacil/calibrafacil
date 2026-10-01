import {
  CONTRIBUTING_URL,
  DISCUSSIONS_URL,
  DOCS_URL,
  LICENSE_URL,
  OPEN_SOURCE_URL,
  REPOSITORY_URL,
} from "@/lib/site";

import { BrandLockup } from "./brand";

type FooterLink = { label: string; href: string; external?: boolean };
type FooterColumn = { heading: string; links: FooterLink[] };

const footerColumns: FooterColumn[] = [
  {
    heading: "Produto",
    links: [
      { label: "O fluxo", href: "/#fluxo" },
      { label: "Portal do cliente", href: "/#portal" },
      { label: "Cobertura", href: "/#cobertura" },
      { label: "Como é construído", href: "/#fundamentos" },
      { label: "Documentação", href: DOCS_URL },
    ],
  },
  {
    heading: "Conteúdo",
    links: [
      { label: "Recursos", href: "/recursos" },
      { label: "Soluções por segmento", href: "/solucoes" },
      { label: "Calibração por grandeza", href: "/calibracao" },
      { label: "Ferramentas", href: "/ferramentas" },
    ],
  },
  {
    heading: "Código aberto",
    links: [
      { label: "Repositório no GitHub", href: REPOSITORY_URL, external: true },
      { label: "Rodar localmente", href: OPEN_SOURCE_URL },
      { label: "Como contribuir", href: CONTRIBUTING_URL, external: true },
      { label: "Discussões", href: DISCUSSIONS_URL, external: true },
      { label: "Licença MIT", href: LICENSE_URL, external: true },
    ],
  },
];

export function LandingFooter() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto max-w-[1200px] px-6 pt-16 pb-8 md:px-8">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr] md:gap-12">
          <div className="flex max-w-[320px] flex-col gap-4">
            <BrandLockup
              markClassName="size-[22px]"
              textClassName="text-[15px]"
            />
            <p className="text-[13.5px] leading-relaxed text-muted-foreground">
              Software de código aberto para laboratórios de calibração: cálculo
              de incerteza, certificados com revisão e aprovação, assinatura
              ICP-Brasil e portal do cliente.
            </p>
            <div className="flex items-center gap-3 pt-1">
              <img
                src="/icp-brasil.svg"
                alt="ICP-Brasil"
                className="h-7 w-auto shrink-0 dark:hidden"
                draggable={false}
              />
              <img
                src="/icp-brasil-dark.svg"
                alt="ICP-Brasil"
                className="hidden h-7 w-auto shrink-0 dark:block"
                draggable={false}
              />
              <span className="text-[12px] leading-snug text-muted-foreground">
                Certificados assinados com certificado digital ICP-Brasil A1.
              </span>
            </div>
          </div>

          {footerColumns.map((column) => (
            <div key={column.heading}>
              <h2 className="mb-3.5 text-[13px] font-semibold text-foreground">
                {column.heading}
              </h2>
              <ul className="grid gap-2.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      {...(link.external
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                      className="text-[13.5px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6 text-[12.5px] text-muted-foreground">
          <span>© 2025–2026 Calibra Fácil contributors · Licença MIT</span>
          <span>
            Software fornecido sem garantia. Cada laboratório é responsável pela
            validação do seu uso (ISO/IEC 17025).
          </span>
        </div>
      </div>
    </footer>
  );
}
