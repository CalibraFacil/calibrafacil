import * as React from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Certificate01Icon,
  RulerIcon,
  UserIcon,
  Wrench01Icon,
} from '@hugeicons/core-free-icons'
import { toast } from 'sonner'

import { useCommandPalette } from '../command-context'
import type { MockAsset } from '@/lib/mock/assets'
import type { MockCertificate } from '@/lib/mock/certificates'
import type { MockClient } from '@/lib/mock/clients'
import {
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@/components/ui/command'
import { searchAssets } from '@/lib/mock/assets'
import { searchCertificates } from '@/lib/mock/certificates'
import { searchClients } from '@/lib/mock/clients'

type SearchMode = 'assets' | 'certificates' | 'clients' | 'standards' | null

export function GlobalSearchGroup({ searchValue }: { searchValue: string }) {
  const { setOpen, setPages, activePage } = useCommandPalette()
  const [searchMode, setSearchMode] = React.useState<SearchMode>(null)

  // Reset search mode when navigating back to root
  React.useEffect(() => {
    if (activePage === 'root') {
      setSearchMode(null)
    }
  }, [activePage])

  // Search results based on current mode and search value
  const assetResults = React.useMemo(() => {
    if (searchMode !== 'assets' || !searchValue.trim()) return []
    return searchAssets(searchValue).slice(0, 5)
  }, [searchMode, searchValue])

  const certificateResults = React.useMemo(() => {
    if (searchMode !== 'certificates' || !searchValue.trim()) return []
    return searchCertificates(searchValue).slice(0, 5)
  }, [searchMode, searchValue])

  const clientResults = React.useMemo(() => {
    if (searchMode !== 'clients' || !searchValue.trim()) return []
    return searchClients(searchValue).slice(0, 5)
  }, [searchMode, searchValue])

  const handleSelectAsset = (asset: MockAsset) => {
    toast.success(`Ativo selecionado: ${asset.name}`, {
      description: `NS: ${asset.serialNumber} | Cliente: ${asset.clientName}`,
    })
    setOpen(false)
  }

  const handleSelectCertificate = (cert: MockCertificate) => {
    toast.success(`Certificado selecionado: ${cert.certificateNumber}`, {
      description: `${cert.assetName} | Válido até: ${cert.expirationDate}`,
    })
    setOpen(false)
  }

  const handleSelectClient = (client: MockClient) => {
    toast.success(`Cliente selecionado: ${client.name}`, {
      description: `${client.activeAssets} ativos | Contato: ${client.contactPerson}`,
    })
    setOpen(false)
  }

  // If we're in a search mode, show results
  if (searchMode === 'assets') {
    return (
      <CommandGroup heading="Resultados - Ativos">
        {assetResults.length === 0 && searchValue.trim() && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Nenhum ativo encontrado para "{searchValue}"
          </div>
        )}
        {assetResults.map((asset) => (
          <CommandItem key={asset.id} onSelect={() => handleSelectAsset(asset)}>
            <HugeiconsIcon icon={Wrench01Icon} />
            <div className="flex flex-col">
              <span>{asset.name}</span>
              <span className="text-xs text-muted-foreground">
                {asset.serialNumber} • {asset.clientName}
              </span>
            </div>
          </CommandItem>
        ))}
      </CommandGroup>
    )
  }

  if (searchMode === 'certificates') {
    return (
      <CommandGroup heading="Resultados - Certificados">
        {certificateResults.length === 0 && searchValue.trim() && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Nenhum certificado encontrado para "{searchValue}"
          </div>
        )}
        {certificateResults.map((cert) => (
          <CommandItem
            key={cert.id}
            onSelect={() => handleSelectCertificate(cert)}
          >
            <HugeiconsIcon icon={Certificate01Icon} />
            <div className="flex flex-col">
              <span>{cert.certificateNumber}</span>
              <span className="text-xs text-muted-foreground">
                {cert.assetName} • {cert.clientName}
              </span>
            </div>
          </CommandItem>
        ))}
      </CommandGroup>
    )
  }

  if (searchMode === 'clients') {
    return (
      <CommandGroup heading="Resultados - Clientes">
        {clientResults.length === 0 && searchValue.trim() && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Nenhum cliente encontrado para "{searchValue}"
          </div>
        )}
        {clientResults.map((client) => (
          <CommandItem
            key={client.id}
            onSelect={() => handleSelectClient(client)}
          >
            <HugeiconsIcon icon={UserIcon} />
            <div className="flex flex-col">
              <span>{client.name}</span>
              <span className="text-xs text-muted-foreground">
                {client.contactPerson} • {client.activeAssets} ativos
              </span>
            </div>
          </CommandItem>
        ))}
      </CommandGroup>
    )
  }

  if (searchMode === 'standards') {
    return (
      <CommandGroup heading="Resultados - Padrões">
        <div className="py-6 text-center text-sm text-muted-foreground">
          Busca de padrões será implementada em breve.
        </div>
      </CommandGroup>
    )
  }

  // Default: show search options
  return (
    <CommandGroup heading="Busca Global">
      <CommandItem
        onSelect={() => {
          setSearchMode('assets')
          setPages((prev) => [...prev, 'search-assets'])
        }}
      >
        <HugeiconsIcon icon={Wrench01Icon} />
        <span>Buscar Ativo por ID/NS...</span>
        <CommandShortcut>⌘1</CommandShortcut>
      </CommandItem>

      <CommandItem
        onSelect={() => {
          setSearchMode('certificates')
          setPages((prev) => [...prev, 'search-certificates'])
        }}
      >
        <HugeiconsIcon icon={Certificate01Icon} />
        <span>Buscar Certificado...</span>
        <CommandShortcut>⌘2</CommandShortcut>
      </CommandItem>

      <CommandItem
        onSelect={() => {
          setSearchMode('clients')
          setPages((prev) => [...prev, 'search-clients'])
        }}
      >
        <HugeiconsIcon icon={UserIcon} />
        <span>Buscar Cliente...</span>
        <CommandShortcut>⌘3</CommandShortcut>
      </CommandItem>

      <CommandItem
        onSelect={() => {
          setSearchMode('standards')
          setPages((prev) => [...prev, 'search-standards'])
        }}
      >
        <HugeiconsIcon icon={RulerIcon} />
        <span>Buscar Padrão...</span>
        <CommandShortcut>⌘4</CommandShortcut>
      </CommandItem>
    </CommandGroup>
  )
}
