import type { PrinterProfile } from '@calibra-facil/schemas'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

import {
  useDeletePrinterProfile,
  usePrinterProfiles,
  usePrintTestLabel,
  useSavePrinterProfile,
} from './use-printers'

const FIELD_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

type Draft = {
  name: string
  host: string
  port: string
  dpi: '203' | '300'
}

const EMPTY_DRAFT: Draft = { name: '', host: '', port: '9100', dpi: '203' }

function dimensionsForDpi(dpi: 203 | 300) {
  return dpi === 300
    ? { widthDots: 591, heightDots: 354 }
    : { widthDots: 400, heightDots: 240 }
}

export function PrinterSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const profilesQuery = usePrinterProfiles(open)
  const saveMutation = useSavePrinterProfile()
  const deleteMutation = useDeletePrinterProfile()
  const testMutation = usePrintTestLabel()
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)

  const profiles = profilesQuery.data ?? []

  const handleAdd = () => {
    if (!draft.name.trim() || !draft.host.trim()) {
      toast.error('Informe o nome e o endereço (IP) da impressora.')
      return
    }
    const dpi = draft.dpi === '300' ? 300 : 203
    saveMutation.mutate(
      {
        name: draft.name.trim(),
        connection: {
          type: 'network',
          host: draft.host.trim(),
          port: Number(draft.port) || 9100,
        },
        dpi,
        ...dimensionsForDpi(dpi),
        isDefault: profiles.length === 0,
      },
      {
        onSuccess: () => {
          toast.success('Impressora salva.')
          setDraft(EMPTY_DRAFT)
        },
        onError: (error) =>
          toast.error(
            error instanceof Error
              ? error.message
              : 'Falha ao salvar impressora',
          ),
      },
    )
  }

  const handleSetDefault = (profile: PrinterProfile) => {
    saveMutation.mutate(
      { ...profile, isDefault: true },
      {
        onSuccess: () =>
          toast.success(`"${profile.name}" definida como padrão.`),
        onError: (error) =>
          toast.error(
            error instanceof Error ? error.message : 'Falha ao salvar',
          ),
      },
    )
  }

  const handleTest = (profileId: string) => {
    testMutation.mutate(profileId, {
      onSuccess: (result) =>
        result.success
          ? toast.success('Etiqueta de teste enviada.')
          : toast.error(result.error ?? 'Falha no teste de impressão'),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : 'Falha no teste'),
    })
  }

  const handleDelete = (profile: PrinterProfile) => {
    deleteMutation.mutate(profile.id, {
      onSuccess: () => toast.success(`"${profile.name}" removida.`),
      onError: (error) =>
        toast.error(
          error instanceof Error ? error.message : 'Falha ao remover',
        ),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Impressoras térmicas</DialogTitle>
          <DialogDescription>
            Impressoras Zebra (ZPL) na rede local. A impressão usa a impressora
            padrão.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            {profilesQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="h-4 w-4" /> Carregando impressoras...
              </div>
            ) : profiles.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma impressora configurada.
              </p>
            ) : (
              profiles.map((profile) => (
                <div
                  key={profile.id}
                  className="flex items-center justify-between gap-2 rounded-md border p-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {profile.name}
                      {profile.isDefault ? ' · padrão' : ''}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {profile.connection.type === 'network'
                        ? `${profile.connection.host}:${profile.connection.port}`
                        : profile.connection.type}{' '}
                      · {profile.dpi} dpi
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {!profile.isDefault && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSetDefault(profile)}
                        disabled={saveMutation.isPending}
                      >
                        Padrão
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleTest(profile.id)}
                      disabled={testMutation.isPending}
                    >
                      Teste
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(profile)}
                      disabled={deleteMutation.isPending}
                    >
                      Remover
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="space-y-3 border-t pt-4">
            <p className="text-sm font-medium">Adicionar impressora de rede</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="printer-name">Nome</Label>
                <input
                  id="printer-name"
                  className={FIELD_CLASS}
                  value={draft.name}
                  placeholder="Zebra da bancada"
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="printer-host">Endereço (IP)</Label>
                <input
                  id="printer-host"
                  className={FIELD_CLASS}
                  value={draft.host}
                  placeholder="192.168.0.50"
                  onChange={(event) =>
                    setDraft({ ...draft, host: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="printer-port">Porta</Label>
                <input
                  id="printer-port"
                  className={FIELD_CLASS}
                  inputMode="numeric"
                  value={draft.port}
                  onChange={(event) =>
                    setDraft({ ...draft, port: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="printer-dpi">Resolução</Label>
                <select
                  id="printer-dpi"
                  className={FIELD_CLASS}
                  value={draft.dpi}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      dpi: event.target.value === '300' ? '300' : '203',
                    })
                  }
                >
                  <option value="203">203 dpi</option>
                  <option value="300">300 dpi</option>
                </select>
              </div>
            </div>
            <Button onClick={handleAdd} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? (
                <Spinner className="mr-2 h-4 w-4" />
              ) : null}
              Salvar impressora
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
