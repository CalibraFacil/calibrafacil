import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  ServiceOrderIntakeDocumentHtml,
  type ServiceOrderDocumentData,
} from '@calibra-facil/documents'

// REQ-DROPBOOL-001: the repair-seal / lacre (Etiqueta de Reparo) gating on a service-order
// document renders IFF the instrument's `metrology_regime === 'LEGAL'` — byte-identical to
// the old `subject_to_legal_metrology` boolean (which was kept in lock-step = regime LEGAL).
// This renders the REAL document component to markup and asserts the regulated fields appear
// for a LEGAL instrument and are absent otherwise. Mutation check: drop the regime gate from
// `ServiceOrderHtml.tsx` (render the lacre cells unconditionally / never) and this goes red.

function docData(
  metrologyRegime: 'INDUSTRIAL' | 'LEGAL' | 'UNKNOWN',
): ServiceOrderDocumentData {
  return {
    serviceOrderNumber: 'OS-2026-0001',
    openedAt: '2026-01-15T00:00:00.000Z',
    lab: { name: 'Laboratório Teste' },
    customer: { name: 'Cliente Teste' },
    asset: {
      name: 'Hidrômetro',
      serialNumber: 'SN-1',
      metrologyRegime,
    },
    intake: {
      claimedDefect: 'Não mede',
      intakeCondition: 'Recebido com avarias',
      oldSealNumber: 'LACRE-ANTIGO-1',
      newSealNumber: 'LACRE-NOVO-1',
      inmetroRepairSealNumber: 'ETQ-REPARO-1',
    },
  }
}

describe('REQ-DROPBOOL-001: service-order repair-seal gating by metrology_regime', () => {
  it('renders the Etiqueta de Reparo / lacre fields for a LEGAL instrument', () => {
    const html = renderToStaticMarkup(
      <ServiceOrderIntakeDocumentHtml data={docData('LEGAL')} />,
    )

    expect(html).toContain('Etiqueta de Reparo')
    expect(html).toContain('Lacre antigo')
    expect(html).toContain('Lacre novo')
  })

  it('omits the Etiqueta de Reparo / lacre fields for a non-LEGAL instrument', () => {
    for (const regime of ['INDUSTRIAL', 'UNKNOWN'] as const) {
      const html = renderToStaticMarkup(
        <ServiceOrderIntakeDocumentHtml data={docData(regime)} />,
      )

      expect(html).not.toContain('Etiqueta de Reparo')
      expect(html).not.toContain('Lacre antigo')
      expect(html).not.toContain('Lacre novo')
    }
  })
})
