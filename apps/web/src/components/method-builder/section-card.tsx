import type { ReactNode } from 'react'
import { Add01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { Button } from '@/components/ui/button'
import {
  ACTION_BUTTON_CLASS,
  Panel,
  PanelHeader,
} from '@/components/instrument-panel'

export function SectionCard({
  id,
  title,
  description,
  actionLabel,
  onAction,
  count,
  children,
}: {
  id?: string
  title: string
  description: string
  actionLabel: string
  onAction: () => void
  count?: number
  children: ReactNode
}) {
  return (
    <Panel id={id} className="scroll-mt-16 p-4 sm:p-5">
      <PanelHeader
        eyebrow={count !== undefined ? `${count}` : undefined}
        title={title}
        description={description}
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAction}
            className={ACTION_BUTTON_CLASS}
          >
            <HugeiconsIcon icon={Add01Icon} className="mr-2 size-4" />
            {actionLabel}
          </Button>
        }
      />
      <div className="mt-4 space-y-3">{children}</div>
    </Panel>
  )
}
