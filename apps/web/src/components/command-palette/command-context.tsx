'use client'

import {
  Dispatch,
  ReactNode,
  SetStateAction,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
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
  icon?: ReactNode
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
  const navigate = useNavigate()

  // Latest-value refs so the once-mounted key listener never goes stale.
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const openRef = useRef(open)
  openRef.current = open

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
