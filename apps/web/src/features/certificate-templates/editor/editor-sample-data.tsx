import { renderToStaticMarkup } from 'react-dom/server'

import { AccreditationSealSvg } from '@calibra-facil/documents'
import {
  sampleCertificateInputData,
  type LockedBlockKey,
} from '@calibra-facil/certificate-html-template'

/**
 * Editor-only sample data + block labels, shared by the editor NodeViews, the
 * config controls and the inspector. Split from certificate-editor.tsx so the
 * config-controls module never import-cycles through the editor.
 */

export const LOCKED_BLOCK_LABELS: Record<string, string> = {
  certificate_identification: 'Identificação do certificado',
  lab_identification: 'Identificação do laboratório',
  customer_identification: 'Identificação do cliente',
  item_identification: 'Identificação do item',
  method_traceability: 'Método e rastreabilidade',
  environmental_conditions: 'Condições ambientais',
  results_table: 'Tabela de resultados',
  uncertainty_statement: 'Declaração de incerteza',
  signature_block: 'Assinatura autorizada',
  accreditation_seal: 'Selo de acreditação',
  verification_qr: 'QR de verificação',
  end_of_document: 'Fim do certificado',
  // optional blocks (0-or-1)
  uncertainty_budget_annex: 'Balanço de incertezas (anexo)',
  decision_rule_statement: 'Regra de decisão',
}

// ---------------------------------------------------------------------------
// Editor-only sample data: identical to the canonical fixture, but binary
// artifacts (QR, signature image) are inline SVG placeholders so nothing 404s
// inside the editor. NEVER used by the real compiler.
// ---------------------------------------------------------------------------

export const QR_PLACEHOLDER_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(
  // Real QR matrix (generated with the same qrcode lib the compiler uses),
  // encoding the SAMPLE verification URL /v/exemplo — a deliberately invalid
  // token, so the preview scans to "certificado não encontrado".
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 31 31" shape-rendering="crispEdges"><path fill="#ffffff" d="M0 0h31v31H0z"/><path stroke="#000000" d="M1 1.5h7m1 0h1m1 0h2m1 0h2m2 0h2m3 0h7M1 2.5h1m5 0h1m2 0h1m4 0h1m2 0h2m1 0h1m1 0h1m5 0h1M1 3.5h1m1 0h3m1 0h1m1 0h3m2 0h1m1 0h6m1 0h1m1 0h3m1 0h1M1 4.5h1m1 0h3m1 0h1m2 0h1m1 0h8m3 0h1m1 0h3m1 0h1M1 5.5h1m1 0h3m1 0h1m3 0h2m2 0h1m2 0h2m3 0h1m1 0h3m1 0h1M1 6.5h1m5 0h1m1 0h1m1 0h3m1 0h1m1 0h1m5 0h1m5 0h1M1 7.5h7m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h7M12 8.5h2m1 0h1m1 0h1m1 0h2M1 9.5h1m1 0h1m3 0h2m2 0h2m3 0h2m2 0h1m3 0h1m2 0h1m1 0h1M1 10.5h1m3 0h2m3 0h4m1 0h3m2 0h2m1 0h2m3 0h2M2 11.5h1m1 0h2m1 0h2m1 0h1m3 0h3m2 0h3m1 0h1m1 0h3m1 0h1M1 12.5h2m1 0h2m2 0h2m1 0h1m4 0h2m1 0h2m2 0h1m1 0h2M1 13.5h3m3 0h1m2 0h4m3 0h1m2 0h2m1 0h2m4 0h1M3 14.5h2m1 0h1m1 0h5m1 0h1m1 0h1m1 0h1m1 0h5m3 0h2M2 15.5h1m1 0h2m1 0h3m2 0h3m1 0h5m1 0h1m1 0h1m4 0h1M1 16.5h1m2 0h3m1 0h2m2 0h2m2 0h2m1 0h1m2 0h1M1 17.5h1m4 0h2m4 0h1m3 0h1m4 0h3m5 0h1M3 18.5h2m3 0h4m2 0h1m1 0h3m1 0h2m1 0h2m2 0h3M1 19.5h2m1 0h8m4 0h1m1 0h1m1 0h2m3 0h2m2 0h1M4 20.5h2m2 0h1m1 0h1m4 0h3m3 0h1m1 0h2M1 21.5h4m1 0h5m2 0h3m1 0h1m1 0h1m1 0h6m1 0h1M9 22.5h1m1 0h1m1 0h2m1 0h1m1 0h1m2 0h1m3 0h3m1 0h1M1 23.5h7m1 0h1m1 0h1m1 0h1m2 0h1m4 0h1m1 0h1m1 0h1m3 0h1M1 24.5h1m5 0h1m6 0h1m2 0h1m2 0h2m3 0h1m2 0h1M1 25.5h1m1 0h3m1 0h1m2 0h3m1 0h1m2 0h1m2 0h7m1 0h1M1 26.5h1m1 0h3m1 0h1m3 0h1m1 0h2m1 0h2m2 0h1m1 0h1m2 0h3m1 0h1M1 27.5h1m1 0h3m1 0h1m1 0h1m3 0h2m1 0h1m2 0h4m2 0h1m2 0h2M1 28.5h1m5 0h1m4 0h3m1 0h2m1 0h1m1 0h1m3 0h2M1 29.5h7m1 0h2m3 0h1m2 0h1m3 0h1m3 0h1m3 0h1"/></svg>',
)}`

const LOGO_PLACEHOLDER_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(
  // Compact mark only — the masthead already prints the lab name beside it.
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="18" fill="#1e3a5f"/><text x="48" y="61" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="38" font-weight="700" fill="#fff">LE</text></svg>',
)}`

// The REAL accreditation seal component (packages/documents) — the same art
// the worker rasterizes at issuance — rendered with the sample CAL number.
const SEAL_SAMPLE_DATA_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
  renderToStaticMarkup(<AccreditationSealSvg accreditationNumber="9999" />),
)}`

function buildEditorSampleData(): Record<string, unknown> {
  const clone: Record<string, unknown> = JSON.parse(
    JSON.stringify(sampleCertificateInputData),
  )
  // approval.signatureUrl already ships as an inline data URL in the fixture.
  const lab = Reflect.get(clone, 'lab')
  if (lab && typeof lab === 'object') {
    Reflect.set(lab, 'logoDataUrl', LOGO_PLACEHOLDER_SVG)
    Reflect.set(lab, 'accreditationSealPng', SEAL_SAMPLE_DATA_URL)
  }
  return clone
}

export const EDITOR_SAMPLE_DATA = buildEditorSampleData()

export function isLockedBlockKey(value: string): value is LockedBlockKey {
  return value in LOCKED_BLOCK_LABELS
}

/**
 * Sample data with the ORG'S REAL logo swapped in: a lab manager designing
 * their certificate should see their own mark, not a placeholder glyph.
 */
export function editorSampleDataWithLogo(
  logoUrl: string | null,
): Record<string, unknown> {
  if (!logoUrl) return EDITOR_SAMPLE_DATA
  const lab = Reflect.get(EDITOR_SAMPLE_DATA, 'lab')
  return {
    ...EDITOR_SAMPLE_DATA,
    lab: {
      ...(lab && typeof lab === 'object' ? lab : {}),
      logoDataUrl: logoUrl,
    },
  }
}
