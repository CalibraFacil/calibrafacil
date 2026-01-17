import { useState, useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'

interface SlideToPayButtonProps {
  onComplete: () => void
  disabled?: boolean
  isLoading?: boolean
  price?: string
}

export function SlideToPayButton({
  onComplete,
  disabled = false,
  isLoading = false,
  price,
}: SlideToPayButtonProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [position, setPosition] = useState(0)
  const [isCompleted, setIsCompleted] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const startXRef = useRef(0)

  const THUMB_SIZE = 48
  const PADDING = 4
  const COMPLETE_THRESHOLD = 0.9

  const getMaxPosition = useCallback(() => {
    if (!containerRef.current) return 200
    return containerRef.current.offsetWidth - THUMB_SIZE - PADDING * 2
  }, [])

  const handleStart = useCallback(
    (clientX: number) => {
      if (disabled || isLoading || isCompleted) return
      setIsDragging(true)
      startXRef.current = clientX - position
    },
    [disabled, isLoading, isCompleted, position],
  )

  const handleMove = useCallback(
    (clientX: number) => {
      if (!isDragging) return
      const maxPos = getMaxPosition()
      const newPosition = Math.max(0, Math.min(clientX - startXRef.current, maxPos))
      setPosition(newPosition)
    },
    [isDragging, getMaxPosition],
  )

  const handleEnd = useCallback(() => {
    if (!isDragging) return
    setIsDragging(false)

    const maxPos = getMaxPosition()
    const progress = position / maxPos

    if (progress >= COMPLETE_THRESHOLD) {
      setPosition(maxPos)
      setIsCompleted(true)
      setTimeout(() => {
        onComplete()
      }, 200)
    } else {
      setPosition(0)
    }
  }, [isDragging, position, getMaxPosition, onComplete])

  // Global mouse events
  useEffect(() => {
    if (!isDragging) return

    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX)
    const onMouseUp = () => handleEnd()

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDragging, handleMove, handleEnd])

  // Reset when loading completes or on error
  useEffect(() => {
    if (!isLoading && isCompleted) {
      const timer = setTimeout(() => {
        setIsCompleted(false)
        setPosition(0)
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [isLoading, isCompleted])

  const maxPos = getMaxPosition()
  const progress = maxPos > 0 ? position / maxPos : 0

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative h-14 w-full overflow-hidden rounded-full',
        'bg-primary',
        disabled && 'opacity-50 cursor-not-allowed',
        isCompleted && 'bg-green-600',
      )}
    >
      {/* Label */}
      <div
        className={cn(
          'absolute inset-0 flex items-center justify-center transition-opacity duration-200',
          progress > 0.2 && 'opacity-0',
        )}
      >
        <LockIcon className="mr-2 size-4 text-primary-foreground/80" />
        <span className="text-sm font-medium text-primary-foreground">
          {price ? `Deslize para pagar ${price}` : 'Deslize para pagar'}
        </span>
      </div>

      {/* Success label */}
      {isCompleted && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-medium text-white">
            {isLoading ? 'Processando...' : 'Confirmado'}
          </span>
        </div>
      )}

      {/* Thumb */}
      <div
        className={cn(
          'absolute top-1 left-1 flex items-center justify-center',
          'size-12 rounded-full bg-white shadow-sm',
          'cursor-grab active:cursor-grabbing',
          'select-none touch-none',
          !isDragging && 'transition-transform duration-200 ease-out',
          disabled && 'cursor-not-allowed',
        )}
        style={{ transform: `translateX(${position}px)` }}
        onMouseDown={(e) => {
          e.preventDefault()
          handleStart(e.clientX)
        }}
        onTouchStart={(e) => handleStart(e.touches[0].clientX)}
        onTouchMove={(e) => handleMove(e.touches[0].clientX)}
        onTouchEnd={handleEnd}
      >
        {isLoading ? (
          <LoadingSpinner />
        ) : isCompleted ? (
          <CheckIcon />
        ) : (
          <ArrowIcon />
        )}
      </div>
    </div>
  )
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <rect
        x="5"
        y="11"
        width="14"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M8 11V7a4 4 0 1 1 8 0v4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      className="text-primary"
    >
      <path
        d="M5 12h14m0 0l-6-6m6 6l-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      className="text-green-600"
    >
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function LoadingSpinner() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      className="text-primary animate-spin"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="2.5"
        opacity="0.2"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
