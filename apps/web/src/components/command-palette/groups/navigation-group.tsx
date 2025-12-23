'use client'

import { useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Home01Icon,
  Settings05Icon,
  Building02Icon,
  Logout01Icon,
} from '@hugeicons/core-free-icons'
import { toast } from 'sonner'

import { signOut } from '@calibra-facil/auth/client'
import { CommandGroup, CommandItem, CommandShortcut } from '@/components/ui/command'
import { useCommandPalette } from '../command-context'

export function NavigationGroup() {
  const { setOpen } = useCommandPalette()
  const navigate = useNavigate()

  const handleLogout = async () => {
    try {
      await signOut()
      toast.success('Sessão encerrada', {
        description: 'Você foi desconectado com sucesso.',
      })
      navigate({ to: '/sign-in' })
    } catch {
      toast.error('Erro ao sair', {
        description: 'Não foi possível encerrar a sessão.',
      })
    }
    setOpen(false)
  }

  return (
    <CommandGroup heading="Navegação">
      <CommandItem
        onSelect={() => {
          navigate({ to: '/dashboard' })
          setOpen(false)
        }}
      >
        <HugeiconsIcon icon={Home01Icon} />
        <span>Ir para Painel de Controle</span>
        <CommandShortcut>⌘H</CommandShortcut>
      </CommandItem>

      <CommandItem
        onSelect={() => {
          navigate({ to: '/dashboard/settings' })
          setOpen(false)
        }}
      >
        <HugeiconsIcon icon={Settings05Icon} />
        <span>Ir para Configurações</span>
        <CommandShortcut>⌘,</CommandShortcut>
      </CommandItem>

      <CommandItem
        onSelect={() => {
          toast.info('Abrindo seletor de organização...', {
            description: 'Use o menu lateral para trocar de organização.',
          })
          setOpen(false)
        }}
      >
        <HugeiconsIcon icon={Building02Icon} />
        <span>Trocar Organização</span>
        <CommandShortcut>⌘O</CommandShortcut>
      </CommandItem>

      <CommandItem onSelect={handleLogout}>
        <HugeiconsIcon icon={Logout01Icon} className="text-red-500" />
        <span>Sair</span>
        <CommandShortcut>⌘Q</CommandShortcut>
      </CommandItem>
    </CommandGroup>
  )
}
