import type { Column } from '@tanstack/react-table'
import { HugeiconsIcon } from '@hugeicons/react'
import { PlusSignCircleIcon } from '@hugeicons/core-free-icons'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

export type FacetOption = { label: string; value: string }

function readSelected(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

/**
 * Multi-select faceted filter for a TanStack column (filterFn: 'arrIncludesSome').
 * The trigger shows the active count; each option shows its live row count from
 * the faceted model so an operator sees how many rows a facet would surface.
 */
export function DataTableFacetedFilter<TData, TValue>({
  column,
  title,
  options,
}: {
  column?: Column<TData, TValue>
  title: string
  options: FacetOption[]
}) {
  const selected = new Set(readSelected(column?.getFilterValue()))
  const facetCounts = column?.getFacetedUniqueValues()

  function toggle(value: string) {
    const next = new Set(selected)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    const arr = [...next]
    column?.setFilterValue(arr.length ? arr : undefined)
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="border-dashed" />
        }
      >
        <HugeiconsIcon icon={PlusSignCircleIcon} className="mr-2 size-4" />
        {title}
        {selected.size > 0 ? (
          <>
            <Separator orientation="vertical" className="mx-2 h-4" />
            <Badge variant="secondary" className="rounded-sm px-1 font-normal">
              {selected.size}
            </Badge>
          </>
        ) : null}
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        <div className="max-h-72 space-y-0.5 overflow-y-auto">
          {options.map((option) => {
            const isSelected = selected.has(option.value)
            const count = facetCounts?.get(option.value)
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggle(option.value)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              >
                <Checkbox
                  checked={isSelected}
                  className="pointer-events-none"
                />
                <span className="flex-1 text-left">{option.label}</span>
                {typeof count === 'number' ? (
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {count}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
        {selected.size > 0 ? (
          <>
            <Separator className="my-1" />
            <Button
              variant="ghost"
              size="sm"
              className={cn('w-full justify-center')}
              onClick={() => column?.setFilterValue(undefined)}
            >
              Limpar filtro
            </Button>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
