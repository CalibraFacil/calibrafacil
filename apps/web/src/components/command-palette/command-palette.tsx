import { KeyboardEvent, useCallback } from 'react'
import { useCommandPalette } from './command-context'
import { ContextGroup } from './groups/context-group'
import { QuickCreateGroup } from './groups/quick-create'
import { GlobalSearchGroup } from './groups/global-search'
import { NavigationGroup } from './groups/navigation-group'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandInput,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { OrganizationGroup } from './groups/organization-group'

export function CommandPalette() {
  const { open, setOpen, activePage, setPages, searchValue, setSearchValue } =
    useCommandPalette()

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)
    },
    [setOpen],
  )

  // Backspace on an empty query returns to the previous page; Escape closes.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (activePage !== 'root' && e.key === 'Backspace' && !searchValue) {
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
      case 'organizations':
        return 'Buscar organização...'
      case 'search-clients':
        return 'Buscar cliente por nome ou CNPJ...'
      case 'search-standards':
        return 'Buscar padrão por identificação...'
      case 'search-jobs':
        return 'Buscar calibração...'
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
        description="Busque registros, navegue entre páginas e selecione ações."
      >
        <Command
          key={activePage}
          onKeyDown={handleKeyDown}
          shouldFilter={activePage === 'root' || activePage === 'organizations'}
        >
          <CommandInput
            autoFocus
            aria-label={getPlaceholder()}
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

            {activePage === 'organizations' && <OrganizationGroup />}
            {activePage.startsWith('search-') && (
              <GlobalSearchGroup searchValue={searchValue} />
            )}
          </CommandList>
          <CommandFooter>
            {activePage !== 'root' ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPages((previous) => previous.slice(0, -1))
                  setSearchValue('')
                }}
              >
                Voltar
              </Button>
            ) : (
              <span>Selecione uma ação para continuar</span>
            )}
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Fechar
            </Button>
          </CommandFooter>
        </Command>
      </CommandDialog>
    </>
  )
}
