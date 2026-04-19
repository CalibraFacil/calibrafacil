import { Rnd, type DraggableData, type RndResizeCallback } from 'react-rnd'
import type {
  CertificateBlockFrame,
  CertificateTemplateBlock,
  CertificateTemplateConfig,
} from '@calibra-facil/shared'

import { cn } from '@/lib/utils'

import { BlockPreview, CERTIFICATE_BLOCK_MIN_SIZE } from './block-preview'
import {
  clampFrameToPage,
  mmToPx,
  pxToMm,
  snapFrame,
  type PageGeometry,
} from './geometry'

const RESIZE_HANDLES = {
  top: true,
  right: true,
  bottom: true,
  left: true,
  topRight: true,
  bottomRight: true,
  bottomLeft: true,
  topLeft: true,
}

const RESIZE_HANDLE_STYLES = {
  top: {
    top: -5,
    left: '50%',
    width: 10,
    height: 10,
    marginLeft: -5,
  },
  right: {
    top: '50%',
    right: -5,
    width: 10,
    height: 10,
    marginTop: -5,
  },
  bottom: {
    bottom: -5,
    left: '50%',
    width: 10,
    height: 10,
    marginLeft: -5,
  },
  left: {
    top: '50%',
    left: -5,
    width: 10,
    height: 10,
    marginTop: -5,
  },
  topRight: { top: -5, right: -5, width: 10, height: 10 },
  bottomRight: { right: -5, bottom: -5, width: 10, height: 10 },
  bottomLeft: { bottom: -5, left: -5, width: 10, height: 10 },
  topLeft: { top: -5, left: -5, width: 10, height: 10 },
}

const resizeHandleBaseStyle = {
  border: '1px solid hsl(var(--primary))',
  background: 'hsl(var(--background))',
  borderRadius: 3,
  boxShadow: '0 1px 4px rgba(15, 23, 42, 0.18)',
  zIndex: 20,
}

export function CanvasBlock({
  block,
  page,
  config,
  zoom,
  selected,
  readOnly = false,
  gridMm = 2,
  onSelect,
  onFrameChange,
}: {
  block: CertificateTemplateBlock
  page: PageGeometry
  config: CertificateTemplateConfig
  zoom: number
  selected: boolean
  readOnly?: boolean
  gridMm?: number
  onSelect: (blockId: string) => void
  onFrameChange: (blockId: string, frame: CertificateBlockFrame) => void
}) {
  const minSize = CERTIFICATE_BLOCK_MIN_SIZE[block.type]
  const size = {
    width: mmToPx(block.frame.width, zoom),
    height: mmToPx(block.frame.height, zoom),
  }
  const position = {
    x: mmToPx(block.frame.x, zoom),
    y: mmToPx(block.frame.y, zoom),
  }
  const grid = [mmToPx(gridMm, zoom), mmToPx(gridMm, zoom)] as [number, number]
  const resizingDisabled = readOnly || block.fixedSize
  const draggingDisabled = readOnly || block.locked

  const commitFrame = (nextFrame: CertificateBlockFrame) => {
    onFrameChange(
      block.id,
      clampFrameToPage(snapFrame(nextFrame, gridMm), page),
    )
  }

  const handleDragStop = (data: DraggableData) => {
    commitFrame({
      ...block.frame,
      x: pxToMm(data.x, zoom),
      y: pxToMm(data.y, zoom),
    })
  }

  const handleResizeStop: RndResizeCallback = (
    _event,
    _direction,
    ref,
    _delta,
    resizePosition,
  ) => {
    commitFrame({
      x: pxToMm(resizePosition.x, zoom),
      y: pxToMm(resizePosition.y, zoom),
      width: pxToMm(ref.offsetWidth, zoom),
      height: pxToMm(ref.offsetHeight, zoom),
    })
  }

  return (
    <Rnd
      data-testid={`canvas-block-${block.id}`}
      size={size}
      position={position}
      bounds="parent"
      scale={zoom}
      dragGrid={grid}
      resizeGrid={grid}
      minWidth={mmToPx(minSize.width, zoom)}
      minHeight={mmToPx(minSize.height, zoom)}
      disableDragging={draggingDisabled}
      enableResizing={resizingDisabled || !selected ? false : RESIZE_HANDLES}
      lockAspectRatio={block.type === 'qr_code'}
      dragHandleClassName="certificate-block-drag-handle"
      cancel=".certificate-block-no-drag"
      onMouseDown={() => onSelect(block.id)}
      onDragStop={(_event, data) => handleDragStop(data)}
      onResizeStop={handleResizeStop}
      className={cn(
        'group outline outline-1 outline-transparent transition-[outline-color,box-shadow]',
        selected &&
          'z-10 outline-2 outline-primary shadow-[0_0_0_4px_hsl(var(--primary)/0.12)]',
        readOnly && 'pointer-events-none',
      )}
      resizeHandleStyles={{
        top: { ...resizeHandleBaseStyle, ...RESIZE_HANDLE_STYLES.top },
        right: { ...resizeHandleBaseStyle, ...RESIZE_HANDLE_STYLES.right },
        bottom: { ...resizeHandleBaseStyle, ...RESIZE_HANDLE_STYLES.bottom },
        left: { ...resizeHandleBaseStyle, ...RESIZE_HANDLE_STYLES.left },
        topRight: {
          ...resizeHandleBaseStyle,
          ...RESIZE_HANDLE_STYLES.topRight,
        },
        bottomRight: {
          ...resizeHandleBaseStyle,
          ...RESIZE_HANDLE_STYLES.bottomRight,
        },
        bottomLeft: {
          ...resizeHandleBaseStyle,
          ...RESIZE_HANDLE_STYLES.bottomLeft,
        },
        topLeft: { ...resizeHandleBaseStyle, ...RESIZE_HANDLE_STYLES.topLeft },
      }}
    >
      <div className="certificate-block-drag-handle h-full cursor-move">
        <BlockPreview block={block} config={config} />
      </div>
    </Rnd>
  )
}
