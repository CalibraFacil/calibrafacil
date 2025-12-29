'use client'

import { useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Home01Icon,
  Settings05Icon,
  Building02Icon,
  Logout01Icon,
  UserIcon,
  Wrench01Icon,
  RulerIcon,
  ClipboardIcon,
  TaskAdd01Icon,
  CropIcon,
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

  const navItems = [
    {
      label: 'Painel de Controle',
      icon: Home01Icon,
      to: '/dashboard' as const,
      shortcut: '⌘H',
    },
    {
      label: 'Clientes',
      icon: UserIcon,
      to: '/dashboard/clients' as const,
    },
    {
      label: 'Ativos',
      icon: Wrench01Icon,
      to: '/dashboard/assets' as const,
    },
    {
      label: 'Padrões de Referência',
      icon: RulerIcon,
      to: '/dashboard/standards' as const,
    },
    {
      label: 'Métodos de Calibração',
      icon: CropIcon,
      to: '/dashboard/methods' as const,
    },
    {
      label: 'Serviços',
      icon: TaskAdd01Icon,
      to: '/dashboard/services' as const,
    },
    {
      label: 'Ordens de Serviço',
      icon: ClipboardIcon,
      to: '/dashboard/jobs' as const,
    },
    {
      label: 'Configurações',
      icon: Settings05Icon,
      to: '/dashboard/settings' as const,
      shortcut: '⌘,',
    },
  ]

  return (
    <CommandGroup heading="Navegação">
      {navItems.map((item) => (
        <CommandItem
          key={item.to}
          onSelect={() => {
            navigate({ to: item.to })
            setOpen(false)
          }}
        >
          <HugeiconsIcon icon={item.icon} />
          <span>{item.label}</span>
          {item.shortcut && <CommandShortcut>{item.shortcut}</CommandShortcut>}
        </CommandItem>
      ))}

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
