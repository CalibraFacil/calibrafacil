import { HugeiconsIcon } from '@hugeicons/react'
import {
  CloudIcon,
  DashboardSquare01Icon,
  Mail01Icon,
  SecurityCheckIcon,
  WhatsappIcon,
} from '@hugeicons/core-free-icons'

const footerColumns = [
  {
    heading: 'Produto',
    links: [
      { label: 'Capacidades', href: '#capacidades' },
      { label: 'Fluxo de aprovação', href: '#fluxo' },
      { label: 'Para quem', href: '#audiencias' },
      { label: 'Perguntas', href: '#perguntas' },
    ],
  },
  {
    heading: 'Conformidade',
    links: [
      { label: 'ISO/IEC 17025:2017' },
      { label: 'Portaria Inmetro nº 157' },
      { label: 'JCGM 100:2008 (GUM)' },
      { label: 'Assinatura ICP-Brasil A1 (PAdES)' },
      { label: 'LGPD' },
    ],
  },
  {
    heading: 'Empresa',
    links: [
      { label: 'Documentação', href: 'https://docs.calibrafacil.com' },
      { label: 'Blog', href: 'https://blog.calibrafacil.com' },
      { label: 'Status do sistema' },
      { label: 'Política de privacidade', href: '/privacidade' },
      { label: 'Termos de uso', href: '/termos-de-uso' },
    ],
  },
]

export function LandingFooter() {
  return (
    <footer className="border-t border-border bg-muted/40 pt-20 pb-9 text-foreground">
      <div className="mx-auto max-w-[1200px] px-6 md:px-8">
        <div className="grid gap-10 border-b border-border/70 pb-14 md:grid-cols-[1.6fr_1fr_1fr_1fr] md:gap-14">
          <div className="flex max-w-[360px] flex-col gap-4">
            <div className="flex items-center gap-2.5">
              <img
                src="/logo-mark-light.svg"
                alt=""
                aria-hidden
                className="size-[22px] dark:hidden"
                draggable={false}
              />
              <img
                src="/logo-mark-dark.svg"
                alt=""
                aria-hidden
                className="hidden size-[22px] dark:block"
                draggable={false}
              />
              <span className="text-sm font-semibold tracking-tight">
                CalibraFácil
              </span>
            </div>
            <p className="text-sm leading-normal text-muted-foreground">
              Sistema de gestão metrológica para laboratórios acreditados e
              oficinas permissionárias do Inmetro.
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
                <HugeiconsIcon
                  icon={SecurityCheckIcon}
                  className="size-3 text-emerald-500"
                />
                LGPD
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
                <HugeiconsIcon
                  icon={CloudIcon}
                  className="size-3 text-emerald-500"
                />
                Brasil
              </span>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <img
                src="/icp-brasil.svg"
                alt="ICP-Brasil"
                className="h-8 w-auto shrink-0"
                draggable={false}
              />
              <span className="text-xs leading-snug text-muted-foreground">
                Certificados assinados com certificado digital ICP-Brasil A1.
              </span>
            </div>
          </div>

          {footerColumns.map((column) => (
            <div key={column.heading}>
              <h4 className="mb-3.5 font-mono text-xs font-medium tracking-widest text-muted-foreground uppercase">
                {column.heading}
              </h4>
              <ul className="grid gap-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.href ? (
                      <a
                        href={link.href}
                        className="text-sm text-foreground/80 transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <span className="text-sm text-foreground/80">
                        {link.label}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-dashed border-border/80 py-5 text-sm text-muted-foreground">
          <a
            href="mailto:contato@calibrafacil.com"
            className="inline-flex items-center gap-2 font-mono text-foreground/85 transition-colors hover:text-foreground"
          >
            <HugeiconsIcon
              icon={Mail01Icon}
              className="size-4 text-muted-foreground"
            />
            contato@calibrafacil.com
          </a>
          <a
            href="https://wa.me/5551900000000"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 font-mono text-foreground/85 transition-colors hover:text-foreground"
          >
            <HugeiconsIcon
              icon={WhatsappIcon}
              className="size-4 text-emerald-500"
            />
            (51) 90000-0000
          </a>
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-between gap-4 font-mono text-xs text-muted-foreground">
          <span>© 2026 CalibraFácil</span>
          <span className="flex items-center gap-1.5">
            <HugeiconsIcon icon={DashboardSquare01Icon} className="size-3" />
            Status do sistema
          </span>
        </div>
      </div>
    </footer>
  )
}
