'use client'

import * as React from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { useMountEffect } from '@/hooks/use-mount-effect'
import { LEADER_KEYS, matchShortcutSequence } from './shortcuts'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

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
  searchValue: string
  setSearchValue: React.Dispatch<React.SetStateAction<string>>
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
  const [open, setOpenState] = React.useState(false)
  const [searchValue, setSearchValue] = React.useState('')
  const [pages, setPages] = React.useState<Array<string>>(['root'])
  const [contextActionsRegistry, setContextActionsRegistry] = React.useState<
    Array<ContextActionsConfig>
  >([])
  const location = useLocation()
  const navigate = useNavigate()

  // Latest-value refs so the once-mounted key listener never goes stale.
  const navigateRef = React.useRef(navigate)
  navigateRef.current = navigate
  const openRef = React.useRef(open)
  openRef.current = open

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

  const setOpen = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >((value) => {
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
    let pendingLeader: string | null = null
    let leaderTimer: ReturnType<typeof setTimeout> | undefined

    const clearPending = () => {
      pendingLeader = null
      if (leaderTimer) {
        clearTimeout(leaderTimer)
        leaderTimer = undefined
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Open/close the palette — Ctrl/⌘+K is not browser-reserved.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        clearPending()
        setOpen((prev) => !prev)
        return
      }

      // Leader sequences are off while the palette is open, while typing, or
      // when a modifier is held (so Ctrl+C and friends are untouched).
      if (openRef.current) {
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isEditableTarget(e.target)) {
        clearPending()
        return
      }

      const key = e.key.toLowerCase()

      if (pendingLeader) {
        const shortcut = matchShortcutSequence(pendingLeader + key)
        clearPending()
        if (shortcut) {
          e.preventDefault()
          navigateRef.current({ to: shortcut.to })
        }
        return
      }

      if (LEADER_KEYS.has(key)) {
        pendingLeader = key
        leaderTimer = setTimeout(clearPending, 1200)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (leaderTimer) {
        clearTimeout(leaderTimer)
      }
    }
  })

  return (
    <CommandPaletteContext.Provider
      value={{
        open,
        setOpen,
        searchValue,
        setSearchValue,
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
