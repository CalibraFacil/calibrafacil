'use client'

import * as React from 'react'
import { useLocation } from '@tanstack/react-router'

export type CommandAction = {
  id: string
  label: string
  icon?: React.ReactNode
  shortcut?: string
  onSelect: () => void
  keywords?: Array<string>
}

export type ContextActionsConfig = {
  routePattern: RegExp
  actions: Array<CommandAction>
}

type CommandPaletteContextType = {
  open: boolean
  setOpen: (open: boolean) => void
  contextActions: Array<CommandAction>
  registerContextActions: (config: ContextActionsConfig) => () => void
  pages: Array<string>
  setPages: React.Dispatch<React.SetStateAction<Array<string>>>
  activePage: string
}

const CommandPaletteContext =
  React.createContext<CommandPaletteContextType | null>(null)

export function useCommandPalette() {
  const context = React.useContext(CommandPaletteContext)
  if (!context) {
    throw new Error(
      'useCommandPalette must be used within a CommandPaletteProvider',
    )
  }
  return context
}

export function CommandPaletteProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const [pages, setPages] = React.useState<Array<string>>(['root'])
  const [contextActionsRegistry, setContextActionsRegistry] = React.useState<
    Array<ContextActionsConfig>
  >([])
  const location = useLocation()

  const activePage = pages[pages.length - 1] ?? 'root'

  // Compute context actions based on current route
  const contextActions = React.useMemo(() => {
    const pathname = location.pathname
    for (const config of contextActionsRegistry) {
      if (config.routePattern.test(pathname)) {
        return config.actions
      }
    }
    return []
  }, [location.pathname, contextActionsRegistry])

  const registerContextActions = React.useCallback(
    (config: ContextActionsConfig) => {
      setContextActionsRegistry((prev) => [...prev, config])
      return () => {
        setContextActionsRegistry((prev) => prev.filter((c) => c !== config))
      }
    },
    [],
  )

  // Keyboard shortcut: Cmd+K / Ctrl+K
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Reset pages when closing
  React.useEffect(() => {
    if (!open) {
      setPages(['root'])
    }
  }, [open])

  return (
    <CommandPaletteContext.Provider
      value={{
        open,
        setOpen,
        contextActions,
        registerContextActions,
        pages,
        setPages,
        activePage,
      }}
    >
      {children}
    </CommandPaletteContext.Provider>
  )
}
