"use client";

import { track } from "@/lib/analytics/track";
import { whatsappUrl } from "@/lib/site";

import { BrandLockup } from "./brand";

type FooterLink = { label: string; href: string };
type FooterColumn = { heading: string; links: FooterLink[] };

const footerColumns: FooterColumn[] = [
  {
    heading: "Produto",
    links: [
      { label: "O fluxo", href: "/#fluxo" },
      { label: "Portal do cliente", href: "/#portal" },
      { label: "Cobertura", href: "/#cobertura" },
      { label: "Como é construído", href: "/#fundamentos" },
      { label: "Preços", href: "/#planos" },
      { label: "Documentação", href: "/docs" },
    ],
  },
  {
    heading: "Conteúdo",
    links: [
      { label: "Recursos", href: "/recursos" },
      { label: "Soluções por segmento", href: "/solucoes" },
      { label: "Calibração por grandeza", href: "/calibracao" },
      { label: "Blog", href: "/blog" },
    ],
  },
  {
    heading: "Empresa",
    links: [
      { label: "Falar com a equipe", href: "/#contato" },
      { label: "Política de privacidade", href: "/privacidade" },
      { label: "Termos de uso", href: "/termos-de-uso" },
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
              Software para laboratórios de calibração: cálculo de incerteza,
              certificados com revisão e aprovação, assinatura ICP-Brasil e
              portal do cliente.
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
                      onClick={() => {
                        if (link.href === "/blog") track("blog_click");
                      }}
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
          <span>© 2026 CalibraFácil</span>
          <span className="flex flex-wrap gap-x-5 gap-y-2">
            <a
              href="mailto:contato@calibrafacil.com"
              onClick={() => track("email_click", { location: "footer" })}
              className="transition-colors hover:text-foreground"
            >
              contato@calibrafacil.com
            </a>
            <a
              href={whatsappUrl(
                "Olá! Vim pelo site do CalibraFácil e queria saber mais sobre o sistema.",
              )}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track("whatsapp_click", { location: "footer" })}
              className="transition-colors hover:text-foreground"
            >
              WhatsApp (51) 90000-0000
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
