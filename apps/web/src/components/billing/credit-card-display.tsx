import { cn } from '@/lib/utils'

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'elo' | 'unknown'

interface CreditCardDisplayProps {
  cardNumber: string
  cardHolder: string
  expiryDate: string
  cvv: string
  cardBrand: CardBrand
  isFlipped: boolean
}

// Card brand colors for gradient backgrounds
const BRAND_GRADIENTS: Record<CardBrand, string> = {
  visa: 'from-blue-900 via-blue-800 to-blue-700',
  mastercard: 'from-slate-900 via-slate-800 to-slate-700',
  amex: 'from-sky-900 via-sky-800 to-sky-700',
  elo: 'from-yellow-900 via-yellow-800 to-orange-700',
  unknown: 'from-zinc-800 via-zinc-700 to-zinc-600',
}

// Card brand logos as SVG components
function VisaLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 750 471"
      className={className}
      fill="currentColor"
      aria-label="Visa"
    >
      <path d="M278.198 334.228l33.36-195.763h53.358l-33.384 195.763H278.198zm246.11-191.123c-10.57-3.966-27.135-8.222-47.822-8.222-52.725 0-89.863 26.551-90.18 64.604-.297 28.129 26.515 43.822 46.754 53.185 20.77 9.598 27.752 15.716 27.652 24.283-.133 13.123-16.586 19.116-31.924 19.116-21.355 0-32.701-2.967-50.225-10.274l-6.878-3.112-7.487 43.823c12.463 5.467 35.508 10.199 59.438 10.445 56.089 0 92.502-26.248 92.916-66.885.2-22.27-14.016-39.215-44.801-53.188-18.65-9.056-30.072-15.099-29.951-24.269 0-8.137 9.668-16.838 30.559-16.838 17.447-.271 30.088 3.534 39.936 7.5l4.781 2.259 7.232-42.427m137.308-4.412h-41.23c-12.772 0-22.332 3.486-27.941 16.234l-79.244 179.402h56.031s9.159-24.121 11.231-29.418c6.123 0 60.555.084 68.336.084 1.596 6.854 6.492 29.334 6.492 29.334h49.512l-43.187-195.636zm-65.417 126.408c4.414-11.279 21.26-54.724 21.26-54.724-.314.521 4.381-11.334 7.074-18.684l3.606 16.878s10.217 46.729 12.353 56.53h-44.293zM209.298 138.465l-52.239 133.496-5.565-27.129c-9.726-31.274-40.025-65.157-73.898-82.12l47.767 171.204 56.455-.063 84.004-195.388h-56.524" />
    </svg>
  )
}

function MastercardLogo({ className }: { className?: string }) {
  return (
    <div className={cn('flex', className)} aria-label="Mastercard">
      <div className="size-7 rounded-full bg-red-500/80" />
      <div className="-ml-3 size-7 rounded-full bg-orange-400/80" />
    </div>
  )
}

function AmexLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 80" className={className} aria-label="American Express">
      <rect width="120" height="80" rx="8" fill="#006FCF" />
      <text
        x="60"
        y="45"
        textAnchor="middle"
        fill="white"
        fontSize="16"
        fontWeight="bold"
        fontFamily="system-ui"
      >
        AMEX
      </text>
    </svg>
  )
}

function EloLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 -140 780 780"
      className={className}
      aria-label="Elo"
    >
      {/* Yellow arc */}
      <path
        d="m167.25 181.4c6.8-2.3 14.1-3.5 21.7-3.5 33.2 0 60.9 23.601 67.2 54.9l47-9.6c-10.8-53.2-57.8-93.301-114.2-93.301-12.9 0-25.3 2.101-36.9 6l15.2 45.501z"
        fill="#FFF100"
      />
      {/* Blue arc */}
      <path
        d="m111.75 333.8l31.8-36c-14.2-12.6-23.1-30.9-23.1-51.4 0-20.399 8.9-38.8 23.1-51.3l-31.8-35.899c-24.1 21.399-39.3 52.5-39.3 87.3 0 34.699 15.2 65.898 39.3 87.299z"
        fill="#00A3DF"
      />
      {/* Red arc */}
      <path
        d="m256.15 260.2c-6.4 31.3-34 54.8-67.2 54.8-7.6 0-14.9-1.2-21.8-3.5l-15.2 45.5c11.6 3.899 24.1 6 37 6 56.4 0 103.4-40 114.2-93.2l-47-9.6z"
        fill="#EE4023"
      />
      {/* White "elo" text */}
      <path
        d="m459.75 292.4c-7.8 7.601-18.3 12.2-29.9 12-8-0.1-15.399-2.5-21.6-6.5l-15.601 24.801c10.7 6.699 23.2 10.699 36.801 10.899 19.699 0.3 37.699-7.5 50.8-20.2l-20.5-21zm-28.2-101.1c-39.2-0.6-71.6 30.8-72.2 70-0.2 14.7 4 28.5 11.5 39.9l128.8-55.101c-7.2-30.899-34.8-54.2-68.1-54.799m-42.7 75.599c-0.2-1.6-0.3-3.3-0.3-5 0.4-23.1 19.4-41.6 42.5-41.199 12.6 0.199 23.8 5.899 31.3 14.899l-73.5 31.3zm151.3-107.6v137.3l23.801 9.9-11.301 27.1-23.6-9.8c-5.3-2.3-8.9-5.8-11.6-9.8-2.601-4-4.601-9.601-4.601-17v-137.7h27.301zm85.901 63.5c4.2-1.4 8.6-2.1 13.3-2.1 20.3 0 37.101 14.399 41 33.5l28.7-5.9c-6.6-32.5-35.3-56.9-69.7-56.9-7.899 0-15.5 1.301-22.5 3.601l9.2 27.799zm-33.901 92.9l19.4-21.9c-8.7-7.7-14.1-18.9-14.1-31.4s5.5-23.699 14.1-31.3l-19.4-21.899c-14.699 13-24 32.1-24 53.3s9.301 40.199 24 53.199zm88.201-44.801c-3.899 19.101-20.8 33.5-41 33.5-4.6 0-9.1-0.8-13.3-2.199l-9.3 27.8c7.1 2.399 14.7 3.7 22.6 3.7 34.4 0 63.101-24.4 69.7-56.9l-28.7-5.901z"
        fill="#ffffff"
      />
    </svg>
  )
}

function CardBrandLogo({
  brand,
  className,
}: {
  brand: CardBrand
  className?: string
}) {
  switch (brand) {
    case 'visa':
      return <VisaLogo className={cn('h-8 text-white', className)} />
    case 'mastercard':
      return <MastercardLogo className={className} />
    case 'amex':
      return <AmexLogo className={cn('h-8', className)} />
    case 'elo':
      return <EloLogo className={cn('h-12 w-20', className)} />
    default:
      return null
  }
}

function formatDisplayNumber(num: string): string[] {
  const cleaned = num.replace(/\s/g, '')
  const groups = cleaned.match(/.{1,4}/g) || []
  const padded = [...groups]
  while (padded.length < 4) {
    padded.push('')
  }
  return padded.map((group) => group.padEnd(4, '•'))
}

export function CreditCardDisplay({
  cardNumber,
  cardHolder,
  expiryDate,
  cvv,
  cardBrand,
  isFlipped,
}: CreditCardDisplayProps) {
  const formattedNumber = formatDisplayNumber(cardNumber)
  const gradient = BRAND_GRADIENTS[cardBrand]

  return (
    <div
      className="relative mx-auto w-full max-w-[320px] aspect-[1.586/1]"
      style={{ perspective: '1000px' }}
    >
      <div
        className={cn(
          'relative size-full transition-transform duration-500',
          isFlipped && '[transform:rotateY(180deg)]',
        )}
        style={{ transformStyle: 'preserve-3d' }}
      >
        {/* Front of card */}
        <div
          className={cn(
            'absolute inset-0 flex flex-col justify-between rounded-xl p-5 shadow-lg',
            'bg-gradient-to-br',
            gradient,
          )}
          style={{ backfaceVisibility: 'hidden' }}
        >
          {/* Decorative circles */}
          <div className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-white/5" />
          <div className="pointer-events-none absolute -bottom-8 -left-8 size-24 rounded-full bg-white/5" />

          {/* Header: Chip + Contactless + Brand */}
          <div className="relative z-10 flex items-start justify-between">
            <div className="flex items-center gap-3">
              {/* Chip */}
              <div className="grid h-8 w-11 grid-cols-3 gap-px overflow-hidden rounded bg-gradient-to-br from-amber-300 to-amber-500 p-1">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="rounded-sm bg-amber-400/60" />
                ))}
              </div>
              {/* Contactless */}
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                className="text-white/80"
                aria-hidden="true"
              >
                <path
                  d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.3"
                />
                <path
                  d="M8.5 14.5a5 5 0 000-5M10.5 16a7 7 0 000-8M12.5 17.5a9 9 0 000-11"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <CardBrandLogo brand={cardBrand} />
          </div>

          {/* Card Number */}
          <div className="relative z-10">
            <div className="flex gap-3 font-mono text-lg tracking-widest text-white sm:text-xl">
              {formattedNumber.map((group, i) => (
                <span key={i} className="transition-all duration-150">
                  {group}
                </span>
              ))}
            </div>
          </div>

          {/* Footer: Holder + Expiry */}
          <div className="relative z-10 flex items-end justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-[9px] uppercase tracking-wider text-white/50">
                Titular
              </p>
              <p className="truncate font-medium text-sm uppercase tracking-wide text-white">
                {cardHolder || 'SEU NOME'}
              </p>
            </div>
            <div className="ml-4 text-right">
              <p className="text-[9px] uppercase tracking-wider text-white/50">
                Validade
              </p>
              <p className="font-mono text-sm text-white">
                {expiryDate || 'MM/AA'}
              </p>
            </div>
          </div>
        </div>

        {/* Back of card */}
        <div
          className={cn(
            'absolute inset-0 overflow-hidden rounded-xl shadow-lg',
            'bg-gradient-to-br',
            gradient,
          )}
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
        >
          {/* Magnetic stripe */}
          <div className="mt-5 h-10 w-full bg-zinc-900" />

          {/* CVV section */}
          <div className="mt-5 px-5">
            <div className="flex items-center justify-end gap-3 rounded bg-white/90 px-3 py-2">
              <div className="h-3 w-24 rounded bg-zinc-300" />
              <span className="min-w-[36px] text-right font-mono text-sm tracking-widest text-zinc-900">
                {cvv || '•••'}
              </span>
            </div>
            <p className="mt-1.5 text-right text-[9px] uppercase tracking-wider text-white/50">
              CVV
            </p>
          </div>

          {/* Brand logo on back */}
          <div className="absolute bottom-5 right-5">
            <CardBrandLogo brand={cardBrand} className="opacity-80" />
          </div>
        </div>
      </div>
    </div>
  )
}
