import Color from 'color'
import { Slider } from '@base-ui/react/slider'
import { useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'

type ColorInputProps = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
  title?: string
  description?: string
  presets?: string[]
}

const DEFAULT_PRESETS = [
  '#0066CC',
  '#0F766E',
  '#166534',
  '#B45309',
  '#B91C1C',
  '#334155',
]

function safeColor(value: string) {
  try {
    return Color(value)
  } catch {
    return Color('#0066CC')
  }
}

function normalizeHex(value: string) {
  return safeColor(value).hex().toUpperCase()
}

export function ColorInput({
  value,
  onChange,
  disabled = false,
  className,
  title = 'Cor',
  description = 'Ajuste a cor em hex ou escolha visualmente.',
  presets = DEFAULT_PRESETS,
}: ColorInputProps) {
  const currentColor = useMemo(() => safeColor(value), [value])
  const [hue, setHue] = useState(currentColor.hsv().color[0] ?? 0)
  const [saturation, setSaturation] = useState(currentColor.hsv().color[1] ?? 100)
  const [brightness, setBrightness] = useState(currentColor.hsv().color[2] ?? 100)
  const [hexInput, setHexInput] = useState(normalizeHex(value))

  useEffect(() => {
    const color = safeColor(value)
    const [nextHue, nextSaturation, nextBrightness] = color.hsv().array()

    setHue(nextHue ?? 0)
    setSaturation(nextSaturation ?? 100)
    setBrightness(nextBrightness ?? 100)
    setHexInput(color.hex().toUpperCase())
  }, [value])

  const selectionBackground = useMemo(
    () =>
      `linear-gradient(0deg, rgba(0,0,0,1), rgba(0,0,0,0)), linear-gradient(90deg, rgba(255,255,255,1), rgba(255,255,255,0)), hsl(${Math.round(hue)} 100% 50%)`,
    [hue],
  )

  const positionX = saturation / 100
  const positionY = 1 - brightness / 100

  function commitHex(nextValue: string) {
    const trimmed = nextValue.trim()
    if (!trimmed) {
      setHexInput(normalizeHex(value))
      return
    }

    try {
      const nextHex = normalizeHex(trimmed)
      onChange(nextHex)
    } catch {
      setHexInput(normalizeHex(value))
    }
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Popover>
        <PopoverTrigger
          disabled={disabled}
          render={(props) => (
            <Button
              {...props}
              type="button"
              variant="outline"
              size="icon"
              disabled={disabled}
              className="shrink-0"
            />
          )}
        >
          <span
            className="block size-4 rounded-full border border-black/10"
            style={{ backgroundColor: currentColor.hex() }}
          />
          <span className="sr-only">Abrir seletor de cor</span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[320px] gap-5">
          <PopoverHeader>
            <PopoverTitle>{title}</PopoverTitle>
            <PopoverDescription>{description}</PopoverDescription>
          </PopoverHeader>

          <ColorSelection
            background={selectionBackground}
            disabled={disabled}
            positionX={positionX}
            positionY={positionY}
            onChange={(nextSaturation, nextBrightness) => {
              setSaturation(nextSaturation)
              setBrightness(nextBrightness)
              onChange(
                Color.hsv(hue, nextSaturation, nextBrightness).hex().toUpperCase(),
              )
            }}
          />

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Matiz</span>
              <span>{Math.round(hue)}°</span>
            </div>
            <Slider.Root
              min={0}
              max={360}
              step={1}
              value={hue}
              onValueChange={(nextValue) => {
                setHue(nextValue as number)
                onChange(
                  Color.hsv(nextValue as number, saturation, brightness)
                    .hex()
                    .toUpperCase(),
                )
              }}
            >
              <Slider.Control className="flex w-full touch-none items-center py-1">
                <Slider.Track className="relative h-3 w-full rounded-full bg-[linear-gradient(90deg,#FF0000,#FFFF00,#00FF00,#00FFFF,#0000FF,#FF00FF,#FF0000)]">
                  <Slider.Indicator className="absolute h-full rounded-full bg-transparent" />
                  <Slider.Thumb
                    aria-label="Matiz"
                    className="block size-4 rounded-full border border-primary/40 bg-background shadow-sm outline-none ring-0"
                  />
                </Slider.Track>
              </Slider.Control>
            </Slider.Root>
          </div>

          <div className="space-y-2">
            <span className="text-xs text-muted-foreground">Paleta rápida</span>
            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => {
                const normalized = normalizeHex(preset)
                const isActive = normalized === currentColor.hex().toUpperCase()

                return (
                  <button
                    key={preset}
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(normalized)}
                    className={cn(
                      'size-7 rounded-full border transition-transform hover:scale-105',
                      isActive ? 'ring-2 ring-primary/30 ring-offset-2' : 'ring-0',
                    )}
                    style={{ backgroundColor: normalized }}
                    aria-label={`Selecionar ${normalized}`}
                  />
                )
              })}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <Input
        value={hexInput}
        disabled={disabled}
        onChange={(event) => setHexInput(event.target.value.toUpperCase())}
        onBlur={(event) => commitHex(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitHex(hexInput)
          }
          if (event.key === 'Escape') {
            setHexInput(normalizeHex(value))
          }
        }}
        className="font-mono uppercase"
      />
    </div>
  )
}

function ColorSelection({
  background,
  positionX,
  positionY,
  onChange,
  disabled,
}: {
  background: string
  positionX: number
  positionY: number
  onChange: (saturation: number, brightness: number) => void
  disabled: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  function updateFromPointer(clientX: number, clientY: number) {
    if (!containerRef.current || disabled) return

    const rect = containerRef.current.getBoundingClientRect()
    const nextX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const nextY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))

    onChange(Math.round(nextX * 100), Math.round((1 - nextY) * 100))
  }

  useEffect(() => {
    if (!dragging) return

    const handlePointerMove = (event: PointerEvent) => {
      updateFromPointer(event.clientX, event.clientY)
    }

    const handlePointerUp = () => setDragging(false)

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [dragging, disabled])

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative h-40 w-full rounded-xl border',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-crosshair',
      )}
      style={{ background }}
      onPointerDown={(event) => {
        if (disabled) return
        event.preventDefault()
        setDragging(true)
        updateFromPointer(event.clientX, event.clientY)
      }}
    >
      <div
        className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
        style={{
          left: `${positionX * 100}%`,
          top: `${positionY * 100}%`,
        }}
      />
    </div>
  )
}
