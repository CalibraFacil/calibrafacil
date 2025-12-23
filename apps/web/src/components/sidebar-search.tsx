import * as React from 'react'
import { SearchIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { useCommandPalette } from './command-palette/command-context'
import { Kbd } from '@/components/ui/kbd'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

export function SidebarSearch() {
  const { setOpen } = useCommandPalette()
  const { state } = useSidebar()
  const [isMac, setIsMac] = React.useState(false)

  React.useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().indexOf('MAC') >= 0)
  }, [])

  const isCollapsed = state === 'collapsed'

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={() => setOpen(true)}
          className="h-8 cursor-pointer justify-between"
          tooltip={isCollapsed ? 'Buscar (Ctrl+K)' : undefined}
        >
          <div className="flex items-center gap-2">
            <HugeiconsIcon icon={SearchIcon} className="size-4 opacity-60" />
            {!isCollapsed && (
              <span className="text-muted-foreground text-sm">Buscar...</span>
            )}
          </div>
          {!isCollapsed && (
            <Kbd className="text-[10px] opacity-60">
              {isMac ? '⌘+K' : 'Ctrl+K'}
            </Kbd>
          )}
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
