import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight01Icon,
  Cancel01Icon,
  Home01Icon,
  Menu01Icon,
  SparklesIcon,
} from '@hugeicons/core-free-icons'
import { useSession } from '@calibra-facil/auth/client'

import { BrandLockup } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const navLinks = [
  { label: 'Desafios', href: '#desafios' },
  { label: 'Funcionalidades', href: '#funcionalidades' },
  { label: 'Conformidade', href: '#conformidade' },
  { label: 'Plataforma', href: '#plataforma' },
  { label: 'FAQ', href: '#faq' },
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
          <LandingAuthButton />
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
            <LandingAuthButton mobile onNavigate={() => setMobileOpen(false)} />
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

function LandingAuthButton({
  mobile = false,
  onNavigate,
}: {
  mobile?: boolean
  onNavigate?: () => void
}) {
  const { data: session } = useSession()
  const isSignedIn = Boolean(session?.user)

  if (!isSignedIn) {
    return (
      <Button
        variant={mobile ? 'outline' : 'ghost'}
        size={mobile ? 'default' : 'sm'}
        className={cn(mobile && 'w-full')}
        render={<Link to="/sign-in" onClick={onNavigate} />}
      >
        Entrar
      </Button>
    )
  }

  return (
    <span
      className={cn(
        'group relative inline-flex overflow-hidden rounded-md p-px',
        mobile && 'w-full',
      )}
    >
      <span className="absolute inset-0 rounded-[inherit] bg-[conic-gradient(from_0deg,#22c55e,#38bdf8,#6366f1,#22c55e)] opacity-70 blur-[0.5px] motion-safe:animate-[landing-auth-glow-spin_3.2s_linear_infinite] group-hover:opacity-100" />
      <span className="absolute -inset-1 rounded-lg bg-primary/25 opacity-60 blur-md transition-opacity group-hover:opacity-90" />
      <Button
        size={mobile ? 'default' : 'sm'}
        className={cn(
          'relative w-full border-primary/25 bg-background text-foreground shadow-[0_0_18px_color-mix(in_oklab,var(--primary)_30%,transparent)] hover:bg-primary hover:text-primary-foreground',
          'has-data-[icon=inline-start]:pl-2 has-data-[icon=inline-end]:pr-2',
        )}
        render={<Link to="/dashboard" onClick={onNavigate} />}
      >
        <HugeiconsIcon
          icon={mobile ? Home01Icon : SparklesIcon}
          data-icon="inline-start"
        />
        Ir para o painel
        <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
      </Button>
    </span>
  )
}
