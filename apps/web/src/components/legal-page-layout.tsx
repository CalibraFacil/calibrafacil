import type { ReactNode } from 'react'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link } from '@tanstack/react-router'

import { BrandLockup } from '@/components/brand'
import { ModeToggle } from '@/components/mode-toggle'
import { Badge } from '@/components/ui/badge'
import { LEGAL_ENTITY, LEGAL_LAST_UPDATED, LEGAL_VERSION } from '@/lib/legal'

interface LegalPageLayoutProps {
  children: ReactNode
  pathLabel: string
  subtitle: string
  title: string
}

export function LegalPageLayout({
  children,
  pathLabel,
  subtitle,
  title,
}: LegalPageLayoutProps) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.14),_transparent_38%),linear-gradient(to_bottom,_hsl(var(--background)),_hsl(var(--background)))]">
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/92 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <Link to="/" className="flex items-center gap-2.5 select-none">
            <BrandLockup />
          </Link>

          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
              Voltar ao início
            </Link>
            <ModeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10 md:py-14">
        <article className="overflow-hidden rounded-[28px] border border-border/60 bg-card/95 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.45)]">
          <div className="border-b border-border/60 bg-[linear-gradient(180deg,rgba(14,165,233,0.08),transparent)] px-8 py-10 md:px-12 md:py-12">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Badge variant="outline">Documento jurídico</Badge>
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span>Versão {LEGAL_VERSION}</span>
                <span className="h-1 w-1 rounded-full bg-border" />
                <span>Atualizado em {LEGAL_LAST_UPDATED}</span>
              </div>
            </div>

            <div className="mt-6 max-w-3xl">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                {title}
              </h1>
              <p className="mt-4 text-base leading-7 text-muted-foreground md:text-lg">
                {subtitle}
              </p>
            </div>
          </div>

          <div className="px-8 py-10 md:px-12 md:py-12">{children}</div>

          <div className="border-t border-border/60 bg-muted/20 px-8 py-8 md:px-12">
            <div className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
              <div>
                <p className="font-medium text-foreground">
                  {LEGAL_ENTITY.legalName}
                </p>
                <p>CNPJ: {LEGAL_ENTITY.cnpj}</p>
                <p>{LEGAL_ENTITY.fullAddress}</p>
              </div>

              <div className="md:text-right">
                <p>Contato: {LEGAL_ENTITY.email}</p>
                <p>Encarregado LGPD: {LEGAL_ENTITY.dpoName}</p>
                <p>E-mail do encarregado: {LEGAL_ENTITY.dpoEmail}</p>
              </div>
            </div>

            <p className="mt-6 text-xs text-muted-foreground">
              A versão vigente e atualizada deste documento permanece disponível
              nesta página.
            </p>
          </div>
        </article>
      </main>

      <footer className="border-t border-border/60 bg-background/95 py-6">
        <div className="mx-auto max-w-5xl px-6 text-center text-sm text-muted-foreground">
          {pathLabel}
        </div>
      </footer>
    </div>
  )
}
