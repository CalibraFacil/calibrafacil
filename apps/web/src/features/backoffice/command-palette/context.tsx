import * as React from 'react'

import { useMountEffect } from '@/hooks/use-mount-effect'

type BackofficeCommandPaletteContextValue = {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

const BackofficeCommandPaletteContext =
  React.createContext<BackofficeCommandPaletteContextValue | null>(null)

export function useBackofficeCommandPalette() {
  const context = React.useContext(BackofficeCommandPaletteContext)
  if (!context) {
    throw new Error(
      'useBackofficeCommandPalette must be used within a BackofficeCommandPaletteProvider',
    )
  }
  return context
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

export function BackofficeCommandPaletteProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const openRef = React.useRef(open)
  openRef.current = open

  useMountEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(!openRef.current)
        return
      }
      // "/" opens search when not already typing somewhere.
      if (
        event.key === '/' &&
        !openRef.current &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault()
        setOpen(true)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  })

  const value = React.useMemo<BackofficeCommandPaletteContextValue>(
    () => ({
      open,
      setOpen,
      toggle: () => setOpen((previous) => !previous),
    }),
    [open],
  )

  return (
    <BackofficeCommandPaletteContext.Provider value={value}>
      {children}
    </BackofficeCommandPaletteContext.Provider>
  )
}
