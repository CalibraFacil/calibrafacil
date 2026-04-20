export type CertificateTemplateConfigVersion = 2;

export interface CertificateBlockFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CertificateBlockType =
  | "lab_header"
  | "certificate_title"
  | "customer_info"
  | "asset_info"
  | "method_summary"
  | "environmental_conditions"
  | "standards"
  | "results"
  | "uncertainty_budget"
  | "signature"
  | "footer_note"
  | "qr_code"
  | "free_text";

export interface CertificateTemplateBlock {
  id: string;
  type: CertificateBlockType;
  frame: CertificateBlockFrame;
  label?: string;
  binding?: string;
  content?: {
    text?: string;
  };
  locked?: boolean;
  fixedSize?: boolean;
}

export interface CertificateTemplatePage {
  id: string;
  label: string;
  size: "A4";
  orientation: "portrait";
  width: number;
  height: number;
  blocks: CertificateTemplateBlock[];
}

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

export interface CertificateTemplateLayout {
  headerStyle: "classic" | "split" | "minimal";
  density: "comfortable" | "compact";
  emphasis: "brand" | "formal" | "neutral";
}

export interface CertificateTemplateConfig {
  version: CertificateTemplateConfigVersion;
  theme: CertificateTemplateTheme;
  content: CertificateTemplateContent;
  sections: CertificateTemplateSections;
  layout: CertificateTemplateLayout;
  pages: CertificateTemplatePage[];
}

export interface CertificateTemplateSnapshot {
  id: number | null;
  name: string;
  slug: string;
  version: number;
  config: CertificateTemplateConfig;
}

export const A4_PORTRAIT_PAGE = {
  size: "A4",
  orientation: "portrait",
  width: 210,
  height: 297,
} as const satisfies Pick<
  CertificateTemplatePage,
  "size" | "orientation" | "width" | "height"
>;

export const DEFAULT_CERTIFICATE_TEMPLATE_PAGES: CertificateTemplatePage[] = [
  {
    id: "page-1",
    label: "Página 1",
    ...A4_PORTRAIT_PAGE,
    blocks: [
      {
        id: "lab-header",
        type: "lab_header",
        label: "Cabeçalho do laboratório",
        frame: { x: 12, y: 10, width: 124, height: 34 },
      },
      {
        id: "certificate-title",
        type: "certificate_title",
        label: "Título e número",
        frame: { x: 140, y: 10, width: 58, height: 34 },
      },
      {
        id: "customer-info",
        type: "customer_info",
        label: "Cliente",
        frame: { x: 12, y: 50, width: 90, height: 35 },
      },
      {
        id: "asset-info",
        type: "asset_info",
        label: "Instrumento",
        frame: { x: 108, y: 50, width: 90, height: 35 },
      },
      {
        id: "method-summary",
        type: "method_summary",
        label: "Método",
        frame: { x: 12, y: 91, width: 186, height: 32 },
      },
      {
        id: "environmental-conditions",
        type: "environmental_conditions",
        label: "Condições ambientais",
        frame: { x: 12, y: 129, width: 90, height: 32 },
      },
      {
        id: "standards",
        type: "standards",
        label: "Padrões utilizados",
        frame: { x: 108, y: 129, width: 90, height: 45 },
      },
      {
        id: "results",
        type: "results",
        label: "Resultados",
        frame: { x: 12, y: 180, width: 186, height: 50 },
      },
      {
        id: "signature",
        type: "signature",
        label: "Assinatura",
        frame: { x: 118, y: 238, width: 80, height: 34 },
      },
      {
        id: "footer-note",
        type: "footer_note",
        label: "Rodapé",
        frame: { x: 12, y: 275, width: 186, height: 12 },
      },
    ],
  },
];

export const DEFAULT_CERTIFICATE_TEMPLATE_CONFIG: CertificateTemplateConfig = {
  version: 2,
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
  layout: {
    headerStyle: "classic",
    density: "comfortable",
    emphasis: "brand",
  },
  pages: DEFAULT_CERTIFICATE_TEMPLATE_PAGES,
};

function cloneDefaultPages(): CertificateTemplatePage[] {
  return DEFAULT_CERTIFICATE_TEMPLATE_PAGES.map((page) => ({
    ...page,
    blocks: page.blocks.map((block) => ({
      ...block,
      frame: { ...block.frame },
      content: block.content ? { ...block.content } : undefined,
    })),
  }));
}

function normalizeFrame(
  frame: Partial<CertificateBlockFrame> | null | undefined,
  fallback: CertificateBlockFrame,
): CertificateBlockFrame {
  return {
    x: typeof frame?.x === "number" ? frame.x : fallback.x,
    y: typeof frame?.y === "number" ? frame.y : fallback.y,
    width: typeof frame?.width === "number" ? frame.width : fallback.width,
    height: typeof frame?.height === "number" ? frame.height : fallback.height,
  };
}

function normalizePages(
  pages: Partial<CertificateTemplatePage>[] | null | undefined,
): CertificateTemplatePage[] {
  if (!Array.isArray(pages) || pages.length === 0) {
    return cloneDefaultPages();
  }

  const defaultPage = DEFAULT_CERTIFICATE_TEMPLATE_PAGES[0]!;
  const defaultBlock = defaultPage.blocks[0]!;

  return pages.map((page, pageIndex) => {
    const fallbackPage =
      DEFAULT_CERTIFICATE_TEMPLATE_PAGES[pageIndex] ?? defaultPage;

    return {
      id: page.id || fallbackPage.id || `page-${pageIndex + 1}`,
      label: page.label || fallbackPage.label || `Página ${pageIndex + 1}`,
      size: "A4",
      orientation: "portrait",
      width: A4_PORTRAIT_PAGE.width,
      height: A4_PORTRAIT_PAGE.height,
      blocks: Array.isArray(page.blocks)
        ? page.blocks.map((block, blockIndex) => {
            const fallbackBlock =
              fallbackPage.blocks[blockIndex] ?? defaultBlock;

            return {
              id:
                block?.id ||
                fallbackBlock?.id ||
                `block-${pageIndex + 1}-${blockIndex + 1}`,
              type:
                block?.type ??
                fallbackBlock?.type ??
                ("free_text" as CertificateBlockType),
              label: block?.label ?? fallbackBlock?.label,
              binding: block?.binding,
              content: block?.content ? { ...block.content } : undefined,
              locked: block?.locked ?? false,
              fixedSize: block?.fixedSize ?? false,
              frame: normalizeFrame(
                block?.frame,
                fallbackBlock?.frame ?? { x: 12, y: 12, width: 60, height: 24 },
              ),
            };
          })
        : fallbackPage.blocks.map((block) => ({
            ...block,
            frame: { ...block.frame },
            content: block.content ? { ...block.content } : undefined,
          })),
    };
  });
}

export function normalizeCertificateTemplateConfig(
  config?: Partial<CertificateTemplateConfig> | null,
): CertificateTemplateConfig {
  const v2Config = config as
    | Partial<CertificateTemplateConfig>
    | null
    | undefined;

  return {
    version: 2,
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
    layout: {
      ...DEFAULT_CERTIFICATE_TEMPLATE_CONFIG.layout,
      ...(config?.layout ?? {}),
    },
    pages: normalizePages(
      Array.isArray(v2Config?.pages) ? v2Config.pages : undefined,
    ),
  };
}
