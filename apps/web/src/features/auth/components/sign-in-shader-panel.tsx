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

export function SignInShaderPanel() {
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
          ISO/IEC 17025 · GUM · Certificados digitais
        </p>
        <h2 className="max-w-md text-3xl font-semibold leading-tight text-balance">
          Calibração sem complicação.
        </h2>
        <p className="max-w-md text-sm text-white/80 text-pretty">
          Fluxos de calibração, cálculo de incertezas e emissão de certificados
          ISO/IEC 17025 em uma única plataforma.
        </p>
      </div>
    </div>
  )
}
