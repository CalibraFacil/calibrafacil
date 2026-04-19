import { type ReactNode, useMemo, useState } from 'react'
import {
  normalizeCertificateTemplateConfig,
  type CertificateBlockFrame,
  type CertificateBlockType,
  type CertificateTemplateBlock,
  type CertificateTemplateConfig,
} from '@calibra-facil/shared'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import {
  CERTIFICATE_BLOCK_LABELS,
  DEFAULT_BLOCK_FRAMES,
  PALETTE_BLOCK_TYPES,
} from './block-preview'
import { CanvasBlock } from './canvas-block'
import { clampFrameToPage, mmToPx } from './geometry'

const ZOOM_OPTIONS = [0.5, 0.75, 1, 1.25] as const

export function CertificateDesigner({
  config,
  readOnly = false,
  inspectorHeader,
  onChange,
}: {
  config: CertificateTemplateConfig
  readOnly?: boolean
  inspectorHeader?: ReactNode
  onChange: (config: CertificateTemplateConfig) => void
}) {
  const safeConfig = useMemo(
    () => normalizeCertificateTemplateConfig(config),
    [config],
  )
  const [zoom, setZoom] = useState<(typeof ZOOM_OPTIONS)[number]>(1)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(
    safeConfig.pages[0]?.blocks[0]?.id ?? null,
  )
  const page = safeConfig.pages[0]
  const selectedBlock = page?.blocks.find(
    (block) => block.id === selectedBlockId,
  )

  if (!page) {
    return null
  }

  const updateBlocks = (
    updater: (blocks: CertificateTemplateBlock[]) => CertificateTemplateBlock[],
  ) => {
    onChange({
      ...safeConfig,
      version: 2,
      pages: safeConfig.pages.map((currentPage) =>
        currentPage.id === page.id
          ? {
              ...currentPage,
              blocks: updater(currentPage.blocks),
            }
          : currentPage,
      ),
    })
  }

  const addBlock = (type: CertificateBlockType) => {
    const occurrence = page.blocks.filter((block) => block.type === type).length
    const offset = (occurrence % 5) * 4
    const defaultFrame = DEFAULT_BLOCK_FRAMES[type]
    const block: CertificateTemplateBlock = {
      id: `${type}-${Date.now().toString(36)}-${occurrence + 1}`,
      type,
      label: CERTIFICATE_BLOCK_LABELS[type],
      frame: {
        ...defaultFrame,
        x: Math.min(defaultFrame.x + offset, page.width - defaultFrame.width),
        y: Math.min(defaultFrame.y + offset, page.height - defaultFrame.height),
      },
      fixedSize: type === 'qr_code',
    }

    updateBlocks((blocks) => [...blocks, block])
    setSelectedBlockId(block.id)
  }

  const updateFrame = (blockId: string, frame: CertificateBlockFrame) => {
    updateBlocks((blocks) =>
      blocks.map((block) =>
        block.id === blockId
          ? {
              ...block,
              frame,
            }
          : block,
      ),
    )
  }

  const removeSelectedBlock = () => {
    if (!selectedBlockId) {
      return
    }

    updateBlocks((blocks) =>
      blocks.filter((block) => block.id !== selectedBlockId),
    )
    setSelectedBlockId(null)
  }

  const updateSelectedFrameValue = (
    key: keyof CertificateBlockFrame,
    value: number,
  ) => {
    if (!selectedBlock || Number.isNaN(value)) {
      return
    }

    updateFrame(
      selectedBlock.id,
      clampFrameToPage(
        {
          ...selectedBlock.frame,
          [key]: value,
        },
        page,
      ),
    )
  }

  return (
    <div className="flex min-h-[calc(100vh-20rem)] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">A4 portrait</span>
          <Badge variant="outline">mm</Badge>
          <Badge variant="secondary">grade 2 mm</Badge>
          {selectedBlock && (
            <span className="truncate text-sm text-muted-foreground">
              Selecionado:{' '}
              {selectedBlock.label ||
                CERTIFICATE_BLOCK_LABELS[selectedBlock.type]}
            </span>
          )}
          {readOnly && <Badge variant="outline">Somente leitura</Badge>}
        </div>

        <div className="flex rounded-lg border p-1">
          {ZOOM_OPTIONS.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={zoom === option ? 'default' : 'ghost'}
              className="h-8 px-3"
              onClick={() => setZoom(option)}
            >
              {Math.round(option * 100)}%
            </Button>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[180px_minmax(760px,1fr)_280px]">
        <div className="min-h-0 space-y-3 overflow-auto rounded-md border p-3">
          <div>
            <h4 className="text-sm font-medium">Blocos</h4>
            <p className="text-xs text-muted-foreground">
              Clique para inserir.
            </p>
          </div>
          <div className="grid gap-1.5">
            {PALETTE_BLOCK_TYPES.map((type) => (
              <Button
                key={type}
                type="button"
                variant="outline"
                size="sm"
                className="h-8 justify-start px-2 text-xs"
                disabled={readOnly}
                onClick={() => addBlock(type)}
              >
                {CERTIFICATE_BLOCK_LABELS[type]}
              </Button>
            ))}
          </div>
        </div>

        <div className="min-h-[720px] overflow-auto rounded-md border bg-muted/30 p-5">
          <div
            className="relative mx-auto bg-white shadow-sm ring-1 ring-black/10"
            style={{
              width: mmToPx(page.width, zoom),
              height: mmToPx(page.height, zoom),
              backgroundImage:
                'linear-gradient(to right, rgba(15,23,42,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.08) 1px, transparent 1px)',
              backgroundSize: `${mmToPx(2, zoom)}px ${mmToPx(2, zoom)}px`,
            }}
          >
            {page.blocks.map((block) => (
              <CanvasBlock
                key={block.id}
                block={block}
                page={page}
                config={safeConfig}
                zoom={zoom}
                selected={block.id === selectedBlockId}
                readOnly={readOnly}
                onSelect={setSelectedBlockId}
                onFrameChange={updateFrame}
              />
            ))}
          </div>
        </div>

        <div className="min-h-0 space-y-3 overflow-auto rounded-md border p-3">
          {inspectorHeader}

          <div>
            <h4 className="text-sm font-medium">Camadas</h4>
            <p className="text-xs text-muted-foreground">
              Ordem atual dos blocos.
            </p>
          </div>
          <div className="space-y-1.5">
            {page.blocks.map((block) => (
              <button
                key={block.id}
                type="button"
                onClick={() => setSelectedBlockId(block.id)}
                className={cn(
                  'w-full rounded-md border px-2 py-1.5 text-left text-xs',
                  block.id === selectedBlockId
                    ? 'border-primary bg-primary/5'
                    : 'border-border',
                )}
              >
                <span className="block truncate">
                  {block.label || CERTIFICATE_BLOCK_LABELS[block.type]}
                </span>
                <span className="text-muted-foreground">
                  {block.frame.x} x {block.frame.y} mm
                </span>
              </button>
            ))}
          </div>

          {selectedBlock && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <div className="font-medium">
                {selectedBlock.label ||
                  CERTIFICATE_BLOCK_LABELS[selectedBlock.type]}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {(['x', 'y', 'width', 'height'] as const).map((key) => (
                  <label key={key} className="space-y-1">
                    <span className="text-[10px] uppercase text-muted-foreground">
                      {key === 'width' ? 'W' : key === 'height' ? 'H' : key} mm
                    </span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step={1}
                      value={selectedBlock.frame[key]}
                      disabled={readOnly}
                      className="h-8 px-2 text-xs"
                      onChange={(event) =>
                        updateSelectedFrameValue(
                          key,
                          Number(event.target.value),
                        )
                      }
                    />
                  </label>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 w-full"
                disabled={readOnly}
                onClick={removeSelectedBlock}
              >
                Remover bloco
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
