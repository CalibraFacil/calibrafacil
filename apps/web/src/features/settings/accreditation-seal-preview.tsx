import { useRef } from 'react'

import { AccreditationSealSvg } from '@calibra-facil/documents'
import type { AccreditationStatus } from '@calibra-facil/shared'

import './accreditation-seal-preview.css'

const STATUS_HINTS: Record<AccreditationStatus, string> = {
  inactive:
    'Ative a acreditação para emitir o selo nos certificados de métodos com escopo acreditado.',
  incomplete:
    'Informe o número de acreditação para concluir a ativação do selo.',
  active:
    'Acreditação ativa — o selo será emitido nos certificados de métodos com escopo acreditado.',
}

/**
 * Live seal preview for the ISO 17025 settings card. While the accreditation
 * is inactive/incomplete the canonical seal renders dimmed; once active it
 * gains the holographic tilt treatment (presentation only — issued documents
 * always receive the canonical artwork).
 */
export function AccreditationSealPreview({
  status,
  accreditationNumber,
}: {
  status: AccreditationStatus
  accreditationNumber: string
}) {
  const sealRef = useRef<HTMLDivElement>(null)
  const isActive = status === 'active'

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const seal = sealRef.current
    if (!seal) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const rect = seal.getBoundingClientRect()
    seal.classList.remove('accreditation-seal--leaving')
    seal.style.setProperty(
      '--mx',
      ((event.clientX - rect.left) / rect.width).toFixed(3),
    )
    seal.style.setProperty(
      '--my',
      ((event.clientY - rect.top) / rect.height).toFixed(3),
    )
  }

  const handlePointerLeave = () => {
    const seal = sealRef.current
    if (!seal) return
    seal.classList.add('accreditation-seal--leaving')
    seal.style.setProperty('--mx', '0.5')
    seal.style.setProperty('--my', '0.5')
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="accreditation-seal-stage">
        <div
          ref={sealRef}
          className={
            isActive
              ? 'accreditation-seal accreditation-seal--holo'
              : 'accreditation-seal accreditation-seal--idle'
          }
          onPointerMove={isActive ? handlePointerMove : undefined}
          onPointerLeave={isActive ? handlePointerLeave : undefined}
        >
          <AccreditationSealSvg
            accreditationNumber={accreditationNumber}
            effect={isActive ? 'holo' : 'none'}
            width={140}
          />
        </div>
      </div>
      <p className="text-muted-foreground max-w-60 text-center text-xs leading-relaxed">
        {STATUS_HINTS[status]}
      </p>
    </div>
  )
}
