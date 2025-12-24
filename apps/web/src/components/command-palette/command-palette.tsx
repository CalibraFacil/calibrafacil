import * as React from 'react'

import { useCommandPalette } from './command-context'
import { ContextGroup } from './groups/context-group'
import { QuickCreateGroup } from './groups/quick-create'
import { GlobalSearchGroup } from './groups/global-search'
import { NavigationGroup } from './groups/navigation-group'
import { LogEnvironmentalDialog } from './dialogs/log-environmental'
import { RegisterEquipmentDialog } from './dialogs/register-equipment'

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'

export function CommandPalette() {
  const { open, setOpen, activePage, setPages } = useCommandPalette()
  const [searchValue, setSearchValue] = React.useState('')

  // Reset search when closing
  React.useEffect(() => {
    if (!open) {
      setSearchValue('')
    }
  }, [open])

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
    [activePage, searchValue, setPages],
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
      default:
        return 'Digite um comando ou busque...'
    }
  }

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Paleta de Comandos"
        description="Use atalhos de teclado para navegar rapidamente pelo sistema."
      >
        <Command onKeyDown={handleKeyDown}>
          <CommandInput
            placeholder={getPlaceholder()}
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList>
            <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>

            {activePage === 'root' && (
              <>
                <ContextGroup />
                <QuickCreateGroup />
                <CommandSeparator />
                <GlobalSearchGroup searchValue={searchValue} />
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

      {/* Dialogs that can be opened from command palette */}
      <LogEnvironmentalDialog />
      <RegisterEquipmentDialog />
    </>
  )
}
