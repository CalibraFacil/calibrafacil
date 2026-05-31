import { cn } from '@/lib/utils'

import { Reveal } from './reveal'

export type NumberedPoint = readonly [
  number: string,
  title: string,
  body: string,
]

/** Left- or center-aligned section header (title + lead), revealed on scroll. */
export function SectionHeading({
  title,
  lead,
  center = false,
}: {
  title: string
  lead: string
  center?: boolean
}) {
  return (
    <div
      className={cn(
        'mb-14',
        center ? 'mx-auto max-w-[760px] text-center' : 'max-w-[760px]',
      )}
    >
      <Reveal>
        <h2
          className={cn(
            'max-w-[22ch] text-[clamp(28px,3.6vw,44px)] leading-[1.1] font-semibold tracking-tight text-balance',
            center && 'mx-auto',
          )}
        >
          {title}
        </h2>
        <p
          className={cn(
            'mt-4 max-w-[56ch] text-lg leading-relaxed text-pretty text-muted-foreground',
            center && 'mx-auto',
          )}
        >
          {lead}
        </p>
      </Reveal>
    </div>
  )
}

/** Editorial numbered list — mono index over a short accent rule, then title + body. */
export function NumberedPoints({
  items,
  columns = 2,
}: {
  items: readonly NumberedPoint[]
  columns?: 2 | 3
}) {
  return (
    <ul
      className={cn(
        'grid',
        columns === 3
          ? 'gap-x-10 gap-y-8 md:grid-cols-3 md:gap-x-12'
          : 'gap-x-10 gap-y-5 md:grid-cols-2 md:gap-x-14 md:gap-y-6',
      )}
    >
      {items.map(([num, title, body]) => (
        <li
          key={num}
          className="grid grid-cols-[28px_1fr] gap-3.5 text-sm leading-normal"
        >
          <span className="mt-1 w-5 self-start border-t border-primary/50 pt-0.5 font-mono text-xs tracking-wider text-primary">
            {num}
          </span>
          <div>
            <div className="mb-1 font-medium text-foreground">{title}</div>
            <div className="text-sm leading-relaxed text-muted-foreground">
              {body}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}
