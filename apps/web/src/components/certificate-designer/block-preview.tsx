import type {
  CertificateBlockFrame,
  CertificateBlockType,
  CertificateTemplateBlock,
  CertificateTemplateConfig,
} from '@calibra-facil/shared'

import { cn } from '@/lib/utils'

export const CERTIFICATE_BLOCK_LABELS: Record<CertificateBlockType, string> = {
  lab_header: 'Cabeçalho do laboratório',
  certificate_title: 'Título e número',
  customer_info: 'Cliente',
  asset_info: 'Instrumento',
  method_summary: 'Método',
  environmental_conditions: 'Condições ambientais',
  standards: 'Padrões utilizados',
  results: 'Resultados',
  uncertainty_budget: 'Orçamento de incerteza',
  signature: 'Assinatura',
  footer_note: 'Rodapé',
  qr_code: 'QR Code',
  free_text: 'Texto livre',
}

export const CERTIFICATE_BLOCK_MIN_SIZE: Record<
  CertificateBlockType,
  Pick<CertificateBlockFrame, 'width' | 'height'>
> = {
  lab_header: { width: 60, height: 22 },
  certificate_title: { width: 42, height: 22 },
  customer_info: { width: 54, height: 24 },
  asset_info: { width: 54, height: 24 },
  method_summary: { width: 70, height: 22 },
  environmental_conditions: { width: 54, height: 22 },
  standards: { width: 60, height: 28 },
  results: { width: 80, height: 34 },
  uncertainty_budget: { width: 80, height: 34 },
  signature: { width: 54, height: 24 },
  footer_note: { width: 70, height: 10 },
  qr_code: { width: 22, height: 22 },
  free_text: { width: 40, height: 14 },
}

export const DEFAULT_BLOCK_FRAMES: Record<
  CertificateBlockType,
  CertificateBlockFrame
> = {
  lab_header: { x: 12, y: 12, width: 120, height: 32 },
  certificate_title: { x: 140, y: 12, width: 58, height: 32 },
  customer_info: { x: 12, y: 52, width: 88, height: 32 },
  asset_info: { x: 108, y: 52, width: 88, height: 32 },
  method_summary: { x: 12, y: 92, width: 186, height: 28 },
  environmental_conditions: { x: 12, y: 128, width: 88, height: 28 },
  standards: { x: 108, y: 128, width: 88, height: 40 },
  results: { x: 12, y: 178, width: 186, height: 48 },
  uncertainty_budget: { x: 12, y: 232, width: 96, height: 36 },
  signature: { x: 118, y: 232, width: 80, height: 36 },
  footer_note: { x: 12, y: 276, width: 186, height: 12 },
  qr_code: { x: 12, y: 238, width: 28, height: 28 },
  free_text: { x: 12, y: 12, width: 70, height: 20 },
}

export const PALETTE_BLOCK_TYPES: CertificateBlockType[] = [
  'lab_header',
  'certificate_title',
  'customer_info',
  'asset_info',
  'method_summary',
  'environmental_conditions',
  'standards',
  'results',
  'uncertainty_budget',
  'signature',
  'footer_note',
  'qr_code',
  'free_text',
]

export function BlockPreview({
  block,
  config,
}: {
  block: CertificateTemplateBlock
  config: CertificateTemplateConfig
}) {
  const title = block.label || CERTIFICATE_BLOCK_LABELS[block.type]

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-[6px] border bg-white/95 text-[10px] leading-tight text-slate-900',
        block.type === 'results' || block.type === 'standards'
          ? 'border-slate-300'
          : 'border-slate-200',
      )}
      style={{
        borderColor:
          block.type === 'certificate_title'
            ? config.theme.primaryColor
            : undefined,
      }}
    >
      <div
        className="truncate px-2 py-1 text-[9px] font-semibold uppercase"
        style={{
          color:
            block.type === 'certificate_title'
              ? config.theme.primaryColor
              : undefined,
          background:
            block.type === 'certificate_title'
              ? config.theme.accentColor
              : undefined,
        }}
      >
        {title}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-2 py-1">
        {renderPreviewContent(block, config)}
      </div>
    </div>
  )
}

function renderPreviewContent(
  block: CertificateTemplateBlock,
  config: CertificateTemplateConfig,
) {
  switch (block.type) {
    case 'lab_header':
      return (
        <div className="flex h-full items-start gap-2">
          {config.theme.logoUrl && (
            <div className="grid h-9 w-12 shrink-0 place-items-center overflow-hidden rounded border bg-white">
              <img
                src={config.theme.logoUrl}
                alt="Logo do template"
                className="max-h-full max-w-full object-contain"
              />
            </div>
          )}
          <div className="min-w-0 space-y-1">
            <div className="truncate font-semibold">Laboratório Exemplo</div>
            <div className="truncate text-slate-500">
              RBC 123 | São Paulo - SP
            </div>
          </div>
        </div>
      )
    case 'certificate_title':
      return (
        <div className="space-y-1 text-right">
          <div className="font-semibold">{config.content.documentTitle}</div>
          <div className="text-sm font-bold">CF-2026-0042</div>
        </div>
      )
    case 'customer_info':
      return (
        <KeyValuePreview
          rows={['Cliente: Metalúrgica Horizonte', 'CNPJ: 98.765.432/0001-55']}
        />
      )
    case 'asset_info':
      return (
        <KeyValuePreview
          rows={['Instrumento: Balança Analítica', 'Série: BA-009182']}
        />
      )
    case 'method_summary':
      return (
        <p className="line-clamp-3 text-slate-600">
          Calibração gravimétrica por comparação direta com padrões rastreados.
        </p>
      )
    case 'environmental_conditions':
      return (
        <KeyValuePreview rows={['Temperatura: 23,1 °C', 'Umidade: 52,4 %']} />
      )
    case 'standards':
      return (
        <TablePreview
          headers={['Padrão', 'Cert.']}
          rows={[['E2 50 g', 'RB-2026-1182']]}
        />
      )
    case 'results':
      return (
        <TablePreview
          headers={['Ponto', 'Erro', 'U']}
          rows={[['50 g', '0,0013 g', '0,0002 g']]}
        />
      )
    case 'uncertainty_budget':
      return (
        <TablePreview
          headers={['Fonte', 'u']}
          rows={[['Repetibilidade', '0,0002 g']]}
        />
      )
    case 'signature':
      return (
        <div className="flex h-full flex-col justify-end">
          <div className="border-t border-slate-400 pt-1 text-center">
            Responsável técnica
          </div>
        </div>
      )
    case 'footer_note':
      return (
        <p className="truncate text-[9px] text-slate-500">
          {config.content.footerNote || 'Documento válido somente completo.'}
        </p>
      )
    case 'qr_code':
      return (
        <div className="grid h-full place-items-center">
          <div className="aspect-square h-full max-h-12 border-2 border-slate-700 bg-[repeating-linear-gradient(45deg,#0f172a_0_3px,#fff_3px_6px)]" />
        </div>
      )
    case 'free_text':
      return (
        <p className="line-clamp-3 text-slate-600">
          {block.content?.text || 'Texto configurável do certificado.'}
        </p>
      )
  }
}

function KeyValuePreview({ rows }: { rows: string[] }) {
  return (
    <div className="space-y-1 text-slate-600">
      {rows.map((row) => (
        <div key={row} className="truncate">
          {row}
        </div>
      ))}
    </div>
  )
}

function TablePreview({
  headers,
  rows,
}: {
  headers: string[]
  rows: string[][]
}) {
  return (
    <table className="w-full border-collapse text-[9px]">
      <thead>
        <tr>
          {headers.map((header) => (
            <th key={header} className="border bg-slate-100 px-1 text-left">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.join(':')}>
            {row.map((cell) => (
              <td key={cell} className="border px-1">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
