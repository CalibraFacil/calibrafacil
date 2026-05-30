import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDownRight01Icon,
  ArrowUpRight01Icon,
  BubbleChatIcon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons'

import { calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ConsoleEmpty,
  SectionPanel,
  StatusChip,
} from '@/features/backoffice/console'
import type { SignalTone } from '@/components/instrument-panel'
import { useBackofficeInteractionsData } from '@/features/backoffice/queries'
import type { BackofficeInteraction } from '@/features/backoffice/types'

const CHANNELS = [
  'whatsapp',
  'email',
  'phone',
  'meeting',
  'note',
  'other',
] as const
type Channel = (typeof CHANNELS)[number]

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  phone: 'Telefone',
  meeting: 'Reunião',
  note: 'Nota',
  other: 'Outro',
}

const CHANNEL_TONES: Record<string, SignalTone> = {
  whatsapp: 'ok',
  email: 'info',
  phone: 'info',
  meeting: 'warning',
  note: 'neutral',
  other: 'neutral',
}

const DIRECTIONS = ['outbound', 'inbound', 'internal'] as const
type Direction = (typeof DIRECTIONS)[number]

const DIRECTION_LABELS: Record<string, string> = {
  outbound: 'Enviado',
  inbound: 'Recebido',
  internal: 'Interno',
}

function isChannel(value: string): value is Channel {
  return CHANNELS.some((channel) => channel === value)
}

function isDirection(value: string): value is Direction {
  return DIRECTIONS.some((direction) => direction === value)
}

function useCreateInteraction(organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      channel: Channel
      direction: Direction
      summary: string
    }) => calibraApi.backoffice.createInteraction(organizationId, input),
    onSuccess: async () => {
      toast.success('Interação registrada')
      await queryClient.invalidateQueries({
        queryKey: ['backoffice', 'interactions', organizationId],
      })
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : 'Falha ao registrar interação',
      ),
  })
}

/**
 * Account interaction log (gap #14, omnichannel core) — a unified, manually
 * recorded timeline of operator↔tenant touchpoints (WhatsApp, e-mail, call,
 * meeting, note). Auto-capture from the channels is the external follow-up.
 */
export function InteractionLogCard({
  organizationId,
}: {
  organizationId: string
}) {
  const query = useBackofficeInteractionsData(organizationId)
  const create = useCreateInteraction(organizationId)
  const [channel, setChannel] = useState<Channel>('whatsapp')
  const [direction, setDirection] = useState<Direction>('outbound')
  const [summary, setSummary] = useState('')

  const interactions = query.data?.data ?? []
  const canSubmit = summary.trim().length >= 2

  const submit = () => {
    if (!canSubmit) return
    create.mutate(
      { channel, direction, summary: summary.trim() },
      { onSuccess: () => setSummary('') },
    )
  }

  return (
    <SectionPanel
      eyebrow="Relacionamento"
      title="Interações"
      description="Linha do tempo unificada de contatos com a conta — WhatsApp, e-mail, ligações, reuniões."
      contentClassName="space-y-4"
    >
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <NativeSelect
            value={channel}
            onChange={(event) => {
              if (isChannel(event.target.value)) setChannel(event.target.value)
            }}
          >
            {CHANNELS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {CHANNEL_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <NativeSelect
            value={direction}
            onChange={(event) => {
              if (isDirection(event.target.value))
                setDirection(event.target.value)
            }}
          >
            {DIRECTIONS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {DIRECTION_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="O que foi tratado…"
          />
          <Button
            type="submit"
            disabled={!canSubmit || create.isPending}
            className="min-h-10 transition-transform active:scale-[0.96]"
          >
            <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
            Registrar
          </Button>
        </div>
      </form>

      {query.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      ) : interactions.length === 0 ? (
        <ConsoleEmpty
          icon={BubbleChatIcon}
          title="Nenhuma interação"
          description="Registre o primeiro contato com esta conta."
        />
      ) : (
        <div className="space-y-2">
          {interactions.map((interaction) => (
            <InteractionRow key={interaction.id} interaction={interaction} />
          ))}
        </div>
      )}
    </SectionPanel>
  )
}

function InteractionRow({
  interaction,
}: {
  interaction: BackofficeInteraction
}) {
  const directionIcon =
    interaction.direction === 'inbound'
      ? ArrowDownRight01Icon
      : ArrowUpRight01Icon
  return (
    <div className="rounded-xl px-3 py-2 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone={CHANNEL_TONES[interaction.channel] ?? 'neutral'}>
          {CHANNEL_LABELS[interaction.channel] ?? interaction.channel}
        </StatusChip>
        {interaction.direction !== 'internal' ? (
          <HugeiconsIcon
            icon={directionIcon}
            className="size-3.5 text-muted-foreground/60"
          />
        ) : null}
        <span className="text-xs text-muted-foreground">
          {DIRECTION_LABELS[interaction.direction] ?? interaction.direction}
        </span>
      </div>
      <p className="mt-1 text-sm">{interaction.summary}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {interaction.createdByName ? `${interaction.createdByName} · ` : ''}
        {formatDistanceToNow(new Date(interaction.occurredAt), {
          addSuffix: true,
          locale: ptBR,
        })}
      </p>
    </div>
  )
}
