import { Link } from '@tanstack/react-router'

import { BrandLockup } from '@/components/brand'
import { ModeToggle } from '@/components/mode-toggle'

type FooterLink =
  | {
      external?: boolean
      href: string
      label: string
      to?: never
    }
  | {
      external?: never
      href?: never
      label: string
      to: '/privacidade' | '/termos-de-uso'
    }

const footerLinks = {
  Produto: [
    { label: 'Desafios', href: '#desafios' },
    { label: 'Funcionalidades', href: '#funcionalidades' },
    { label: 'Conformidade', href: '#conformidade' },
    { label: 'Plataforma', href: '#plataforma' },
    { label: 'FAQ', href: '#faq' },
  ],
  Recursos: [
    {
      label: 'Documentação',
      href: 'https://docs.calibrafacil.com',
      external: true,
    },
    {
      label: 'Agendar demonstração',
      href: 'https://cal.com/calibrafacil/30min?user=calibrafacil',
      external: true,
    },
    {
      label: 'Contato',
      href: 'mailto:contato@calibrafacil.com',
      external: false,
    },
  ],
  Legal: [
    { label: 'Termos de Uso', to: '/termos-de-uso' },
    { label: 'Política de Privacidade', to: '/privacidade' },
  ],
} satisfies Record<string, FooterLink[]>

export function Footer() {
  return (
    <footer className="border-t border-border/50">
      <div className="mx-auto max-w-6xl px-6 py-12 md:py-16">
        <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-4">
          {/* Brand */}
          <div className="sm:col-span-2 md:col-span-1">
            <Link to="/" className="flex items-center gap-2.5 select-none">
              <BrandLockup />
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              Plataforma de gestão para laboratórios de calibração, com
              conformidade ISO/IEC 17025.
            </p>
          </div>

          {/* Links */}
          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h3 className="mb-4 text-sm font-semibold">{title}</h3>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.label}>
                    {'to' in link ? (
                      <Link
                        to={link.to}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    ) : 'external' in link && link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <a
                        href={link.href}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border/50 pt-8 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} CalibraFácil. Todos os direitos
            reservados.
          </p>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="size-1.5 rounded-full bg-emerald-500" />
              <span>Todos os sistemas operacionais</span>
            </div>
            <ModeToggle />
          </div>
        </div>
      </div>
    </footer>
  )
}
