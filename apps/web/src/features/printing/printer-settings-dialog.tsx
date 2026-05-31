import { isDesktopRuntime } from '@calibra-facil/client-runtime'
import type { PrinterProfile } from '@calibra-facil/schemas'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button, buttonVariants } from '@/components/ui/button'
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
  BROWSER_PRINT_DOWNLOAD_URL,
  getPreferredBrowserPrintDeviceUid,
  setPreferredBrowserPrintDeviceUid,
  type BrowserPrintDevice,
} from './browser-print'
import {
  useBrowserPrintAvailable,
  useBrowserPrintDevices,
  useConnectWebSerial,
  useConnectWebUsb,
  useDeletePrinterProfile,
  useDiscoverPrinters,
  usePrinterProfiles,
  usePrintTestLabel,
  useSavePrinterProfile,
  useTestBrowserPrint,
  useTestWebSerial,
  useTestWebUsb,
  useWebSerialGrantedPort,
  useWebUsbGrantedDevice,
} from './use-printers'
import { isWebSerialSupported } from './web-serial'
import { isWebUsbSupported } from './web-usb'

function hex(value: number): string {
  return `0x${value.toString(16).padStart(4, '0')}`
}

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

// ---------------------------------------------------------------------------
// Desktop — network printer profiles persisted in the local-server SQLite store
// ---------------------------------------------------------------------------

function DesktopPrinterSettings() {
  const profilesQuery = usePrinterProfiles(true)
  const saveMutation = useSavePrinterProfile()
  const deleteMutation = useDeletePrinterProfile()
  const testMutation = usePrintTestLabel()
  const discoverMutation = useDiscoverPrinters()
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)

  const profiles = profilesQuery.data ?? []

  const saveDiscovered = (
    name: string,
    connection:
      | {
          type: 'usb'
          vendorId: number
          productId: number
          serialNumber?: string
        }
      | { type: 'serial'; path: string },
  ) => {
    saveMutation.mutate(
      {
        name,
        connection,
        dpi: 203,
        ...dimensionsForDpi(203),
        isDefault: profiles.length === 0,
      },
      {
        onSuccess: () => toast.success(`"${name}" adicionada.`),
        onError: (error) =>
          toast.error(
            error instanceof Error ? error.message : 'Falha ao adicionar',
          ),
      },
    )
  }

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

      <div className="space-y-2 border-t pt-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Impressoras USB / serial</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => discoverMutation.mutate()}
            disabled={discoverMutation.isPending}
          >
            {discoverMutation.isPending ? (
              <Spinner className="mr-2 h-4 w-4" />
            ) : null}
            Detectar
          </Button>
        </div>
        {discoverMutation.data ? (
          discoverMutation.data.usb.length === 0 &&
          discoverMutation.data.serial.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhuma impressora USB/serial encontrada.
            </p>
          ) : (
            <>
              {discoverMutation.data.usb.map((device) => (
                <div
                  key={`usb-${device.vendorId}-${device.productId}`}
                  className="flex items-center justify-between gap-2 rounded-md border p-2"
                >
                  <p className="truncate text-sm">
                    USB {hex(device.vendorId)}:{hex(device.productId)}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={saveMutation.isPending}
                    onClick={() =>
                      saveDiscovered(
                        `Zebra USB ${hex(device.vendorId)}:${hex(device.productId)}`,
                        {
                          type: 'usb',
                          vendorId: device.vendorId,
                          productId: device.productId,
                          serialNumber: device.serialNumber,
                        },
                      )
                    }
                  >
                    Adicionar
                  </Button>
                </div>
              ))}
              {discoverMutation.data.serial.map((port) => (
                <div
                  key={`serial-${port.path}`}
                  className="flex items-center justify-between gap-2 rounded-md border p-2"
                >
                  <p className="truncate text-sm">
                    {port.path}
                    {port.manufacturer ? ` · ${port.manufacturer}` : ''}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={saveMutation.isPending}
                    onClick={() =>
                      saveDiscovered(`Serial ${port.path}`, {
                        type: 'serial',
                        path: port.path,
                      })
                    }
                  >
                    Adicionar
                  </Button>
                </div>
              ))}
            </>
          )
        ) : null}
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
          {saveMutation.isPending ? <Spinner className="mr-2 h-4 w-4" /> : null}
          Salvar impressora
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cloud — Zebra Browser Print devices exposed by the local agent
// ---------------------------------------------------------------------------

function BrowserPrintSection() {
  const availableQuery = useBrowserPrintAvailable(true)
  const isAvailable = availableQuery.data === true
  const devicesQuery = useBrowserPrintDevices(isAvailable)
  const testMutation = useTestBrowserPrint()
  const [selectedUid, setSelectedUid] = useState<string | null>(() =>
    getPreferredBrowserPrintDeviceUid(),
  )

  if (availableQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Procurando o Zebra Browser Print...
      </div>
    )
  }

  if (!isAvailable) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          O Zebra Browser Print não foi detectado neste computador. Instale o
          aplicativo gratuito da Zebra e mantenha-o em execução para imprimir
          etiquetas térmicas diretamente do navegador.
        </p>
        <p className="text-xs text-muted-foreground">
          Em conexões HTTPS, abra{' '}
          <span className="font-mono">https://localhost:9101</span> uma vez e
          aceite o certificado do Browser Print.
        </p>
        <div className="flex gap-2">
          <a
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            href={BROWSER_PRINT_DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
          >
            Baixar Browser Print
          </a>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void availableQuery.refetch()}
          >
            Detectar novamente
          </Button>
        </div>
      </div>
    )
  }

  const devices = devicesQuery.data ?? []

  const handleSelect = (device: BrowserPrintDevice) => {
    setPreferredBrowserPrintDeviceUid(device.uid)
    setSelectedUid(device.uid)
    toast.success(`"${device.name}" será usada para impressão.`)
  }

  const handleTest = (device: BrowserPrintDevice) => {
    testMutation.mutate(device, {
      onSuccess: () => toast.success('Etiqueta de teste enviada.'),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : 'Falha no teste'),
    })
  }

  return (
    <div className="space-y-2">
      {devicesQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Carregando impressoras...
        </div>
      ) : devices.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma impressora encontrada no Browser Print.
        </p>
      ) : (
        devices.map((device) => {
          const isSelected = selectedUid === device.uid
          return (
            <div
              key={device.uid}
              className="flex items-center justify-between gap-2 rounded-md border p-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {device.name}
                  {isSelected ? ' · selecionada' : ''}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {device.connection || device.deviceType}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                {!isSelected && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSelect(device)}
                  >
                    Usar
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleTest(device)}
                  disabled={testMutation.isPending}
                >
                  Teste
                </Button>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cloud — no-install WebUSB / Web Serial (Chromium, HTTPS, per-device prompt)
// ---------------------------------------------------------------------------

function CloudNoInstallSection() {
  const usbSupported = isWebUsbSupported()
  const serialSupported = isWebSerialSupported()
  const usbGranted = useWebUsbGrantedDevice(usbSupported)
  const connectUsb = useConnectWebUsb()
  const testUsb = useTestWebUsb()
  const serialGranted = useWebSerialGrantedPort(serialSupported)
  const connectSerial = useConnectWebSerial()
  const testSerial = useTestWebSerial()

  if (!usbSupported && !serialSupported) {
    return null
  }

  const handleConnectUsb = () => {
    connectUsb.mutate(undefined, {
      onSuccess: (device) =>
        device
          ? toast.success(
              `"${device.productName ?? 'Impressora USB'}" conectada.`,
            )
          : toast.info('Nenhuma impressora selecionada.'),
      onError: (error) =>
        toast.error(
          error instanceof Error ? error.message : 'Falha ao conectar',
        ),
    })
  }

  const handleTestUsb = () => {
    const device = usbGranted.data
    if (!device) return
    testUsb.mutate(device, {
      onSuccess: () => toast.success('Etiqueta de teste enviada.'),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : 'Falha no teste'),
    })
  }

  const handleConnectSerial = () => {
    connectSerial.mutate(undefined, {
      onSuccess: (port) =>
        port
          ? toast.success('Porta serial conectada.')
          : toast.info('Nenhuma porta selecionada.'),
      onError: (error) =>
        toast.error(
          error instanceof Error ? error.message : 'Falha ao conectar',
        ),
    })
  }

  const handleTestSerial = () => {
    const port = serialGranted.data
    if (!port) return
    testSerial.mutate(port, {
      onSuccess: () => toast.success('Etiqueta de teste enviada.'),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : 'Falha no teste'),
    })
  }

  return (
    <div className="space-y-2 border-t pt-4">
      <p className="text-sm font-medium">
        Sem instalação (WebUSB / Web Serial)
      </p>
      <p className="text-xs text-muted-foreground">
        Conecte uma impressora direto pelo navegador (Chrome/Edge, requer
        HTTPS). Será solicitada permissão para o dispositivo uma vez.
      </p>
      {usbSupported && (
        <div className="flex items-center justify-between gap-2 rounded-md border p-2">
          <p className="truncate text-sm">
            USB:{' '}
            {usbGranted.data
              ? (usbGranted.data.productName ?? 'conectada')
              : 'não conectada'}
          </p>
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleConnectUsb}
              disabled={connectUsb.isPending}
            >
              {usbGranted.data ? 'Reconectar' : 'Conectar'}
            </Button>
            {usbGranted.data && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleTestUsb}
                disabled={testUsb.isPending}
              >
                Teste
              </Button>
            )}
          </div>
        </div>
      )}
      {serialSupported && (
        <div className="flex items-center justify-between gap-2 rounded-md border p-2">
          <p className="truncate text-sm">
            Serial: {serialGranted.data ? 'conectada' : 'não conectada'}
          </p>
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleConnectSerial}
              disabled={connectSerial.isPending}
            >
              {serialGranted.data ? 'Reconectar' : 'Conectar'}
            </Button>
            {serialGranted.data && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleTestSerial}
                disabled={testSerial.isPending}
              >
                Teste
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function CloudPrinterSettings() {
  return (
    <div className="space-y-4">
      <BrowserPrintSection />
      <CloudNoInstallSection />
    </div>
  )
}

export function PrinterSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const isDesktop = isDesktopRuntime()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Impressoras térmicas</DialogTitle>
          <DialogDescription>
            {isDesktop
              ? 'Impressoras Zebra (ZPL) na rede local. A impressão usa a impressora padrão.'
              : 'Impressoras Zebra via Zebra Browser Print. A impressão usa a impressora selecionada.'}
          </DialogDescription>
        </DialogHeader>

        {isDesktop ? <DesktopPrinterSettings /> : <CloudPrinterSettings />}
      </DialogContent>
    </Dialog>
  )
}
