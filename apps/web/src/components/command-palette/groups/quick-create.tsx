import { useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  AlertDiamondIcon,
  Package01Icon,
  ThermometerIcon,
} from '@hugeicons/core-free-icons'
import { toast } from 'sonner'

import { useCommandPalette } from '../command-context'
import {
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@/components/ui/command'

export function QuickCreateGroup() {
  const navigate = useNavigate()
  const { setOpen, setEnvironmentalDialogOpen } = useCommandPalette()

  return (
    <CommandGroup heading="Criação Rápida">
      <CommandItem
        onSelect={() => {
          setOpen(false)
          navigate({ to: '/dashboard/jobs/new' })
        }}
      >
        <HugeiconsIcon icon={Add01Icon} className="text-blue-500" />
        <span>Nova Ordem de Serviço</span>
        <CommandShortcut>⌘N</CommandShortcut>
      </CommandItem>

      <CommandItem
        onSelect={() => {
          setOpen(false)
          setTimeout(() => {
            setEnvironmentalDialogOpen(true)
          }, 100)
        }}
      >
        <HugeiconsIcon icon={ThermometerIcon} className="text-orange-500" />
        <span>Registrar Condições Ambientais</span>
        <CommandShortcut>⌘E</CommandShortcut>
      </CommandItem>

      <CommandItem
        onSelect={() => {
          setOpen(false)
          navigate({ to: '/dashboard/assets/new' })
        }}
      >
        <HugeiconsIcon icon={Package01Icon} className="text-green-500" />
        <span>Registrar Entrada de Ativo</span>
        <CommandShortcut>⌘I</CommandShortcut>
      </CommandItem>

      <CommandItem
        onSelect={() => {
          toast.info('Em breve', {
            description: 'Relatórios de Não Conformidade serão implementados em breve.',
          })
          setOpen(false)
        }}
      >
        <HugeiconsIcon icon={AlertDiamondIcon} className="text-red-500" />
        <span className="flex items-center gap-2">
          Criar Relatório de Não Conformidade
          <span className="text-xs text-muted-foreground">(Em breve)</span>
        </span>
      </CommandItem>
    </CommandGroup>
  )
}
