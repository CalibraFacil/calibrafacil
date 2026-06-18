import { describe, expect, it } from 'vitest'
import { quantityKindForReferenceStandardKind } from '@calibra-facil/schemas'
import { unitKind } from '@calibra-facil/shared/units'

import { METROLOGY_KIND_DEFINITIONS } from './metrology-kinds'

describe('metrology-kinds channels reconcile with the quantity-kind adapter', () => {
  it('every channel whose unit resolves belongs to its standard kind dimensions', () => {
    for (const definition of METROLOGY_KIND_DEFINITIONS) {
      const allowed = quantityKindForReferenceStandardKind(definition.kind)
      for (const channel of definition.channels) {
        const kind = unitKind(channel.unit)
        // Channel units that are not registry tokens (e.g. barometer "hPa", the
        // empty generic unit) are informational only — skip them.
        if (kind === null) continue
        expect(
          allowed,
          `channel "${channel.key}" of "${definition.kind}" uses unit "${channel.unit}" (${kind}), not in [${allowed.join(', ')}]`,
        ).toContain(kind)
      }
    }
  })
})
