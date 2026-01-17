'use client'

import { useLocation, useNavigate } from '@tanstack/react-router'
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
import { useQueryClient } from '@tanstack/react-query'

import { CommandGroup, CommandItem, CommandShortcut } from '@/components/ui/command'
import { useCommandPalette } from '../command-context'
import { api } from '@/utils/api'

type ContextAction = {
  id: string
  label: string
  icon: React.ReactNode
  shortcut?: string
  onSelect: () => void
  disabled?: boolean
}

/**
 * Extract job ID from pathname like /dashboard/jobs/123
 */
function extractJobId(pathname: string): string | null {
  const match = pathname.match(/^\/dashboard\/jobs\/([\w-]+)$/)
  return match ? match[1] : null
}

type ActionContext = {
  pathname: string
  setOpen: (open: boolean) => void
  queryClient: ReturnType<typeof useQueryClient>
  navigate: ReturnType<typeof useNavigate>
}

function getContextActions(ctx: ActionContext): ContextAction[] {
  const { pathname, setOpen, queryClient, navigate } = ctx

  // Job page context actions
  if (/^\/dashboard\/jobs\/[\w-]+$/.test(pathname)) {
    const jobId = extractJobId(pathname)

    return [
      {
        id: 'approve-job',
        label: 'Aprovar Ordem de Serviço',
        icon: <HugeiconsIcon icon={CheckmarkCircle02Icon} className="text-green-500" />,
        shortcut: '⌘⏎',
        onSelect: async () => {
          if (!jobId) return

          try {
            const res = await api.api.jobs[':id'].approve.$post({
              param: { id: jobId },
              json: { reason: 'Aprovado via comando rápido' },
            })

            if (!res.ok) {
              const error = await res.json()
              throw new Error((error as { error?: string }).error || 'Erro ao aprovar')
            }

            queryClient.invalidateQueries({ queryKey: ['jobs'] })
            toast.success('Job aprovado com sucesso!', {
              description: 'O certificado está sendo gerado.',
            })
            setOpen(false)
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Erro ao aprovar job')
          }
        },
      },
      {
        id: 'reject-job',
        label: 'Rejeitar / Devolver',
        icon: <HugeiconsIcon icon={Cancel01Icon} className="text-red-500" />,
        onSelect: () => {
          // Navigate to job page to use the reject dialog (requires reason input)
          if (jobId) {
            navigate({ to: '/dashboard/jobs/$id', params: { id: jobId } })
          }
          toast.info('Use o botão "Rejeitar" na página do job', {
            description: 'É necessário informar o motivo da rejeição.',
          })
          setOpen(false)
        },
      },
      {
        id: 'print-label',
        label: 'Imprimir Etiqueta',
        icon: <HugeiconsIcon icon={PrinterIcon} />,
        shortcut: '⌘P',
        onSelect: async () => {
          if (!jobId) return

          try {
            const res = await api.api.jobs[':id']['generate-label'].$post({
              param: { id: jobId },
            })

            if (!res.ok) {
              const error = await res.json()
              throw new Error((error as { error?: string }).error || 'Erro ao gerar etiqueta')
            }

            queryClient.invalidateQueries({ queryKey: ['jobs', jobId] })
            toast.success('Gerando etiqueta...', {
              description: 'A etiqueta estará disponível em instantes.',
            })
            setOpen(false)
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Erro ao gerar etiqueta')
          }
        },
      },
      {
        id: 'view-audit-trail',
        label: 'Ver Histórico de Auditoria',
        icon: <HugeiconsIcon icon={Clock01Icon} />,
        onSelect: () => {
          toast.info('Funcionalidade em desenvolvimento', {
            description: 'O histórico de auditoria estará disponível em breve.',
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
          toast.info('Funcionalidade em desenvolvimento', {
            description: 'Esta ação estará disponível em breve.',
          })
          setOpen(false)
        },
      },
      {
        id: 'view-calibration-history',
        label: 'Ver Histórico de Calibração',
        icon: <HugeiconsIcon icon={FileSearchIcon} />,
        onSelect: () => {
          toast.info('Funcionalidade em desenvolvimento', {
            description: 'Esta ação estará disponível em breve.',
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
          toast.info('Funcionalidade em desenvolvimento', {
            description: 'Esta ação estará disponível em breve.',
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
          toast.info('Funcionalidade em desenvolvimento', {
            description: 'Esta ação estará disponível em breve.',
          })
          setOpen(false)
        },
      },
      {
        id: 'view-standard-calibration-history',
        label: 'Ver Histórico de Calibração',
        icon: <HugeiconsIcon icon={FileSearchIcon} />,
        onSelect: () => {
          toast.info('Funcionalidade em desenvolvimento', {
            description: 'Esta ação estará disponível em breve.',
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
          toast.info('Funcionalidade em desenvolvimento', {
            description: 'Esta ação estará disponível em breve.',
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
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { setOpen } = useCommandPalette()

  const actions = getContextActions({
    pathname: location.pathname,
    setOpen,
    queryClient,
    navigate,
  })

  if (actions.length === 0) {
    return null
  }

  return (
    <CommandGroup heading="Ações do Contexto Atual">
      {actions.map((action) => (
        <CommandItem
          key={action.id}
          onSelect={action.onSelect}
          disabled={action.disabled}
        >
          {action.icon}
          <span>{action.label}</span>
          {action.shortcut && <CommandShortcut>{action.shortcut}</CommandShortcut>}
        </CommandItem>
      ))}
    </CommandGroup>
  )
}
