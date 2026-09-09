import { MeshGradient } from '@paper-design/shaders-react'
import { useReducedMotion } from 'motion/react'

// Logo gradient blues (#1447E6 → #4F46E5) plus the theme's chart-1 light blue
// and the logo highlight, so the mesh reads as the brand in motion.
const BRAND_MESH_COLORS = [
  '#1447E6',
  '#4F46E5',
  '#2B6AF3',
  '#93C5FD',
  '#F5F7FF',
]

type AuthShaderPanelProps = {
  /** Small caps line above the headline. */
  eyebrow?: string
  title?: string
  description?: string
}

/**
 * The brand panel that fills half of the authentication screens. Sign-in and
 * sign-up share it so the two pages read as one surface; only the copy over
 * the mesh changes, which is why the text is props rather than hardcoded.
 */
export function AuthShaderPanel({
  eyebrow = 'ISO/IEC 17025 · GUM · Certificados digitais',
  title = 'Calibração sem complicação.',
  description = 'Fluxos de calibração, cálculo de incertezas e emissão de certificados ISO/IEC 17025 em uma única plataforma.',
}: AuthShaderPanelProps = {}) {
  const prefersReducedMotion = useReducedMotion()

  return (
    <div className="relative flex size-full flex-col justify-end overflow-hidden rounded-3xl bg-linear-to-br from-[#1447E6] via-[#2B6AF3] to-[#4F46E5]">
      <MeshGradient
        className="absolute inset-0 size-full"
        colors={BRAND_MESH_COLORS}
        distortion={0.8}
        swirl={0.15}
        grainMixer={0}
        grainOverlay={0}
        speed={prefersReducedMotion ? 0 : 0.25}
      />

      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-linear-to-t from-blue-950/70 via-blue-950/25 to-transparent" />

      <div className="relative z-10 flex flex-col gap-4 p-10 text-white">
        <p className="text-xs font-medium tracking-[0.2em] uppercase text-white/70">
          {eyebrow}
        </p>
        <h2 className="max-w-md text-3xl font-semibold leading-tight text-balance">
          {title}
        </h2>
        <p className="max-w-md text-sm text-white/80 text-pretty">
          {description}
        </p>
      </div>
    </div>
  )
}
