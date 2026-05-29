import { cn } from '@/lib/utils'

export type FormNavSection = {
  id: string
  label: string
  /** Filled dot when true, hollow when false; neutral marker when undefined. */
  complete?: boolean
  optional?: boolean
}

/**
 * Sticky in-page navigator for long asset forms. Two modes:
 *  - jump (default): clicking scrolls to the section anchor (single-page form).
 *  - stepper: pass `activeId` + `onSelect` to drive a wizard; the active step is
 *    highlighted and clicks switch steps instead of scrolling.
 * Desktop-only — on small screens the form simply stacks / steps via buttons.
 */
export function FormSectionNav({
  sections,
  activeId,
  onSelect,
  className,
}: {
  sections: FormNavSection[]
  activeId?: string
  onSelect?: (id: string) => void
  className?: string
}) {
  const handleClick = (id: string) => {
    if (onSelect) {
      onSelect(id)
      return
    }
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <nav
      aria-label="Seções do formulário"
      className={cn(
        'hidden lg:sticky lg:top-6 lg:block lg:self-start',
        className,
      )}
    >
      <p className="px-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Seções
      </p>
      <ul className="mt-2 space-y-0.5">
        {sections.map((section) => {
          const isActive = activeId === section.id
          return (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => handleClick(section.id)}
                aria-current={isActive ? 'step' : undefined}
                className={cn(
                  'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  isActive
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'size-1.5 shrink-0 rounded-full transition-colors',
                    section.complete === undefined
                      ? isActive
                        ? 'bg-foreground/70'
                        : 'bg-muted-foreground/40 group-hover:bg-foreground/60'
                      : section.complete
                        ? 'bg-primary'
                        : 'bg-transparent ring-1 ring-inset ring-muted-foreground/40',
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{section.label}</span>
                {section.optional ? (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
                    opcional
                  </span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
