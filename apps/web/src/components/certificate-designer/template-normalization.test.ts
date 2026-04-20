import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CERTIFICATE_TEMPLATE_CONFIG,
  normalizeCertificateTemplateConfig,
} from '@calibra-facil/shared'

describe('certificate template normalization', () => {
  it('normalizes configs without pages into v2 page/block templates', () => {
    const config = normalizeCertificateTemplateConfig({
      theme: {
        ...DEFAULT_CERTIFICATE_TEMPLATE_CONFIG.theme,
        primaryColor: '#123456',
      },
      content: {
        ...DEFAULT_CERTIFICATE_TEMPLATE_CONFIG.content,
        documentTitle: 'CERTIFICADO LEGADO',
      },
      sections: DEFAULT_CERTIFICATE_TEMPLATE_CONFIG.sections,
      layout: DEFAULT_CERTIFICATE_TEMPLATE_CONFIG.layout,
    })

    expect(config.version).toBe(2)
    expect(config.theme.primaryColor).toBe('#123456')
    expect(config.content.documentTitle).toBe('CERTIFICADO LEGADO')
    expect(config.pages[0]?.size).toBe('A4')
    expect(config.pages[0]?.blocks[0]?.frame).toEqual(
      DEFAULT_CERTIFICATE_TEMPLATE_CONFIG.pages[0]?.blocks[0]?.frame,
    )
  })
})
