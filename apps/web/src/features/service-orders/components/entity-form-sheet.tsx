import { type ReactNode } from 'react'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

/**
 * Wide right-side sheet that hosts an entity form inside the Service Order
 * workflow, so supporting records can be created/edited without leaving the OS.
 * The body scrolls; forms render their own sticky action bars at the bottom.
 */
export function EntityFormSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl data-[side=right]:lg:max-w-2xl"
      >
        <SheetHeader className="border-b border-foreground/10 px-5 py-4 pr-12">
          <SheetTitle className="text-base font-semibold">{title}</SheetTitle>
          {description ? (
            <SheetDescription>{description}</SheetDescription>
          ) : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  )
}
