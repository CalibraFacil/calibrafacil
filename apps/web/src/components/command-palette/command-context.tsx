'use client'

import {
  Dispatch,
  ReactNode,
  SetStateAction,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import { useLocation } from '@tanstack/react-router'
import { useMountEffect } from '@/hooks/use-mount-effect'
export type CommandAction = {
  id: string
  label: string
  icon?: ReactNode
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
  searchValue: string
  setSearchValue: Dispatch<SetStateAction<string>>
  contextActions: Array<CommandAction>
  registerContextActions: (config: ContextActionsConfig) => () => void
  pages: Array<string>
  setPages: Dispatch<SetStateAction<Array<string>>>
  activePage: string
}

const CommandPaletteContext = createContext<CommandPaletteContextType | null>(
  null,
)

export function useCommandPalette() {
  const context = useContext(CommandPaletteContext)
  if (!context) {
    throw new Error(
      'useCommandPalette must be used within a CommandPaletteProvider',
    )
  }
  return context
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [pages, setPages] = useState<Array<string>>(['root'])
  const [contextActionsRegistry, setContextActionsRegistry] = useState<
    Array<ContextActionsConfig>
  >([])
  const location = useLocation()
  const activePage = pages[pages.length - 1] ?? 'root'

  // Compute context actions based on current route
  const pathname = location.pathname
  const contextActions = useMemo(() => {
    for (const config of contextActionsRegistry) {
      if (config.routePattern.test(pathname)) {
        return config.actions
      }
    }
    return []
  }, [pathname, contextActionsRegistry])

  const registerContextActions = useCallback((config: ContextActionsConfig) => {
    setContextActionsRegistry((prev) => [...prev, config])
    return () => {
      setContextActionsRegistry((prev) => prev.filter((c) => c !== config))
    }
  }, [])

  const setOpen = useCallback<Dispatch<SetStateAction<boolean>>>((value) => {
    setOpenState((prev) => {
      const next = typeof value === 'function' ? value(prev) : value
      if (!next) {
        setPages(['root'])
        setSearchValue('')
      }
      return next
    })
  }, [])

  useMountEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !event.defaultPrevented &&
        !event.repeat &&
        !event.isComposing &&
        !event.altKey &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault()
        setOpen((previous) => !previous)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  })

  const contextValue = useMemo(
    () => ({
      open,
      setOpen,
      searchValue,
      setSearchValue,
      contextActions,
      registerContextActions,
      pages,
      setPages,
      activePage,
    }),
    [
      open,
      setOpen,
      searchValue,
      setSearchValue,
      contextActions,
      registerContextActions,
      pages,
      setPages,
      activePage,
    ],
  )

  return (
    <CommandPaletteContext.Provider value={contextValue}>
      {children}
    </CommandPaletteContext.Provider>
  )
}
