// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CERTIFICATE_TEMPLATE_CONFIG,
  type CertificateTemplateBlock,
} from '@calibra-facil/shared'

import { mmToPx } from './geometry'
import { CanvasBlock } from './canvas-block'

vi.mock('react-rnd', () => ({
  Rnd: (props: {
    children: React.ReactNode
    className?: string
    disableDragging?: boolean
    enableResizing?: boolean | Record<string, boolean>
    onDragStop?: (event: unknown, data: unknown) => void
    onMouseDown?: () => void
    onResizeStop?: (
      event: unknown,
      direction: unknown,
      ref: HTMLElement,
      delta: unknown,
      position: { x: number; y: number },
    ) => void
    position: { x: number; y: number }
    size: { width: number; height: number }
    ['data-testid']?: string
  }) => {
    const resizeRef = document.createElement('div')
    Object.defineProperties(resizeRef, {
      offsetWidth: { value: 192 },
      offsetHeight: { value: 96 },
    })

    return (
      <div
        className={props.className}
        data-disable-dragging={String(props.disableDragging)}
        data-enable-resizing={
          typeof props.enableResizing === 'boolean'
            ? String(props.enableResizing)
            : 'handles'
        }
        data-testid={props['data-testid']}
        data-x={props.position.x}
        data-y={props.position.y}
        data-width={props.size.width}
        data-height={props.size.height}
        onMouseDown={props.onMouseDown}
      >
        <button
          type="button"
          onClick={() =>
            props.onDragStop?.(
              {},
              {
                node: document.createElement('div'),
                deltaX: 0,
                deltaY: 0,
                lastX: 0,
                lastY: 0,
                x: 96,
                y: 192,
              },
            )
          }
        >
          drag
        </button>
        <button
          type="button"
          onClick={() =>
            props.onResizeStop?.(
              {},
              'bottomRight',
              resizeRef,
              {},
              { x: 96, y: 96 },
            )
          }
        >
          resize
        </button>
        {props.children}
      </div>
    )
  },
}))

const block: CertificateTemplateBlock = {
  id: 'results',
  type: 'results',
  label: 'Resultados',
  frame: { x: 10, y: 20, width: 80, height: 40 },
}

const page = { width: 210, height: 297 }

describe('CanvasBlock', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders block at the expected position', () => {
    renderCanvasBlock()

    const rnd = screen.getByTestId('canvas-block-results')

    expect(Number(rnd.getAttribute('data-x'))).toBeCloseTo(mmToPx(10))
    expect(Number(rnd.getAttribute('data-y'))).toBeCloseTo(mmToPx(20))
    expect(Number(rnd.getAttribute('data-width'))).toBeCloseTo(mmToPx(80))
    expect(Number(rnd.getAttribute('data-height'))).toBeCloseTo(mmToPx(40))
  })

  it('calls onFrameChange with millimeter values after drag', () => {
    const onFrameChange = vi.fn()
    renderCanvasBlock({ onFrameChange })

    fireEvent.click(screen.getByText('drag'))

    expect(onFrameChange).toHaveBeenCalledWith('results', {
      x: 26,
      y: 50,
      width: 80,
      height: 40,
    })
  })

  it('calls onFrameChange with millimeter values after resize', () => {
    const onFrameChange = vi.fn()
    renderCanvasBlock({ onFrameChange })

    fireEvent.click(screen.getByText('resize'))

    expect(onFrameChange).toHaveBeenCalledWith('results', {
      x: 26,
      y: 26,
      width: 50,
      height: 26,
    })
  })

  it('applies selected styling', () => {
    renderCanvasBlock({ selected: true })

    expect(screen.getByTestId('canvas-block-results').className).toContain(
      'outline-primary',
    )
  })

  it('disables interaction in read-only preview mode', () => {
    renderCanvasBlock({ readOnly: true })

    const rnd = screen.getByTestId('canvas-block-results')
    expect(rnd.getAttribute('data-disable-dragging')).toBe('true')
    expect(rnd.getAttribute('data-enable-resizing')).toBe('false')
  })
})

function renderCanvasBlock({
  selected = false,
  readOnly = false,
  onFrameChange = vi.fn(),
}: {
  selected?: boolean
  readOnly?: boolean
  onFrameChange?: (blockId: string, frame: typeof block.frame) => void
} = {}) {
  return render(
    <CanvasBlock
      block={block}
      page={page}
      config={DEFAULT_CERTIFICATE_TEMPLATE_CONFIG}
      zoom={1}
      selected={selected}
      readOnly={readOnly}
      onSelect={vi.fn()}
      onFrameChange={onFrameChange}
    />,
  )
}
