import { Workbook, type Worksheet } from "@cj-tech-master/excelts";

import { formatValue, getPath } from "./formatters.js";
import {
  findWorkbookImageTargets,
  getElements,
  hasExternalLinks,
  hasWorkbookContentType,
  insertWorkbookPngImages,
  isMacroEnabledWorkbook,
  readZip,
  readText,
  readXml,
  readWorkbookSheetPaths,
  preserveWorkbookDefinedNames,
  configureWorkbookPrintSettings,
  replaceWorkbookImages,
  setWorksheetCellTexts,
  writeText,
  writeZip,
} from "./ooxml.js";
import type {
  CertificateWorkbookEngine,
  FilledWorkbookResult,
  ImageCellBinding,
  ScalarCellBinding,
  TableBinding,
  WorkbookAnalysis,
  WorkbookImage,
  WorkbookPlaceholder,
  WorkbookWarning,
} from "./types.js";

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function getObjectProperty(value: unknown, key: string) {
  return value && typeof value === "object" && key in value
    ? Reflect.get(value, key)
    : undefined;
}

export class ExcelTsCertificateWorkbookEngine implements CertificateWorkbookEngine {
  async analyze(input: Uint8Array): Promise<WorkbookAnalysis> {
    const warnings = validateWorkbookContainer(input);
    if (warnings.some((warning) => warning.code === "unsupported_file_type")) {
      return { sheets: [], warnings };
    }

    const workbook = await loadWorkbook(input);
    const printAreas = readPrintAreas(input);
    const visibleSheetNames = readVisibleSheetNames(input);
    const worksheetPageSetups = readWorksheetPageSetups(input);
    const namedRanges = readNamedRanges(input);
    warnings.push(...findVolatileFormulaWarnings(input));

    if (namedRanges.unavailable) {
      warnings.push({
        code: "named_ranges_unavailable",
        message: "Named ranges could not be read from workbook metadata.",
      });
    }

    const sheets = workbook.worksheets.map((sheet) => ({
      name: sheet.name,
      usedRange: getUsedRange(sheet),
      printArea: printAreas.get(sheet.name) ?? null,
      namedRanges: namedRanges.bySheet.get(sheet.name) ?? [],
      placeholders: findPlaceholders(sheet),
    }));
    for (const sheet of sheets) {
      if (!visibleSheetNames.has(sheet.name) || !sheet.usedRange) {
        continue;
      }

      if (!sheet.printArea) {
        warnings.push({
          code: "missing_print_area",
          message: `A aba "${sheet.name}" não define uma área de impressão.`,
          sheet: sheet.name,
        });
      }

      const pageSetup = worksheetPageSetups.get(sheet.name);
      if (pageSetup?.fitToPage !== true || pageSetup?.fitToWidth !== 1) {
        warnings.push({
          code: "missing_fit_to_width",
          message: `A aba "${sheet.name}" não está configurada para caber em 1 página de largura.`,
          sheet: sheet.name,
        });
      }
    }

    return { sheets, warnings };
  }

  async fillScalars(
    input: Uint8Array,
    bindings: ScalarCellBinding[],
    data: Record<string, unknown>,
  ): Promise<Uint8Array> {
    const { workbook } = await this.fillScalarsWithWarnings(
      input,
      bindings,
      data,
    );

    return workbook;
  }

  async fillScalarsWithWarnings(
    input: Uint8Array,
    bindings: ScalarCellBinding[],
    data: Record<string, unknown>,
  ): Promise<FilledWorkbookResult> {
    const warnings: WorkbookWarning[] = [];

    return {
      workbook: fillScalarCellsDirect(input, bindings, data, warnings),
      warnings,
    };
  }

  async fillPlaceholderScalars(
    input: Uint8Array,
    data: Record<string, unknown>,
  ): Promise<FilledWorkbookResult> {
    const analysis = await this.analyze(input);
    const bindings = analysis.sheets.flatMap((sheet) =>
      sheet.placeholders.map<ScalarCellBinding>((placeholder) => ({
        id: `${placeholder.sheet}:${placeholder.cell}:${placeholder.fieldPath}`,
        sheet: placeholder.sheet,
        cell: placeholder.cell,
        fieldPath: placeholder.fieldPath,
      })),
    );

    return this.fillScalarsWithWarnings(input, bindings, data);
  }

  async insertImages(
    input: Uint8Array,
    bindings: ImageCellBinding[],
    images: Record<string, WorkbookImage>,
  ): Promise<Uint8Array> {
    let workbook = input;
    const insertions = bindings.flatMap((binding) => {
      const image = images[binding.sourcePath] ?? images[binding.id];
      if (!image) {
        return [];
      }
      const normalizedImage =
        image instanceof Uint8Array ? { bytes: image } : image;

      return [
        {
          sheetName: binding.sheet,
          targetRange: binding.targetRange,
          image: normalizedImage.bytes,
          contentType: normalizedImage.contentType,
          extension: normalizedImage.extension,
          name: binding.placeholderName ?? binding.sourcePath,
          // Logos and the accreditation seal are regulated artwork - never
          // stretch them to the target range.
          fit:
            binding.imageKind === "organization_logo" ||
            binding.imageKind === "accreditation_seal"
              ? ("contain" as const)
              : ("stretch" as const),
          insetRatio: binding.imageKind === "organization_logo" ? 0.06 : 0,
        },
      ];
    });

    for (const binding of bindings) {
      const cell = binding.targetRange.split(":")[0];
      if (!cell) {
        continue;
      }

      workbook = setWorksheetCellTexts(workbook, binding.sheet, { [cell]: "" });
    }

    return insertWorkbookPngImages(workbook, insertions);
  }

  async replacePlaceholderImages(
    input: Uint8Array,
    images: Record<string, WorkbookImage>,
  ): Promise<Uint8Array> {
    const targets = findWorkbookImageTargets(readZip(input));
    const replacements: Record<string, Uint8Array> = {};

    for (const [index, target] of targets.entries()) {
      const namedImage =
        images[target] ??
        images[`image${index + 1}`] ??
        images[`image${index}`] ??
        images.default;

      if (namedImage) {
        replacements[target] =
          namedImage instanceof Uint8Array ? namedImage : namedImage.bytes;
      }
    }

    return replaceWorkbookImages(input, replacements);
  }

  async fillTableRows(
    input: Uint8Array,
    binding: TableBinding,
    data: Record<string, unknown>,
  ): Promise<FilledWorkbookResult> {
    const workbook = await loadWorkbook(input);
    const warnings: WorkbookWarning[] = [];
    const sheet = workbook.getWorksheet(binding.sheet);

    if (!sheet) {
      return {
        workbook: input,
        warnings: [
          {
            code: "missing_sheet",
            message: `Sheet "${binding.sheet}" was not found.`,
            sheet: binding.sheet,
          },
        ],
      };
    }

    const rows = getPath(data, binding.arrayPath);
    if (!Array.isArray(rows)) {
      return {
        workbook: preserveWorkbookDefinedNames(
          input,
          await workbook.xlsx.writeBuffer({ validate: false }),
          ["_xlnm.Print_Area"],
        ),
        warnings: [
          {
            code: "unknown_field",
            message: `Table array "${binding.arrayPath}" was not found.`,
            sheet: binding.sheet,
            fieldPath: binding.arrayPath,
          },
        ],
      };
    }

    if (binding.overflowPolicy !== "appendRows") {
      warnings.push({
        code: "table_overflow_deferred",
        message: `Overflow policy "${binding.overflowPolicy}" is documented but not expanded by this spike.`,
        sheet: binding.sheet,
      });
    }

    const templateRow = Number.parseInt(
      binding.templateRange.match(/\d+/)?.[0] ?? "",
      10,
    );
    if (!Number.isInteger(templateRow)) {
      throw new Error(`Unsupported template range: ${binding.templateRange}`);
    }

    if (rows.length > 1 && binding.overflowPolicy === "appendRows") {
      sheet.duplicateRow(templateRow, rows.length - 1, true);
    }

    rows.forEach((row, rowIndex) => {
      const item = toRecord(row);
      for (const column of binding.columns) {
        const cellAddress = column.cell.replace(
          /\d+$/,
          String(templateRow + rowIndex),
        );
        sheet.getCell(cellAddress).value = formatValue(
          getPath(item, column.path),
          column.formatter,
        );
      }
    });

    return {
      workbook: preserveWorkbookDefinedNames(
        input,
        await workbook.xlsx.writeBuffer({ validate: false }),
        ["_xlnm.Print_Area"],
      ),
      warnings,
    };
  }
}

export async function loadWorkbook(input: Uint8Array): Promise<Workbook> {
  const workbook = new Workbook();
  await workbook.xlsx.load(input);
  return workbook;
}

export async function normalizeWorkbookPrintSettings(
  input: Uint8Array,
): Promise<Uint8Array> {
  const workbook = await loadWorkbook(input);
  const printAreas = readPrintAreas(input);
  const visibleSheetNames = readVisibleSheetNames(input);
  const worksheetPageSetups = readWorksheetPageSetups(input);
  const settings = workbook.worksheets.flatMap((sheet) => {
    const usedRange = getUsedRange(sheet);
    if (!visibleSheetNames.has(sheet.name) || !usedRange) {
      return [];
    }

    const pageSetup = worksheetPageSetups.get(sheet.name);
    const printArea = printAreas.get(sheet.name);
    if (
      printArea &&
      pageSetup?.fitToPage === true &&
      pageSetup.fitToWidth === 1
    ) {
      return [];
    }

    return [
      {
        sheetName: sheet.name,
        printArea: printArea ?? usedRange,
        fitToWidth: 1,
      },
    ];
  });

  return configureWorkbookPrintSettings(input, settings);
}

export function validateWorkbookContainer(
  input: Uint8Array,
): WorkbookWarning[] {
  let entries: ReturnType<typeof readZip>;
  try {
    entries = readZip(input);
  } catch {
    return [
      {
        code: "unsupported_file_type",
        message: "Input is not an XLSX workbook.",
      },
    ];
  }

  const warnings: WorkbookWarning[] = [];

  if (!hasWorkbookContentType(entries)) {
    warnings.push({
      code: "unsupported_file_type",
      message: "Input does not declare the XLSX workbook content type.",
    });
  }

  if (isMacroEnabledWorkbook(entries)) {
    warnings.push({
      code: "macros_rejected",
      message:
        "Macro-enabled workbooks are rejected by the XLSX render policy.",
    });
  }

  if (hasExternalLinks(entries)) {
    warnings.push({
      code: "external_links",
      message: "Workbook contains external links.",
    });
  }

  return warnings;
}

function findPlaceholders(sheet: Worksheet): WorkbookPlaceholder[] {
  const placeholders: WorkbookPlaceholder[] = [];
  const mergedRanges = getMergedRangesByMasterCell(sheet);

  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.isMerged && cell.master.address !== cell.address) {
        return;
      }

      for (const match of cell.text.matchAll(PLACEHOLDER_PATTERN)) {
        const fieldPath = match[1];
        if (!fieldPath) {
          continue;
        }

        const targetRange = mergedRanges.get(cell.address);
        placeholders.push({
          sheet: sheet.name,
          cell: cell.address,
          ...(targetRange ? { targetRange } : {}),
          token: match[0],
          fieldPath,
        });
      }
    });
  });

  return placeholders;
}

function getMergedRangesByMasterCell(sheet: Worksheet): Map<string, string> {
  const ranges = new Map<string, string>();
  const merges = getObjectProperty(sheet, "_merges");

  if (!merges || typeof merges !== "object" || Array.isArray(merges)) {
    return ranges;
  }

  for (const [masterCell, range] of Object.entries(merges)) {
    const model = toRecord(getObjectProperty(range, "model"));

    if (
      typeof model.top !== "number" ||
      typeof model.left !== "number" ||
      typeof model.bottom !== "number" ||
      typeof model.right !== "number"
    ) {
      continue;
    }

    ranges.set(
      masterCell,
      `${columnNumberToName(model.left)}${model.top}:${columnNumberToName(
        model.right,
      )}${model.bottom}`,
    );
  }

  return ranges;
}

function columnNumberToName(value: number): string {
  let remaining = value;
  let name = "";

  while (remaining > 0) {
    const modulo = (remaining - 1) % 26;
    name = String.fromCharCode(65 + modulo) + name;
    remaining = Math.floor((remaining - modulo) / 26);
  }

  return name;
}

function replaceBoundPlaceholder(
  cellText: string,
  fieldPath: string,
  replacement: string,
): string {
  let matchedBindingToken = false;
  const nextText = cellText.replace(PLACEHOLDER_PATTERN, (token, path) => {
    if (path !== fieldPath) {
      return token;
    }

    matchedBindingToken = true;
    return replacement;
  });

  return matchedBindingToken
    ? nextText
    : cellText.replace(PLACEHOLDER_PATTERN, replacement);
}

function fillScalarCellsDirect(
  input: Uint8Array,
  bindings: ScalarCellBinding[],
  data: Record<string, unknown>,
  warnings: WorkbookWarning[],
): Uint8Array {
  if (bindings.length === 0) {
    return input;
  }

  const entries = readZip(input);
  const sheets = readWorkbookSheets(entries);
  const sharedStrings = readSharedStrings(entries);
  let changed = false;

  for (const binding of bindings) {
    const sheetPath = sheets.get(binding.sheet);

    if (!sheetPath) {
      warnings.push({
        code: "missing_sheet",
        message: `Sheet "${binding.sheet}" was not found.`,
        sheet: binding.sheet,
      });
      continue;
    }

    const sheetXml = readText(entries, sheetPath);
    if (!sheetXml) {
      warnings.push({
        code: "missing_sheet",
        message: `Sheet XML for "${binding.sheet}" was not found.`,
        sheet: binding.sheet,
      });
      continue;
    }

    const value = getPath(data, binding.fieldPath);
    if (value == null && binding.required) {
      warnings.push({
        code: "missing_required_field",
        message: `Required field "${binding.fieldPath}" is missing.`,
        sheet: binding.sheet,
        cell: binding.cell,
        fieldPath: binding.fieldPath,
      });
    }

    const result = patchCellText(
      sheetXml,
      binding.cell,
      binding.fieldPath,
      formatValue(value, binding.formatter),
      sharedStrings,
    );

    if (!result.replaced) {
      warnings.push({
        code: "unknown_field",
        message: `Cell "${binding.cell}" was not found in sheet "${binding.sheet}".`,
        sheet: binding.sheet,
        cell: binding.cell,
        fieldPath: binding.fieldPath,
      });
      continue;
    }

    writeText(entries, sheetPath, result.xml);
    changed = true;
  }

  return changed ? writeZip(entries) : input;
}

function readWorkbookSheets(
  entries: ReturnType<typeof readZip>,
): Map<string, string> {
  const workbook = readXml(entries, "xl/workbook.xml");
  const rels = readXml(entries, "xl/_rels/workbook.xml.rels");
  const sheets = new Map<string, string>();
  const targets = new Map<string, string>();

  if (!workbook || !rels) {
    return sheets;
  }

  for (const relationship of getElements(rels, "Relationship")) {
    const id = relationship.getAttribute("Id");
    const target = relationship.getAttribute("Target");
    if (id && target) {
      targets.set(id, normalizeWorkbookTarget(target));
    }
  }

  for (const sheet of getElements(workbook, "sheet")) {
    const name = sheet.getAttribute("name");
    const relationshipId = sheet.getAttribute("r:id");
    const target = relationshipId ? targets.get(relationshipId) : undefined;

    if (name && target) {
      sheets.set(name, target);
    }
  }

  return sheets;
}

function normalizeWorkbookTarget(target: string): string {
  const withoutLeadingSlash = target.replace(/^\/+/, "");
  return withoutLeadingSlash.startsWith("xl/")
    ? withoutLeadingSlash
    : `xl/${withoutLeadingSlash}`;
}

function findVolatileFormulaWarnings(input: Uint8Array): WorkbookWarning[] {
  const entries = readZip(input);
  const sheets = readWorkbookSheets(entries);
  const warnings: WorkbookWarning[] = [];

  for (const [sheet, sheetPath] of sheets) {
    const sheetXml = readText(entries, sheetPath);
    if (!sheetXml) {
      continue;
    }

    for (const match of sheetXml.matchAll(
      /<c\b(?=[^>]*\br="([^"]+)")[^>]*>[\s\S]*?<f\b[^>]*>([\s\S]*?)<\/f>[\s\S]*?<\/c>/g,
    )) {
      const cell = match[1];
      const formula = decodeXml(match[2] ?? "");
      const volatileFunction = formula.match(
        /(?:^|[^A-Z0-9_.])(@?_xlfn\.)?(NOW|TODAY|RAND|RANDBETWEEN|OFFSET|INDIRECT)\s*\(/i,
      )?.[2];

      if (!cell || !volatileFunction) {
        continue;
      }

      warnings.push({
        code: "volatile_formula",
        message: `Volatile formula "${volatileFunction.toUpperCase()}" found in ${sheet}!${cell}.`,
        sheet,
        cell,
      });
    }
  }

  return warnings;
}

function readSharedStrings(entries: ReturnType<typeof readZip>): string[] {
  const sharedStrings = readXml(entries, "xl/sharedStrings.xml");
  if (!sharedStrings) {
    return [];
  }

  return getElements(sharedStrings, "si").map((item) =>
    getElements(item, "t")
      .map((text) => text.textContent ?? "")
      .join(""),
  );
}

function patchCellText(
  sheetXml: string,
  cellAddress: string,
  fieldPath: string,
  replacement: string,
  sharedStrings: string[],
): { xml: string; replaced: boolean } {
  const cellPattern = new RegExp(
    `<c\\b(?=[^>]*\\br="${escapeRegExp(cellAddress)}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`,
  );
  const match = sheetXml.match(cellPattern);

  if (!match?.[0]) {
    return { xml: sheetXml, replaced: false };
  }

  const cellXml = match[0];
  const previousText = readCellText(cellXml, sharedStrings);
  const nextText = replaceBoundPlaceholder(
    previousText,
    fieldPath,
    replacement,
  );
  const patchedCell = writeInlineStringCell(cellXml, nextText);

  return {
    xml: sheetXml.replace(cellPattern, () => patchedCell),
    replaced: true,
  };
}

function readCellText(cellXml: string, sharedStrings: string[]): string {
  if (/\bt="s"/.test(cellXml)) {
    const index = Number.parseInt(
      cellXml.match(/<v>(.*?)<\/v>/)?.[1] ?? "",
      10,
    );
    return sharedStrings[index] ?? "";
  }

  const inlineText = Array.from(cellXml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g))
    .map(([, text]) => decodeXml(text ?? ""))
    .join("");
  if (inlineText) {
    return inlineText;
  }

  return decodeXml(cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
}

function writeInlineStringCell(cellXml: string, value: string): string {
  const openTag = cellXml.match(/^<c\b[^>]*(?:\/>|>)/)?.[0];
  if (!openTag) {
    return cellXml;
  }

  const normalizedOpenTag = /\bt=/.test(openTag)
    ? openTag.replace(/\bt="[^"]*"/, 't="inlineStr"').replace(/\/>$/, ">")
    : openTag.endsWith("/>")
      ? openTag.replace(/\/>$/, ' t="inlineStr">')
      : openTag.replace(/>$/, ' t="inlineStr">');

  return `${normalizedOpenTag}<is><t>${encodeXml(value)}</t></is></c>`;
}

function encodeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getUsedRange(sheet: Worksheet): string | undefined {
  if (sheet.actualRowCount === 0 || sheet.actualColumnCount === 0) {
    return undefined;
  }

  return sheet.dimensions.range;
}

function readNamedRanges(input: Uint8Array): {
  bySheet: Map<string, string[]>;
  unavailable: boolean;
} {
  const bySheet = new Map<string, string[]>();
  const entries = readZip(input);
  const workbookXml = readXml(entries, "xl/workbook.xml");

  if (!workbookXml) {
    return { bySheet, unavailable: true };
  }

  const sheets = getElements(workbookXml, "sheet").map((sheet, index) => ({
    index,
    name: sheet.getAttribute("name") ?? `Sheet${index + 1}`,
  }));

  for (const definedName of getElements(workbookXml, "definedName")) {
    const name = definedName.getAttribute("name");
    const localSheetId = definedName.getAttribute("localSheetId");
    const sheetName = localSheetId
      ? sheets[Number.parseInt(localSheetId, 10)]?.name
      : getSheetNameFromDefinedName(definedName.textContent ?? "");

    if (!name || name === "_xlnm.Print_Area" || !sheetName) {
      continue;
    }

    const existing = bySheet.get(sheetName) ?? [];
    existing.push(name);
    bySheet.set(sheetName, existing);
  }

  return { bySheet, unavailable: false };
}

function readPrintAreas(input: Uint8Array): Map<string, string> {
  const entries = readZip(input);
  const workbookXml = readXml(entries, "xl/workbook.xml");
  const printAreas = new Map<string, string>();

  if (!workbookXml) {
    return printAreas;
  }

  const sheets = getElements(workbookXml, "sheet").map((sheet, index) => ({
    index,
    name: sheet.getAttribute("name") ?? `Sheet${index + 1}`,
  }));

  for (const definedName of getElements(workbookXml, "definedName")) {
    if (definedName.getAttribute("name") !== "_xlnm.Print_Area") {
      continue;
    }

    const localSheetId = Number.parseInt(
      definedName.getAttribute("localSheetId") ?? "",
      10,
    );
    const sheetName =
      sheets[localSheetId]?.name ??
      getSheetNameFromDefinedName(definedName.textContent ?? "");

    if (sheetName) {
      printAreas.set(
        sheetName,
        normalizeDefinedRange(definedName.textContent ?? ""),
      );
    }
  }

  return printAreas;
}

function readVisibleSheetNames(input: Uint8Array): Set<string> {
  const entries = readZip(input);
  const workbookXml = readXml(entries, "xl/workbook.xml");
  const visible = new Set<string>();

  if (!workbookXml) {
    return visible;
  }

  for (const sheet of getElements(workbookXml, "sheet")) {
    const name = sheet.getAttribute("name");
    const state = sheet.getAttribute("state");

    if (name && state !== "hidden" && state !== "veryHidden") {
      visible.add(name);
    }
  }

  return visible;
}

function readWorksheetPageSetups(
  input: Uint8Array,
): Map<string, { fitToPage: boolean; fitToWidth?: number }> {
  const entries = readZip(input);
  const setups = new Map<string, { fitToPage: boolean; fitToWidth?: number }>();

  for (const [sheetName, sheetPath] of readWorkbookSheetPaths(entries)) {
    const sheetXml = readXml(entries, sheetPath);
    if (!sheetXml) {
      continue;
    }

    const pageSetUpPr = getElements(sheetXml, "pageSetUpPr")[0];
    const pageSetup = getElements(sheetXml, "pageSetup")[0];
    const fitToWidth = pageSetup?.getAttribute("fitToWidth");

    setups.set(sheetName, {
      fitToPage:
        pageSetUpPr?.getAttribute("fitToPage") === "1" ||
        pageSetUpPr?.getAttribute("fitToPage") === "true",
      fitToWidth:
        fitToWidth == null ? undefined : Number.parseInt(fitToWidth, 10),
    });
  }

  return setups;
}

function getSheetNameFromDefinedName(text: string): string | undefined {
  const match = /^'?(.*?)'?!/.exec(text);
  return match?.[1];
}

function normalizeDefinedRange(text: string): string {
  return text.replace(/\$'[^']+'!\$/g, "$").replace(/:\$\$/g, ":$");
}
