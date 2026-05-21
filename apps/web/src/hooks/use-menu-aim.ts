import * as React from 'react'

import { useMountEffect } from './use-mount-effect'

type Point = {
  x: number
  y: number
  time: number
}

type UseMenuAimOptions = {
  open: boolean
  onClose: () => void
  closeDelay?: number
}

const HISTORY_LIMIT = 6
const SAFE_PADDING = 12

function inflateRect(rect: DOMRect, padding: number) {
  return {
    left: rect.left - padding,
    right: rect.right + padding,
    top: rect.top - padding,
    bottom: rect.bottom + padding,
  }
}

function pointInRect(point: Point, rect: ReturnType<typeof inflateRect>) {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  )
}

function pointInPolygon(
  point: Point,
  polygon: Array<{ x: number; y: number }>,
) {
  let inside = false

  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index++
  ) {
    const currentPoint = polygon[index]
    const previousPoint = polygon[previous]
    const intersects =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

function getRecentPoint(history: Array<Point>) {
  return history[history.length - 1] ?? null
}

function getOlderPoint(history: Array<Point>) {
  return history[Math.max(0, history.length - 4)] ?? history[0] ?? null
}

export function useMenuAim<
  TParent extends HTMLElement,
  TFlyout extends HTMLElement,
>({ open, onClose, closeDelay = 200 }: UseMenuAimOptions) {
  const parentRef = React.useRef<TParent | null>(null)
  const flyoutRef = React.useRef<TFlyout | null>(null)
  const closeTimerRef = React.useRef<number | null>(null)
  const pointerHistoryRef = React.useRef<Array<Point>>([])
  const openRef = React.useRef(open)
  const onCloseRef = React.useRef(onClose)
  const handlePointerMoveRef = React.useRef<(event: PointerEvent) => void>(
    () => undefined,
  )

  openRef.current = open
  onCloseRef.current = onClose

  const clearCloseTimer = React.useCallback(() => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const closeWithDelay = React.useCallback(() => {
    clearCloseTimer()

    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      onCloseRef.current()
    }, closeDelay)
  }, [clearCloseTimer, closeDelay])

  const trackPointer = React.useCallback(
    (event: Pick<PointerEvent, 'clientX' | 'clientY'>) => {
      const point = {
        x: event.clientX,
        y: event.clientY,
        time: performance.now(),
      }

      pointerHistoryRef.current = [
        ...pointerHistoryRef.current.slice(-(HISTORY_LIMIT - 1)),
        point,
      ]

      return point
    },
    [],
  )

  const isPointProtected = React.useCallback((point: Point) => {
    const parentRect = parentRef.current?.getBoundingClientRect()
    const flyoutRect = flyoutRef.current?.getBoundingClientRect()

    if (!parentRect) {
      return false
    }

    if (pointInRect(point, inflateRect(parentRect, SAFE_PADDING))) {
      return true
    }

    if (!flyoutRect) {
      return false
    }

    if (pointInRect(point, inflateRect(flyoutRect, SAFE_PADDING))) {
      return true
    }

    const leftRect =
      parentRect.left <= flyoutRect.left ? parentRect : flyoutRect
    const rightRect = leftRect === parentRect ? flyoutRect : parentRect

    // The corridor is the invisible quadrilateral spanning the trigger edge
    // and flyout edge, padded vertically so diagonal movement does not flicker.
    const safeCorridor = [
      { x: leftRect.right - SAFE_PADDING, y: leftRect.top - SAFE_PADDING },
      { x: rightRect.left + SAFE_PADDING, y: rightRect.top - SAFE_PADDING },
      { x: rightRect.left + SAFE_PADDING, y: rightRect.bottom + SAFE_PADDING },
      { x: leftRect.right - SAFE_PADDING, y: leftRect.bottom + SAFE_PADDING },
    ]

    return pointInPolygon(point, safeCorridor)
  }, [])

  const isMovingTowardFlyout = React.useCallback(() => {
    const history = pointerHistoryRef.current
    const currentPoint = getRecentPoint(history)
    const olderPoint = getOlderPoint(history)
    const parentRect = parentRef.current?.getBoundingClientRect()
    const flyoutRect = flyoutRef.current?.getBoundingClientRect()

    if (!currentPoint || !olderPoint || !parentRect || !flyoutRect) {
      return false
    }

    const flyoutIsRight = flyoutRect.left >= parentRect.right
    const movingHorizontally = flyoutIsRight
      ? currentPoint.x >= olderPoint.x
      : currentPoint.x <= olderPoint.x

    if (!movingHorizontally) {
      return false
    }

    const targetEdgeX = flyoutIsRight ? flyoutRect.left : flyoutRect.right
    const triangle = [
      { x: olderPoint.x, y: olderPoint.y },
      { x: targetEdgeX, y: flyoutRect.top - SAFE_PADDING },
      { x: targetEdgeX, y: flyoutRect.bottom + SAFE_PADDING },
    ]

    return pointInPolygon(currentPoint, triangle)
  }, [])

  const requestClose = React.useCallback(() => {
    const point = getRecentPoint(pointerHistoryRef.current)

    if (point && (isPointProtected(point) || isMovingTowardFlyout())) {
      clearCloseTimer()
      return
    }

    closeWithDelay()
  }, [clearCloseTimer, closeWithDelay, isMovingTowardFlyout, isPointProtected])

  const handlePointerMove = React.useCallback(
    (event: PointerEvent) => {
      const point = trackPointer(event)

      if (isPointProtected(point) || isMovingTowardFlyout()) {
        clearCloseTimer()
        return
      }

      closeWithDelay()
    },
    [
      clearCloseTimer,
      closeWithDelay,
      isMovingTowardFlyout,
      isPointProtected,
      trackPointer,
    ],
  )

  handlePointerMoveRef.current = handlePointerMove

  useMountEffect(() => {
    const handleDocumentPointerMove = (event: PointerEvent) => {
      if (!openRef.current) {
        clearCloseTimer()
        return
      }

      handlePointerMoveRef.current(event)
    }

    document.addEventListener('pointermove', handleDocumentPointerMove)

    return () => {
      document.removeEventListener('pointermove', handleDocumentPointerMove)
      clearCloseTimer()
    }
  })

  const getPointerHandlers = React.useCallback(
    () => ({
      onPointerEnter: (event: React.PointerEvent) => {
        trackPointer(event)
        clearCloseTimer()
      },
      onPointerMove: (event: React.PointerEvent) => {
        trackPointer(event)
        clearCloseTimer()
      },
      onPointerLeave: (event: React.PointerEvent) => {
        trackPointer(event)
        requestClose()
      },
    }),
    [clearCloseTimer, requestClose, trackPointer],
  )

  return {
    parentRef,
    flyoutRef,
    clearCloseTimer,
    requestClose,
    getParentPointerHandlers: getPointerHandlers,
    getFlyoutPointerHandlers: getPointerHandlers,
    trackPointer,
  }
}
