import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight01Icon,
  Cancel01Icon,
  Menu01Icon,
} from '@hugeicons/core-free-icons'
import { useSession } from '@calibra-facil/auth/client'

import { BrandLockup } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { track } from '@/features/analytics/track'
import { cn } from '@/lib/utils'

const navLinks = [
  { label: 'Fluxo', href: '#fluxo' },
  { label: 'Capacidades', href: '#capacidades' },
  { label: 'Para quem', href: '#audiencias' },
  { label: 'Perguntas', href: '#perguntas' },
  { label: 'Blog', href: '/blog' },
]

export function LandingNav() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6 md:px-8">
        <Link to="/" className="flex items-center select-none">
          <BrandLockup markClassName="size-[22px]" textClassName="text-sm" />
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => {
                if (link.href === '/blog') track('blog_click')
              }}
              className="rounded-lg px-3 py-2 text-sm font-normal text-foreground/75 transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <AuthButton />
          <Button
            size="sm"
            render={
              <a
                href="#contato"
                onClick={() => track('lead_cta_click', { location: 'nav' })}
              />
            }
          >
            Falar com especialista
            <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
          </Button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setMobileOpen((open) => !open)}
          aria-label={mobileOpen ? 'Fechar menu' : 'Abrir menu'}
          aria-expanded={mobileOpen}
          aria-controls="landing-mobile-menu"
        >
          <HugeiconsIcon icon={mobileOpen ? Cancel01Icon : Menu01Icon} />
        </Button>
      </div>

      <div
        id="landing-mobile-menu"
        aria-hidden={!mobileOpen}
        inert={mobileOpen ? undefined : true}
        className={cn(
          'overflow-hidden border-t border-border/60 transition-[max-height,opacity] duration-200 ease-in-out md:hidden',
          mobileOpen ? 'max-h-[420px] opacity-100' : 'max-h-0 opacity-0',
        )}
      >
        <div className="flex flex-col gap-1 px-6 py-4">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => {
                if (link.href === '/blog') track('blog_click')
                setMobileOpen(false)
              }}
            >
              {link.label}
            </a>
          ))}
          <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-4">
            <AuthButton mobile onNavigate={() => setMobileOpen(false)} />
            <Button
              className="w-full"
              render={
                <a
                  href="#contato"
                  onClick={() => {
                    track('lead_cta_click', { location: 'nav_mobile' })
                    setMobileOpen(false)
                  }}
                />
              }
            >
              Falar com especialista
              <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}

function AuthButton({
  mobile = false,
  onNavigate,
}: {
  mobile?: boolean
  onNavigate?: () => void
}) {
  const { data: session } = useSession()
  const isSignedIn = Boolean(session?.user)

  if (isSignedIn) {
    return (
      <Button
        variant={mobile ? 'outline' : 'ghost'}
        size={mobile ? 'default' : 'sm'}
        className={cn(mobile && 'w-full')}
        render={<Link to="/dashboard" onClick={onNavigate} />}
      >
        Ir para o painel
        <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
      </Button>
    )
  }

  return (
    <Button
      variant={mobile ? 'outline' : 'ghost'}
      size={mobile ? 'default' : 'sm'}
      className={cn(mobile && 'w-full')}
      render={
        <Link
          to="/sign-in"
          onClick={() => {
            track('signin_click')
            onNavigate?.()
          }}
        />
      }
    >
      Entrar
    </Button>
  )
}
