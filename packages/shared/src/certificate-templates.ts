export type CertificateTemplateConfigVersion = 1;

export interface CertificateTemplateTheme {
  primaryColor: string;
  accentColor: string;
  logoUrl: string | null;
}

export interface CertificateTemplateContent {
  documentTitle: string;
  introText: string | null;
  footerNote: string | null;
}

export interface CertificateTemplateSections {
  showLabAddress: boolean;
  showLabContact: boolean;
  showAccreditation: boolean;
  showCustomerContact: boolean;
  showEnvironmental: boolean;
  showStandards: boolean;
  showResults: boolean;
  showSignature: boolean;
  showAmendmentNotice: boolean;
}

export interface CertificateTemplateConfig {
  version: CertificateTemplateConfigVersion;
  theme: CertificateTemplateTheme;
  content: CertificateTemplateContent;
  sections: CertificateTemplateSections;
}

export interface CertificateTemplateSnapshot {
  id: number | null;
  name: string;
  slug: string;
  version: number;
  config: CertificateTemplateConfig;
}

export const DEFAULT_CERTIFICATE_TEMPLATE_CONFIG: CertificateTemplateConfig = {
  version: 1,
  theme: {
    primaryColor: "#0066cc",
    accentColor: "#f5f5f5",
    logoUrl: null,
  },
  content: {
    documentTitle: "CERTIFICADO DE CALIBRACAO",
    introText: null,
    footerNote: null,
  },
  sections: {
    showLabAddress: true,
    showLabContact: true,
    showAccreditation: true,
    showCustomerContact: true,
    showEnvironmental: true,
    showStandards: true,
    showResults: true,
    showSignature: true,
    showAmendmentNotice: true,
  },
};

export function normalizeCertificateTemplateConfig(
  config?: Partial<CertificateTemplateConfig> | null,
): CertificateTemplateConfig {
  return {
    version: 1,
    theme: {
      ...DEFAULT_CERTIFICATE_TEMPLATE_CONFIG.theme,
      ...(config?.theme ?? {}),
    },
    content: {
      ...DEFAULT_CERTIFICATE_TEMPLATE_CONFIG.content,
      ...(config?.content ?? {}),
    },
    sections: {
      ...DEFAULT_CERTIFICATE_TEMPLATE_CONFIG.sections,
      ...(config?.sections ?? {}),
    },
  };
}
