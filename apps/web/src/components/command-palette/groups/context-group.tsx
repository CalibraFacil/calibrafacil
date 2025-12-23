'use client'

import { useLocation } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CheckmarkCircle02Icon,
  Cancel01Icon,
  PrinterIcon,
  Clock01Icon,
  AlertCircleIcon,
  Download01Icon,
  FileSearchIcon,
} from '@hugeicons/core-free-icons'
import { toast } from 'sonner'

import { CommandGroup, CommandItem, CommandShortcut } from '@/components/ui/command'
import { useCommandPalette } from '../command-context'

type ContextAction = {
  id: string
  label: string
  icon: React.ReactNode
  shortcut?: string
  onSelect: () => void
}

function getContextActions(pathname: string, setOpen: (open: boolean) => void): ContextAction[] {
  // Job page context actions
  if (/^\/dashboard\/jobs\/[\w-]+$/.test(pathname)) {
    return [
      {
        id: 'approve-job',
        label: 'Aprovar Ordem de Serviço',
        icon: <HugeiconsIcon icon={CheckmarkCircle02Icon} className="text-green-500" />,
        shortcut: '⌘⏎',
        onSelect: () => {
          toast.success('Ordem de serviço aprovada', {
            description: 'A ordem foi aprovada e está pronta para execução.',
          })
          setOpen(false)
        },
      },
      {
        id: 'reject-job',
        label: 'Rejeitar / Devolver',
        icon: <HugeiconsIcon icon={Cancel01Icon} className="text-red-500" />,
        onSelect: () => {
          toast.info('Abrindo diálogo de rejeição...', {
            description: 'Informe o motivo da rejeição.',
          })
          setOpen(false)
        },
      },
      {
        id: 'print-label',
        label: 'Imprimir Etiqueta',
        icon: <HugeiconsIcon icon={PrinterIcon} />,
        shortcut: '⌘P',
        onSelect: () => {
          toast.success('Etiqueta enviada para impressão', {
            description: 'Verifique a impressora de etiquetas.',
          })
          setOpen(false)
        },
      },
      {
        id: 'view-audit-trail',
        label: 'Ver Histórico de Auditoria',
        icon: <HugeiconsIcon icon={Clock01Icon} />,
        onSelect: () => {
          toast.info('Abrindo histórico de auditoria...', {
            description: 'Carregando registros de alterações.',
          })
          setOpen(false)
        },
      },
    ]
  }

  // Asset page context actions
  if (/^\/dashboard\/assets\/[\w-]+$/.test(pathname)) {
    return [
      {
        id: 'mark-out-of-service',
        label: 'Marcar Fora de Serviço',
        icon: <HugeiconsIcon icon={AlertCircleIcon} className="text-yellow-500" />,
        onSelect: () => {
          toast.warning('Ativo marcado como fora de serviço', {
            description: 'Um relatório de não conformidade foi criado.',
          })
          setOpen(false)
        },
      },
      {
        id: 'view-calibration-history',
        label: 'Ver Histórico de Calibração',
        icon: <HugeiconsIcon icon={FileSearchIcon} />,
        onSelect: () => {
          toast.info('Carregando histórico de calibração...', {
            description: 'Exibindo últimas calibrações do ativo.',
          })
          setOpen(false)
        },
      },
      {
        id: 'download-last-cert',
        label: 'Baixar Último Certificado',
        icon: <HugeiconsIcon icon={Download01Icon} />,
        shortcut: '⌘D',
        onSelect: () => {
          toast.success('Download iniciado', {
            description: 'O certificado será baixado em instantes.',
          })
          setOpen(false)
        },
      },
    ]
  }

  // Standard page context actions
  if (/^\/dashboard\/standards\/[\w-]+$/.test(pathname)) {
    return [
      {
        id: 'mark-standard-out-of-service',
        label: 'Marcar Padrão Fora de Serviço',
        icon: <HugeiconsIcon icon={AlertCircleIcon} className="text-yellow-500" />,
        onSelect: () => {
          toast.warning('Padrão marcado como fora de serviço', {
            description: 'Um relatório de não conformidade foi criado.',
          })
          setOpen(false)
        },
      },
      {
        id: 'view-standard-calibration-history',
        label: 'Ver Histórico de Calibração',
        icon: <HugeiconsIcon icon={FileSearchIcon} />,
        onSelect: () => {
          toast.info('Carregando histórico de calibração...', {
            description: 'Exibindo últimas calibrações do padrão.',
          })
          setOpen(false)
        },
      },
      {
        id: 'download-standard-cert',
        label: 'Baixar Certificado do Padrão',
        icon: <HugeiconsIcon icon={Download01Icon} />,
        shortcut: '⌘D',
        onSelect: () => {
          toast.success('Download iniciado', {
            description: 'O certificado será baixado em instantes.',
          })
          setOpen(false)
        },
      },
    ]
  }

  return []
}

export function ContextGroup() {
  const location = useLocation()
  const { setOpen } = useCommandPalette()
  const actions = getContextActions(location.pathname, setOpen)

  if (actions.length === 0) {
    return null
  }

  return (
    <CommandGroup heading="Ações do Contexto Atual">
      {actions.map((action) => (
        <CommandItem key={action.id} onSelect={action.onSelect}>
          {action.icon}
          <span>{action.label}</span>
          {action.shortcut && <CommandShortcut>{action.shortcut}</CommandShortcut>}
        </CommandItem>
      ))}
    </CommandGroup>
  )
}
