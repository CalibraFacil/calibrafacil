import * as React from 'react'

import { useCommandPalette } from './command-context'
import { ContextGroup } from './groups/context-group'
import { QuickCreateGroup } from './groups/quick-create'
import { GlobalSearchGroup } from './groups/global-search'
import { NavigationGroup } from './groups/navigation-group'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'

export function CommandPalette() {
  const { open, setOpen, activePage, setPages, searchValue, setSearchValue } =
    useCommandPalette()

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)
    },
    [setOpen],
  )

  // Handle back navigation with Escape or Backspace on empty input
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (
        activePage !== 'root' &&
        (e.key === 'Escape' || (e.key === 'Backspace' && !searchValue))
      ) {
        e.preventDefault()
        setPages((prev) => prev.slice(0, -1))
        setSearchValue('')
      }
    },
    [activePage, searchValue, setPages, setSearchValue],
  )

  const getPlaceholder = () => {
    switch (activePage) {
      case 'search-assets':
        return 'Buscar ativo por ID ou número de série...'
      case 'search-certificates':
        return 'Buscar certificado por número...'
      case 'search-clients':
        return 'Buscar cliente por nome ou CNPJ...'
      case 'search-standards':
        return 'Buscar padrão por identificação...'
      case 'search-jobs':
        return 'Buscar ordem de serviço...'
      default:
        return 'Digite um comando ou busque...'
    }
  }

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Paleta de Comandos"
        description="Use atalhos de teclado para navegar rapidamente pelo sistema."
      >
        <Command onKeyDown={handleKeyDown} shouldFilter={activePage === 'root'}>
          <CommandInput
            placeholder={getPlaceholder()}
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList>
            {activePage === 'root' && (
              <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>
            )}

            {activePage === 'root' && (
              <>
                <ContextGroup />
                <QuickCreateGroup />
                <CommandSeparator />
                <GlobalSearchGroup
                  searchValue={searchValue}
                  onSearchModeSelect={() => setSearchValue('')}
                />
                <CommandSeparator />
                <NavigationGroup />
              </>
            )}

            {activePage !== 'root' && (
              <GlobalSearchGroup searchValue={searchValue} />
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
