import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Menu01Icon,
  Cancel01Icon,
  ArrowRight01Icon,
} from '@hugeicons/core-free-icons'

import { BrandLockup } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { ModeToggle } from '@/components/mode-toggle'

const navLinks = [
  { label: 'Desafios', href: '#desafios' },
  { label: 'Funcionalidades', href: '#funcionalidades' },
  { label: 'Conformidade', href: '#conformidade' },
  { label: 'Plataforma', href: '#plataforma' },
  {
    label: 'Documentação',
    href: 'https://docs.calibrafacil.com',
    external: true,
  },
]

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <nav className="fixed top-0 right-0 left-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2.5 select-none">
          <BrandLockup />
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) =>
            link.external ? (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            ) : (
              <a
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            ),
          )}
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <ModeToggle />
          <Link to="/sign-in">
            <Button variant="ghost" size="sm">
              Entrar
            </Button>
          </Link>
          <a
            href="https://cal.com/calibrafacil/30min?user=calibrafacil"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button size="sm">
              Agendar demonstração
              <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
            </Button>
          </a>
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <ModeToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? 'Fechar menu' : 'Abrir menu'}
          >
            <HugeiconsIcon icon={mobileOpen ? Cancel01Icon : Menu01Icon} />
          </Button>
        </div>
      </div>

      <div
        className={`overflow-hidden border-t border-border/50 transition-[max-height,opacity] duration-200 ease-in-out md:hidden ${
          mobileOpen ? 'max-h-[420px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="flex flex-col gap-1 px-6 py-4">
          {navLinks.map((link) =>
            link.external ? (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </a>
            ) : (
              <a
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </a>
            ),
          )}
          <div className="mt-3 flex flex-col gap-2 border-t border-border/50 pt-4">
            <Link to="/sign-in" onClick={() => setMobileOpen(false)}>
              <Button variant="outline" className="w-full">
                Entrar
              </Button>
            </Link>
            <a
              href="https://cal.com/calibrafacil/30min?user=calibrafacil"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button className="w-full">
                Agendar demonstração
                <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
              </Button>
            </a>
          </div>
        </div>
      </div>
    </nav>
  )
}
