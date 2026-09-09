import type { SVGProps } from 'react'

import { cn } from '@/lib/utils'

/**
 * Payment brand marks. Unlike the product's line icons (Hugeicons), these are
 * someone else's identity and come with rules: they are never recoloured to
 * match the UI, never redrawn, and never shrunk into illegibility.
 */

/** Official "Verde Pix" — Banco Central, Manual de Uso da Marca Pix v1.6. */
export const PIX_BRAND_GREEN = '#77B6A8'

type PixIconProps = Omit<SVGProps<SVGSVGElement>, 'fill'> & {
  /**
   * `brand` (default) renders Verde Pix. `mono` follows `currentColor`, which
   * the manual permits only as black or white — use it on solid dark or light
   * surfaces, not with a grey text colour.
   */
  tone?: 'brand' | 'mono'
}

/**
 * The Pix symbol (four diamonds), symbol-only — the form the Banco Central
 * manual sanctions as a payment-method icon in menus and buttons. Path from
 * Simple Icons (CC0), byte-identical to the official mark. Keep it at 24 px or
 * larger where the layout allows; the manual sets that as the digital minimum.
 */
export function PixIcon({ tone = 'brand', className, ...props }: PixIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label="Pix"
      fill={tone === 'brand' ? PIX_BRAND_GREEN : 'currentColor'}
      className={cn('shrink-0', className)}
      {...props}
    >
      <path d="M5.283 18.36a3.505 3.505 0 0 0 2.493-1.032l3.6-3.6a.684.684 0 0 1 .946 0l3.613 3.613a3.504 3.504 0 0 0 2.493 1.032h.71l-4.56 4.56a3.647 3.647 0 0 1-5.156 0L4.85 18.36ZM18.428 5.627a3.505 3.505 0 0 0-2.493 1.032l-3.613 3.614a.67.67 0 0 1-.946 0l-3.6-3.6A3.505 3.505 0 0 0 5.283 5.64h-.434l4.573-4.572a3.646 3.646 0 0 1 5.156 0l4.559 4.559ZM1.068 9.422 3.79 6.699h1.492a2.483 2.483 0 0 1 1.744.722l3.6 3.6a1.73 1.73 0 0 0 2.443 0l3.614-3.613a2.482 2.482 0 0 1 1.744-.723h1.767l2.737 2.737a3.646 3.646 0 0 1 0 5.156l-2.736 2.736h-1.768a2.482 2.482 0 0 1-1.744-.722l-3.613-3.613a1.77 1.77 0 0 0-2.444 0l-3.6 3.6a2.483 2.483 0 0 1-1.744.722H3.791l-2.723-2.723a3.646 3.646 0 0 1 0-5.156" />
    </svg>
  )
}
