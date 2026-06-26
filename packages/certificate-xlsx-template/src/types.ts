export interface CertificateWorkbookEngine {
  analyze(input: Uint8Array): Promise<WorkbookAnalysis>;
  fillScalars(
    input: Uint8Array,
    bindings: ScalarCellBinding[],
    data: Record<string, unknown>,
  ): Promise<Uint8Array>;
  insertImages?(
    input: Uint8Array,
    bindings: ImageCellBinding[],
    images: Record<string, WorkbookImage>,
  ): Promise<Uint8Array>;
}

export type WorkbookImage =
  | Uint8Array
  | {
      bytes: Uint8Array;
      contentType?: string;
      extension?: string;
    };

export type WorkbookAnalysis = {
  sheets: Array<{
    name: string;
    usedRange?: string;
    printArea?: string | null;
    namedRanges: string[];
    placeholders: WorkbookPlaceholder[];
  }>;
  warnings: WorkbookWarning[];
};

export type WorkbookPlaceholder = {
  sheet: string;
  cell: string;
  targetRange?: string;
  token: string;
  fieldPath: string;
};

export type WorkbookWarning = {
  code:
    | "external_links"
    | "macros_rejected"
    | "missing_sheet"
    | "missing_print_area"
    | "missing_fit_to_width"
    | "unsupported_file_type"
    | "named_ranges_unavailable"
    | "missing_required_field"
    | "unknown_field"
    | "unknown_field_path"
    | "interval_recommendation_field"
    | "volatile_formula"
    | "image_source_missing"
    | "image_replacement_unavailable"
    | "table_overflow_deferred";
  message: string;
  sheet?: string;
  cell?: string;
  fieldPath?: string;
};

export type ScalarCellBinding = {
  id: string;
  sheet: string;
  cell: string;
  fieldPath: string;
  formatter?: string;
  required?: boolean;
  governed?: boolean;
};

export type ImageCellBinding = {
  id: string;
  sheet: string;
  targetRange: string;
  imageKind:
    | "qr_code"
    | "signature"
    | "organization_logo"
    | "accreditation_seal"
    | "eccentricity_indicator";
  sourcePath: string;
  placeholderName?: string;
};

export type TableBinding = {
  id: string;
  kind: "table";
  arrayPath: string;
  sheet: string;
  templateRange: string;
  itemAlias: string;
  columns: Array<{
    cell: string;
    path: string;
    formatter?: string;
  }>;
  overflowPolicy: "appendRows" | "fixedSlots" | "annex";
};

export type ScalarFillWarning = WorkbookWarning;

export type FilledWorkbookResult = {
  workbook: Uint8Array;
  warnings: WorkbookWarning[];
};
