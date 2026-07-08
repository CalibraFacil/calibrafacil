import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { SecurityCheckIcon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'

import { denyConsent, grantConsent, hasStoredConsent } from '../consent'

// LGPD cookie-consent gate. Consent Mode defaults to "denied" (index.html), so
// no analytics/ad cookies are set until the visitor chooses here. Shown only
// until a choice is stored; never rendered on desktop (see __root).
export function ConsentBanner() {
  const [decided, setDecided] = useState(() => hasStoredConsent())

  if (decided) return null

  function accept() {
    grantConsent()
    setDecided(true)
  }

  function reject() {
    denyConsent()
    setDecided(true)
  }

  return (
    <div
      role="region"
      aria-label="Aviso de cookies"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-border bg-background/95 backdrop-blur-xl"
    >
      <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between md:px-8">
        <div className="flex items-start gap-3">
          <HugeiconsIcon
            icon={SecurityCheckIcon}
            className="mt-0.5 size-5 shrink-0 text-emerald-500"
          />
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Usamos cookies de análise e de marketing para entender o uso do site
            e melhorar sua experiência. Eles só são ativados com a sua
            autorização. Veja a{' '}
            <Link
              to="/privacidade"
              className="font-medium text-foreground underline underline-offset-4"
            >
              Política de Privacidade
            </Link>
            .
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={reject}>
            Rejeitar
          </Button>
          <Button size="sm" onClick={accept}>
            Aceitar
          </Button>
        </div>
      </div>
    </div>
  )
}
