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
  const { setOpen, setEnvironmentalDialogOpen, setEquipmentDialogOpen } =
    useCommandPalette()

  return (
    <CommandGroup heading="Criação Rápida">
      <CommandItem
        onSelect={() => {
          toast.info('Abrindo assistente de nova ordem...', {
            description: 'Iniciando fluxo de criação de ordem de serviço.',
          })
          setOpen(false)
        }}
      >
        <HugeiconsIcon icon={Add01Icon} className="text-blue-500" />
        <span>Nova Ordem de Serviço</span>
        <CommandShortcut>⌘N</CommandShortcut>
      </CommandItem>

      <CommandItem
        onSelect={() => {
          setOpen(false)
          // Small delay to allow command palette to close
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
          setTimeout(() => {
            setEquipmentDialogOpen(true)
          }, 100)
        }}
      >
        <HugeiconsIcon icon={Package01Icon} className="text-green-500" />
        <span>Registrar Entrada de Ativo</span>
        <CommandShortcut>⌘I</CommandShortcut>
      </CommandItem>

      <CommandItem
        onSelect={() => {
          toast.info('Abrindo formulário de NCR...', {
            description: 'Criando novo Relatório de Não Conformidade.',
          })
          setOpen(false)
        }}
      >
        <HugeiconsIcon icon={AlertDiamondIcon} className="text-red-500" />
        <span>Criar Relatório de Não Conformidade</span>
        <CommandShortcut>⌘R</CommandShortcut>
      </CommandItem>
    </CommandGroup>
  )
}
