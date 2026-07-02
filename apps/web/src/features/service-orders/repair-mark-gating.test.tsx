import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  ServiceOrderIntakeDocumentHtml,
  type ServiceOrderDocumentData,
} from '@calibra-facil/documents'

// REQ-DROPBOOL-001: the repair-mark (Marca de Reparo) / marca-de-selagem gating on a
// service-order document renders IFF the instrument's `metrology_regime === 'LEGAL'` —
// byte-identical to the old `subject_to_legal_metrology` boolean (kept in lock-step = LEGAL).
// This renders the REAL document component to markup and asserts the regulated fields appear
// for a LEGAL instrument and are absent otherwise. Mutation check: drop the regime gate from
// `ServiceOrderHtml.tsx` (render the seal cells unconditionally / never) and this goes red.

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
      removedSealingMarkNumber: 'LACRE-ANTIGO-1',
      affixedSealingMarkNumber: 'LACRE-NOVO-1',
      inmetroRepairMarkNumber: 'ETQ-REPARO-1',
    },
  }
}

describe('REQ-DROPBOOL-001: service-order repair-mark gating by metrology_regime', () => {
  it('renders the Marca de Reparo / marca de selagem fields for a LEGAL instrument', () => {
    const html = renderToStaticMarkup(
      <ServiceOrderIntakeDocumentHtml data={docData('LEGAL')} />,
    )

    expect(html).toContain('Nº Marca de Reparo')
    expect(html).toContain('Marca de selagem retirada')
    expect(html).toContain('Marca de selagem aposta')
  })

  it('omits the Marca de Reparo / marca de selagem fields for a non-LEGAL instrument', () => {
    for (const regime of ['INDUSTRIAL', 'UNKNOWN'] as const) {
      const html = renderToStaticMarkup(
        <ServiceOrderIntakeDocumentHtml data={docData(regime)} />,
      )

      expect(html).not.toContain('Nº Marca de Reparo')
      expect(html).not.toContain('Marca de selagem retirada')
      expect(html).not.toContain('Marca de selagem aposta')
    }
  })
})
