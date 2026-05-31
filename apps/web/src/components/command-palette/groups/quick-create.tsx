import { useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  AlertDiamondIcon,
  Package01Icon,
  ThermometerIcon,
} from '@hugeicons/core-free-icons'

import { useCommandPalette } from '../command-context'
import { CommandGroup, CommandItem } from '@/components/ui/command'
import { ShortcutHint } from '../shortcuts'

export function QuickCreateGroup() {
  const navigate = useNavigate()
  const { setOpen } = useCommandPalette()

  return (
    <CommandGroup heading="Criação Rápida">
      <CommandItem
        onSelect={() => {
          setOpen(false)
          navigate({ to: '/dashboard/jobs/new' })
        }}
      >
        <HugeiconsIcon icon={Add01Icon} className="text-blue-500" />
        <span>Nova Calibração</span>
        <ShortcutHint id="createCalibration" />
      </CommandItem>
      <CommandItem
        onSelect={() => {
          setOpen(false)
          navigate({ to: '/dashboard/service-orders/new' })
        }}
      >
        <HugeiconsIcon icon={Add01Icon} className="text-blue-500" />
        <span>Nova Ordem de Serviço</span>
        <ShortcutHint id="createServiceOrder" />
      </CommandItem>

      <CommandItem
        onSelect={() => {
          setOpen(false)
          navigate({ to: '/dashboard/settings/environment' })
        }}
      >
        <HugeiconsIcon icon={ThermometerIcon} className="text-orange-500" />
        <span>Configurar Condições Ambientais</span>
        <ShortcutHint id="createEnvironment" />
      </CommandItem>

      <CommandItem
        onSelect={() => {
          setOpen(false)
          navigate({ to: '/dashboard/assets/new' })
        }}
      >
        <HugeiconsIcon icon={Package01Icon} className="text-green-500" />
        <span>Registrar Entrada de Ativo</span>
        <ShortcutHint id="createAsset" />
      </CommandItem>

      <CommandItem
        onSelect={() => {
          setOpen(false)
          navigate({ to: '/dashboard/nc/new' })
        }}
      >
        <HugeiconsIcon icon={AlertDiamondIcon} className="text-red-500" />
        <span>Criar Relatório de Não Conformidade</span>
        <ShortcutHint id="createNonConformance" />
      </CommandItem>
    </CommandGroup>
  )
}
