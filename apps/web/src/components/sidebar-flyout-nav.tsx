import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import * as React from 'react'

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { useMenuAim } from '@/hooks/use-menu-aim'
import { cn } from '@/lib/utils'

type SidebarFlyoutNavContextValue = {
  openItem: string | null
  setOpenItem: React.Dispatch<React.SetStateAction<string | null>>
}

const SidebarFlyoutNavContext =
  React.createContext<SidebarFlyoutNavContextValue | null>(null)

function useSidebarFlyoutNav() {
  const context = React.useContext(SidebarFlyoutNavContext)

  if (!context) {
    throw new Error('SidebarFlyoutItem must be used inside SidebarFlyoutNav.')
  }

  return context
}

export function SidebarFlyoutProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [openItem, setOpenItem] = React.useState<string | null>(null)
  const contextValue = React.useMemo(
    () => ({ openItem, setOpenItem }),
    [openItem],
  )

  return (
    <SidebarFlyoutNavContext.Provider value={contextValue}>
      {children}
    </SidebarFlyoutNavContext.Provider>
  )
}

export function SidebarFlyoutNav({ children }: { children: React.ReactNode }) {
  const context = React.useContext(SidebarFlyoutNavContext)
  const menu = <SidebarMenu>{children}</SidebarMenu>

  if (context) {
    return menu
  }

  return <SidebarFlyoutProvider>{menu}</SidebarFlyoutProvider>
}

export function SidebarFlyoutItem({
  children,
  controlId,
  icon,
  isActive,
  itemId,
  render,
  title,
  triggerProps,
  triggerType = 'button',
}: {
  children: React.ReactNode
  controlId: string
  icon?: React.ReactNode
  isActive: boolean
  itemId: string
  render?: React.ReactElement
  title: string
  triggerProps?: React.ComponentProps<'button'>
  triggerType?: 'button' | 'link'
}) {
  const { openItem, setOpenItem } = useSidebarFlyoutNav()
  const open = openItem === itemId
  const {
    flyoutRef,
    getFlyoutPointerHandlers,
    getParentPointerHandlers,
    parentRef,
  } = useMenuAim<HTMLButtonElement, HTMLDivElement>({
    open,
    onClose: () => {
      setOpenItem((current) => (current === itemId ? null : current))
    },
  })
  const [panelPosition, setPanelPosition] = React.useState({
    left: 0,
    top: 0,
  })

  const openFlyout = React.useCallback(() => {
    const rect = parentRef.current?.getBoundingClientRect()

    if (rect) {
      setPanelPosition({
        left: rect.right + 10,
        top: Math.max(8, rect.top),
      })
    }

    setOpenItem(itemId)
  }, [itemId, parentRef, setOpenItem])

  React.useLayoutEffect(() => {
    if (!open) {
      return
    }

    const parentRect = parentRef.current?.getBoundingClientRect()
    const flyoutRect = flyoutRef.current?.getBoundingClientRect()

    if (!parentRect) {
      return
    }

    const flyoutHeight = flyoutRect?.height ?? 0
    const top = Math.max(
      8,
      Math.min(parentRect.top, window.innerHeight - flyoutHeight - 8),
    )

    setPanelPosition({
      left: parentRect.right + 10,
      top,
    })
  }, [flyoutRef, open, parentRef])

  const parentPointerHandlers = getParentPointerHandlers()

  return (
    <SidebarMenuItem
      onBlur={(event) => {
        const nextTarget = event.relatedTarget

        if (
          nextTarget instanceof Node &&
          (parentRef.current?.contains(nextTarget) ||
            flyoutRef.current?.contains(nextTarget))
        ) {
          return
        }

        setOpenItem((current) => (current === itemId ? null : current))
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          setOpenItem(null)
          parentRef.current?.focus()
        }
      }}
    >
      <SidebarMenuButton
        {...triggerProps}
        ref={parentRef}
        aria-controls={controlId}
        aria-expanded={open}
        aria-haspopup="true"
        className="transition-[background-color,color]"
        isActive={isActive || open}
        onClick={(event) => {
          triggerProps?.onClick?.(event)

          if (event.defaultPrevented) {
            return
          }

          if (triggerType === 'button') {
            event.preventDefault()
            setOpenItem(open ? null : itemId)
          }
        }}
        onFocus={(event) => {
          triggerProps?.onFocus?.(event)
          openFlyout()
        }}
        onPointerEnter={(event) => {
          parentPointerHandlers.onPointerEnter(event)
          openFlyout()
        }}
        onPointerLeave={parentPointerHandlers.onPointerLeave}
        onPointerMove={parentPointerHandlers.onPointerMove}
        render={render}
        type={triggerType === 'button' ? 'button' : undefined}
      >
        {icon}
        <span>{title}</span>
        <span
          className={cn(
            'ml-auto text-sidebar-foreground/60',
            open && 'text-sidebar-foreground',
          )}
        >
          <HugeiconsIcon icon={ArrowRight01Icon} />
        </span>
      </SidebarMenuButton>

      {open ? (
        <SidebarFlyoutPanel
          ref={flyoutRef}
          controlId={controlId}
          label={title}
          onPointerHandlers={getFlyoutPointerHandlers()}
          style={{
            left: panelPosition.left,
            top: panelPosition.top,
          }}
        >
          {children}
        </SidebarFlyoutPanel>
      ) : null}
    </SidebarMenuItem>
  )
}

export const SidebarFlyoutPanel = React.forwardRef<
  HTMLDivElement,
  {
    children: React.ReactNode
    controlId: string
    label: string
    onPointerHandlers: ReturnType<
      ReturnType<
        typeof useMenuAim<HTMLButtonElement, HTMLDivElement>
      >['getFlyoutPointerHandlers']
    >
    style: React.CSSProperties
  }
>(function SidebarFlyoutPanel(
  { children, controlId, label, onPointerHandlers, style },
  ref,
) {
  return (
    <div
      ref={ref}
      aria-label={label}
      className="bg-popover text-popover-foreground border-border fixed z-50 min-w-56 rounded-lg border p-1.5 shadow-lg shadow-black/10 outline-hidden transition-[opacity,transform] duration-150 ease-out"
      id={controlId}
      onPointerEnter={onPointerHandlers.onPointerEnter}
      onPointerLeave={onPointerHandlers.onPointerLeave}
      onPointerMove={onPointerHandlers.onPointerMove}
      role="navigation"
      style={style}
    >
      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
        {label}
      </div>
      <ul className="flex min-w-0 flex-col gap-1">{children}</ul>
    </div>
  )
})
