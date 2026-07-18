import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon } from '@hugeicons/core-free-icons'

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { describeIssueLocation, type ValidationIssue } from './forms'

/**
 * Floating validation chip (shell reframe step 3): replaces the full-width
 * issues panel that pushed the canvas down. Fixed to the bottom-right of the
 * viewport; the count is always visible, the list opens on demand, and each
 * issue is mapped to its block via describeIssueLocation. Inline badges on
 * the offending blocks (certificate-editor) close the read→hunt loop.
 */
export function ValidationChip({
  issues,
  documentJson,
}: {
  issues: ValidationIssue[]
  documentJson: Record<string, unknown>
}) {
  const [open, setOpen] = useState(false)
  if (issues.length === 0) return null
  return (
    <div className="fixed right-4 bottom-4 z-40">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              data-testid="validation-issues"
              className="flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs font-semibold text-destructive shadow-lg backdrop-blur transition-[scale,background-color] hover:bg-destructive/15 active:scale-[0.96]"
            >
              <HugeiconsIcon icon={Alert02Icon} size={14} strokeWidth={2} />
              {issues.length === 1
                ? '1 problema de validação'
                : `${issues.length} problemas de validação`}
            </button>
          }
        />
        <PopoverContent
          align="end"
          side="top"
          sideOffset={8}
          className="w-96 p-3"
        >
          <h2 className="text-sm font-semibold text-destructive">
            Problemas de validação
          </h2>
          <ul className="space-y-1 text-xs" role="alert">
            {issues.map((issue, index) => {
              const location = describeIssueLocation(documentJson, issue.path)
              return (
                <li key={`${issue.path}-${index}`} className="flex gap-1.5">
                  {location && (
                    <span className="shrink-0 font-medium">{location}:</span>
                  )}
                  <span className="text-pretty">{issue.message}</span>
                </li>
              )
            })}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  )
}
