import type { ReactNode } from 'react'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.12),_transparent_28%),linear-gradient(to_bottom,_hsl(var(--background)),_hsl(var(--background)))]">
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/92 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <a href="/" className="flex items-center gap-2.5 select-none">
            <BrandLockup />
          </a>

          <div className="flex items-center gap-2">
            <a
              href="/"
              className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
              Voltar ao início
            </a>
            <ModeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 md:py-12">
        <article className="overflow-hidden rounded-3xl border border-border/60 bg-card/95 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.45)]">
          <div className="border-b border-border/60 bg-[linear-gradient(180deg,rgba(14,165,233,0.08),transparent)] px-8 py-10 md:px-10 md:py-10">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="max-w-3xl space-y-4">
                <Badge variant="outline">Documento jurídico</Badge>
                <div className="space-y-3">
                  <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                    {title}
                  </h1>
                  <p className="max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
                    {subtitle}
                  </p>
                </div>
              </div>

              <div className="min-w-[220px] rounded-2xl border border-border/60 bg-background/70 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Controle
                </p>
                <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                  <p>Versão {LEGAL_VERSION}</p>
                  <p>Atualizado em {LEGAL_LAST_UPDATED}</p>
                  <p>{pathLabel}</p>
                </div>
              </div>
            </div>

            <div className="mt-8 grid gap-4 border-t border-border/60 pt-5 text-sm text-muted-foreground md:grid-cols-[1.2fr_0.8fr]">
              <div>
                <p className="font-semibold uppercase tracking-[0.16em] text-foreground/70">
                  Emitente
                </p>
                <p className="mt-1">
                  {LEGAL_ENTITY.legalName} · CNPJ {LEGAL_ENTITY.cnpj}
                </p>
              </div>

              <div className="md:text-right">
                <p className="font-semibold uppercase tracking-[0.16em] text-foreground/70">
                  Foro e contato
                </p>
                <p className="mt-1">
                  {LEGAL_ENTITY.forum} · {LEGAL_ENTITY.dpoEmail}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-8 px-8 py-8 md:grid-cols-[240px_minmax(0,1fr)] md:px-10 md:py-10">
            <aside className="space-y-4 md:sticky md:top-24 md:self-start">
              <div className="rounded-2xl border border-border/60 bg-background/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Referência
                </p>
                <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground">Instrumento</p>
                    <p>{title}</p>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Licenciante</p>
                    <p>{LEGAL_ENTITY.legalName}</p>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">
                      Encarregado LGPD
                    </p>
                    <p>{LEGAL_ENTITY.dpoEmail}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Escopo</p>
                <p className="mt-2">
                  Documento público de referência contratual, privacidade e
                  governança operacional da plataforma.
                </p>
              </div>
            </aside>

            <div>
              <div className="mb-8 border-y border-border/60 py-3 text-xs uppercase tracking-[0.24em] text-muted-foreground">
                Documento destinado a referência contratual e governança de
                tratamento de dados
              </div>
              {children}
            </div>
          </div>

          <div className="border-t border-border/60 bg-muted/20 px-8 py-8 md:px-10">
            <div className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
              <div>
                <p className="font-semibold uppercase tracking-[0.16em] text-foreground/70">
                  Identificação da licenciante
                </p>
                <p className="mt-2 font-medium text-foreground">
                  {LEGAL_ENTITY.legalName}
                </p>
                <p>CNPJ: {LEGAL_ENTITY.cnpj}</p>
                <p>{LEGAL_ENTITY.fullAddress}</p>
              </div>

              <div className="md:text-right">
                <p className="font-semibold uppercase tracking-[0.16em] text-foreground/70">
                  Governança de contato
                </p>
                <p className="mt-2">Encarregado LGPD: {LEGAL_ENTITY.dpoName}</p>
                <p>Contato: {LEGAL_ENTITY.email}</p>
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
        <div className="mx-auto max-w-7xl px-6 text-center text-sm text-muted-foreground">
          {pathLabel}
        </div>
      </footer>
    </div>
  )
}
