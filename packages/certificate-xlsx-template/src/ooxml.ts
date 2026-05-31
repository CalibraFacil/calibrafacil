import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { unzipSync, zipSync } from "fflate";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const EMUS_PER_PIXEL = 9525;
const DEFAULT_COLUMN_WIDTH_PIXELS = 64;
const DEFAULT_ROW_HEIGHT_PIXELS = 20;

export type ZipEntries = Record<string, Uint8Array>;

export type KeepOnlyVisibleSheetOptions = {
  printArea?: string;
  fitToWidth?: number;
  fitToHeight?: number;
};

export type WorkbookPrintSettings = {
  sheetName: string;
  printArea?: string;
  fitToWidth?: number;
  fitToHeight?: number;
};

export type WorkbookPngImageInsertion = {
  sheetName: string;
  targetRange: string;
  image: Uint8Array;
  contentType?: string;
  extension?: string;
  name?: string;
  fit?: "stretch" | "contain";
  insetRatio?: number;
};

export function readZip(input: Uint8Array): ZipEntries {
  try {
    return unzipSync(input);
  } catch (error) {
    throw new Error("Input is not a readable XLSX zip archive", {
      cause: error,
    });
  }
}

export function writeZip(entries: ZipEntries): Uint8Array {
  return zipSync(entries, { level: 6 });
}

export function readXml(
  entries: ZipEntries,
  path: string,
): Document | undefined {
  const entry = entries[path];
  if (!entry) {
    return undefined;
  }

  return new DOMParser().parseFromString(textDecoder.decode(entry), "text/xml");
}

export function writeXml(
  entries: ZipEntries,
  path: string,
  document: Document,
) {
  entries[path] = textEncoder.encode(
    new XMLSerializer().serializeToString(document),
  );
}

export function readText(
  entries: ZipEntries,
  path: string,
): string | undefined {
  const entry = entries[path];
  return entry ? textDecoder.decode(entry) : undefined;
}

export function writeText(entries: ZipEntries, path: string, text: string) {
  entries[path] = textEncoder.encode(text);
}

function decodeXmlAttributeValue(value: string): string {
  return value.replace(
    /&(#x[0-9a-fA-F]+|#\d+|quot|apos|amp|lt|gt);/g,
    (entity, code: string) => {
      if (code === "quot") return '"';
      if (code === "apos") return "'";
      if (code === "amp") return "&";
      if (code === "lt") return "<";
      if (code === "gt") return ">";
      if (code.startsWith("#x")) {
        const value = Number.parseInt(code.slice(2), 16);
        return Number.isFinite(value) ? String.fromCodePoint(value) : entity;
      }
      if (code.startsWith("#")) {
        const value = Number.parseInt(code.slice(1), 10);
        return Number.isFinite(value) ? String.fromCodePoint(value) : entity;
      }
      return entity;
    },
  );
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function isMacroEnabledWorkbook(entries: ZipEntries): boolean {
  const contentTypes = readText(entries, "[Content_Types].xml");
  return (
    contentTypes?.includes("application/vnd.ms-excel.sheet.macroEnabled") ===
      true || entries["xl/vbaProject.bin"] != null
  );
}

export function hasWorkbookContentType(entries: ZipEntries): boolean {
  const contentTypes = readText(entries, "[Content_Types].xml");
  return (
    contentTypes?.includes(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    ) === true
  );
}

export function hasExternalLinks(entries: ZipEntries): boolean {
  return Object.keys(entries).some((path) =>
    path.startsWith("xl/externalLinks/"),
  );
}

export function findWorkbookImageTargets(entries: ZipEntries): string[] {
  return Object.keys(entries)
    .filter((path) => path.startsWith("xl/media/"))
    .sort((a, b) => a.localeCompare(b));
}

export function replaceWorkbookImages(
  input: Uint8Array,
  replacements: Record<string, Uint8Array>,
): Uint8Array {
  const entries = readZip(input);

  for (const [target, bytes] of Object.entries(replacements)) {
    if (!entries[target]) {
      throw new Error(`Workbook image target not found: ${target}`);
    }

    entries[target] = bytes;
  }

  return writeZip(entries);
}

export function insertWorkbookPngImages(
  input: Uint8Array,
  insertions: WorkbookPngImageInsertion[],
): Uint8Array {
  if (insertions.length === 0) {
    return input;
  }

  const entries = readZip(input);
  const sheetPaths = readWorkbookSheetPaths(entries);
  let contentTypes = readText(entries, "[Content_Types].xml");

  if (!contentTypes) {
    throw new Error("Workbook content types were not found.");
  }

  for (const insertion of insertions) {
    const imageContentType = normalizeImageContentType(insertion.contentType);
    const imageExtension = normalizeImageExtension(
      insertion.extension,
      imageContentType,
    );
    contentTypes = ensureImageContentType(
      contentTypes,
      imageExtension,
      imageContentType,
    );

    const sheetPath = sheetPaths.get(insertion.sheetName);
    if (!sheetPath) {
      throw new Error(`Sheet "${insertion.sheetName}" was not found.`);
    }

    let sheetXml = readText(entries, sheetPath);
    if (!sheetXml) {
      throw new Error(`Sheet XML for "${insertion.sheetName}" was not found.`);
    }

    const imagePath = nextMediaPath(entries, imageExtension);
    entries[imagePath] = insertion.image;

    const drawing = ensureWorksheetDrawing(entries, sheetPath, sheetXml);
    sheetXml = drawing.sheetXml;
    contentTypes = ensureDrawingContentType(contentTypes, drawing.drawingPath);

    const drawingRelsPath = relsPathForPart(drawing.drawingPath);
    let drawingRelsXml = readText(entries, drawingRelsPath);
    if (!drawingRelsXml) {
      drawingRelsXml = createRelationshipsXml();
    }

    const imageRelId = nextRelationshipId(drawingRelsXml);
    drawingRelsXml = appendRelationship(
      drawingRelsXml,
      imageRelId,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
      relativeTarget(dirname(drawing.drawingPath), imagePath),
    );

    const drawingXml =
      readText(entries, drawing.drawingPath) ?? createDrawingXml();
    const pictureId = nextPictureId(drawingXml);
    const anchor = createTwoCellImageAnchor({
      range: insertion.targetRange,
      relationshipId: imageRelId,
      pictureId,
      name: insertion.name ?? `Image ${pictureId}`,
      sheetXml,
      image: insertion.image,
      fit: insertion.fit,
      insetRatio: insertion.insetRatio,
    });

    writeText(
      entries,
      drawing.drawingPath,
      drawingXml.replace("</xdr:wsDr>", `${anchor}</xdr:wsDr>`),
    );
    writeText(entries, drawingRelsPath, drawingRelsXml);
    writeText(entries, sheetPath, sheetXml);
  }

  writeText(entries, "[Content_Types].xml", contentTypes);
  return writeZip(entries);
}

export function preserveWorkbookDefinedNames(
  originalInput: Uint8Array,
  mutatedInput: Uint8Array,
  names: string[],
): Uint8Array {
  const originalEntries = readZip(originalInput);
  const mutatedEntries = readZip(mutatedInput);
  const originalWorkbook = readText(originalEntries, "xl/workbook.xml");
  const mutatedWorkbook = readText(mutatedEntries, "xl/workbook.xml");

  if (!originalWorkbook || !mutatedWorkbook) {
    return mutatedInput;
  }

  const preserved = names.flatMap((name) =>
    extractDefinedNameXml(originalWorkbook, name),
  );

  if (preserved.length === 0) {
    return mutatedInput;
  }

  let workbookXml = mutatedWorkbook;
  for (const name of names) {
    workbookXml = workbookXml.replace(definedNamePattern(name), "");
  }

  if (workbookXml.includes("<definedNames>")) {
    workbookXml = workbookXml.replace(
      "</definedNames>",
      () => `${preserved.join("")}</definedNames>`,
    );
  } else {
    workbookXml = workbookXml.replace(
      "</sheets>",
      () => `</sheets><definedNames>${preserved.join("")}</definedNames>`,
    );
  }

  mutatedEntries["xl/workbook.xml"] = textEncoder.encode(workbookXml);
  return writeZip(mutatedEntries);
}

function extractDefinedNameXml(workbookXml: string, name: string): string[] {
  return Array.from(workbookXml.matchAll(definedNamePattern(name))).map(
    ([definedName]) => definedName,
  );
}

function definedNamePattern(name: string): RegExp {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `<definedName\\b(?=[^>]*\\bname="${escapedName}")[^>]*>[\\s\\S]*?<\\/definedName>`,
    "g",
  );
}

export function getElements(
  element: Document | Element,
  qualifiedName: string,
): Element[] {
  return Array.from(element.getElementsByTagName(qualifiedName));
}

export function keepOnlyVisibleSheet(
  input: Uint8Array,
  sheetName: string,
  options: KeepOnlyVisibleSheetOptions = {},
): Uint8Array {
  const entries = readZip(input);
  const workbookXml = readText(entries, "xl/workbook.xml");

  if (!workbookXml) {
    throw new Error("Workbook XML was not found.");
  }

  const sheetMatches = Array.from(
    workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\/>/g),
  );
  const targetIndex = sheetMatches.findIndex(
    ([, name]) => decodeXmlAttributeValue(name ?? "") === sheetName,
  );

  if (targetIndex < 0) {
    throw new Error(`Sheet "${sheetName}" was not found in workbook.`);
  }

  const targetSheetXml = sheetMatches[targetIndex]?.[0];
  if (!targetSheetXml) {
    throw new Error(`Sheet "${sheetName}" has invalid workbook metadata.`);
  }

  let nextWorkbookXml = workbookXml
    .replace(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\/>/g, (sheetXml, name) => {
      if (decodeXmlAttributeValue(name) === sheetName) {
        return sheetXml.replace(/\sstate="[^"]*"/, "");
      }

      return /\sstate=/.test(sheetXml)
        ? sheetXml.replace(/\sstate="[^"]*"/, ' state="hidden"')
        : sheetXml.replace(/\/>$/, ' state="hidden"/>');
    })
    .replace(/<workbookView\b[^>]*\/>/g, (viewXml) =>
      /\bactiveTab=/.test(viewXml)
        ? viewXml.replace(/\bactiveTab="[^"]*"/, `activeTab="${targetIndex}"`)
        : viewXml.replace(/\/>$/, ` activeTab="${targetIndex}"/>`),
    );

  nextWorkbookXml = isolateDefinedNamesForSheet(
    nextWorkbookXml,
    targetIndex,
    sheetName,
    options.printArea,
  );

  if (
    options.printArea ||
    options.fitToWidth != null ||
    options.fitToHeight != null
  ) {
    const sheetPath = readWorkbookSheetPaths(entries).get(sheetName);
    if (sheetPath) {
      const sheetXml = readText(entries, sheetPath);
      if (sheetXml) {
        writeText(
          entries,
          sheetPath,
          configureWorksheetPageSetup(sheetXml, options),
        );
      }
    }
  }

  writeText(entries, "xl/workbook.xml", nextWorkbookXml);
  return writeZip(entries);
}

export function configureWorkbookPrintSettings(
  input: Uint8Array,
  settings: WorkbookPrintSettings[],
): Uint8Array {
  if (settings.length === 0) {
    return input;
  }

  const entries = readZip(input);
  let workbookXml = readText(entries, "xl/workbook.xml");

  if (!workbookXml) {
    throw new Error("Workbook XML was not found.");
  }

  const sheetMatches = Array.from(
    workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\/>/g),
  );
  const sheets = sheetMatches.map(([, name], index) => ({
    index,
    name: name ? decodeXmlAttributeValue(name) : `Sheet${index + 1}`,
  }));
  const settingsBySheet = new Map(
    settings.map((setting) => [setting.sheetName, setting]),
  );

  workbookXml = upsertWorkbookPrintAreas(workbookXml, sheets, settingsBySheet);

  const sheetPaths = readWorkbookSheetPaths(entries);
  for (const setting of settings) {
    if (setting.fitToWidth == null && setting.fitToHeight == null) {
      continue;
    }

    const sheetPath = sheetPaths.get(setting.sheetName);
    const sheetXml = sheetPath ? readText(entries, sheetPath) : undefined;
    if (!sheetPath || !sheetXml) {
      continue;
    }

    writeText(
      entries,
      sheetPath,
      configureWorksheetPageSetup(sheetXml, setting),
    );
  }

  writeText(entries, "xl/workbook.xml", workbookXml);
  return writeZip(entries);
}

function upsertWorkbookPrintAreas(
  workbookXml: string,
  sheets: Array<{ index: number; name: string }>,
  settingsBySheet: Map<string, WorkbookPrintSettings>,
): string {
  const printAreaSettings = sheets
    .map((sheet) => ({
      sheet,
      setting: settingsBySheet.get(sheet.name),
    }))
    .filter(
      (
        entry,
      ): entry is {
        sheet: { index: number; name: string };
        setting: WorkbookPrintSettings & { printArea: string };
      } => entry.setting?.printArea != null,
    );

  if (printAreaSettings.length === 0) {
    return workbookXml;
  }

  const keptDefinedNames = workbookXml.includes("<definedNames>")
    ? Array.from(
        workbookXml.matchAll(/<definedName\b[^>]*>[\s\S]*?<\/definedName>/g),
      )
        .map(([definedNameXml]) => definedNameXml)
        .filter(
          (definedNameXml) =>
            !isPrintAreaForConfiguredSheet(
              definedNameXml,
              sheets,
              settingsBySheet,
            ),
        )
    : [];

  for (const { sheet, setting } of printAreaSettings) {
    const escapedSheetName = escapeXmlText(sheet.name.replaceAll("'", "''"));
    keptDefinedNames.push(
      `<definedName name="_xlnm.Print_Area" localSheetId="${sheet.index}">'${escapedSheetName}'!${formatAbsoluteRange(setting.printArea)}</definedName>`,
    );
  }

  if (workbookXml.includes("<definedNames>")) {
    return workbookXml.replace(
      /<definedNames>[\s\S]*?<\/definedNames>/,
      () => `<definedNames>${keptDefinedNames.join("")}</definedNames>`,
    );
  }

  return workbookXml.replace(
    "</sheets>",
    () => `</sheets><definedNames>${keptDefinedNames.join("")}</definedNames>`,
  );
}

function isPrintAreaForConfiguredSheet(
  definedNameXml: string,
  sheets: Array<{ index: number; name: string }>,
  settingsBySheet: Map<string, WorkbookPrintSettings>,
): boolean {
  if (!/\bname="_xlnm\.Print_Area"/.test(definedNameXml)) {
    return false;
  }

  const localSheetId = definedNameXml.match(/\blocalSheetId="([^"]+)"/)?.[1];
  if (localSheetId != null) {
    const sheet = sheets[Number.parseInt(localSheetId, 10)];
    return sheet ? settingsBySheet.has(sheet.name) : false;
  }

  const sheetName = getSheetNameFromDefinedName(
    definedNameXml.replace(/<[^>]+>/g, ""),
  );
  return sheetName
    ? settingsBySheet.has(decodeXmlAttributeValue(sheetName))
    : false;
}

function isolateDefinedNamesForSheet(
  workbookXml: string,
  targetSheetIndex: number,
  sheetName: string,
  printArea?: string,
): string {
  const keptDefinedNames = workbookXml.includes("<definedNames>")
    ? Array.from(
        workbookXml.matchAll(/<definedName\b[^>]*>[\s\S]*?<\/definedName>/g),
      )
        .map(([definedNameXml]) => definedNameXml)
        .filter((definedNameXml) => {
          const localSheetId = definedNameXml.match(
            /\blocalSheetId="([^"]+)"/,
          )?.[1];
          return (
            localSheetId == null ||
            Number.parseInt(localSheetId, 10) === targetSheetIndex
          );
        })
        .map((definedNameXml) =>
          definedNameXml.replace(
            /\blocalSheetId="[^"]*"/,
            `localSheetId="${targetSheetIndex}"`,
          ),
        )
    : [];

  if (printArea) {
    const escapedSheetName = escapeXmlText(sheetName.replaceAll("'", "''"));
    keptDefinedNames.push(
      `<definedName name="_xlnm.Print_Area" localSheetId="${targetSheetIndex}">'${escapedSheetName}'!${formatAbsoluteRange(printArea)}</definedName>`,
    );
  }

  if (keptDefinedNames.length === 0) {
    return workbookXml.replace(/<definedNames>[\s\S]*?<\/definedNames>/, "");
  }

  if (workbookXml.includes("<definedNames>")) {
    return workbookXml.replace(
      /<definedNames>[\s\S]*?<\/definedNames>/,
      () => `<definedNames>${keptDefinedNames.join("")}</definedNames>`,
    );
  }

  return workbookXml.replace(
    "</sheets>",
    () => `</sheets><definedNames>${keptDefinedNames.join("")}</definedNames>`,
  );
}

function configureWorksheetPageSetup(
  sheetXml: string,
  options: KeepOnlyVisibleSheetOptions,
): string {
  let nextXml = sheetXml;

  if (options.fitToWidth != null || options.fitToHeight != null) {
    nextXml = ensureFitToPage(nextXml);
    nextXml = upsertPageSetupAttributes(nextXml, {
      fitToWidth: options.fitToWidth,
      fitToHeight: options.fitToHeight,
    });
  }

  return nextXml;
}

function ensureFitToPage(sheetXml: string): string {
  if (/<sheetPr\b[\s\S]*?<\/sheetPr>/.test(sheetXml)) {
    return sheetXml.replace(/<sheetPr\b[^>]*>[\s\S]*?<\/sheetPr>/, (sheetPr) =>
      sheetPr.includes("<pageSetUpPr")
        ? sheetPr.replace(/<pageSetUpPr\b[^>]*\/>/, (pageSetupPr) =>
            /\bfitToPage=/.test(pageSetupPr)
              ? pageSetupPr.replace(/\bfitToPage="[^"]*"/, 'fitToPage="1"')
              : pageSetupPr.replace(/\/>$/, ' fitToPage="1"/>'),
          )
        : sheetPr.replace(
            "</sheetPr>",
            '<pageSetUpPr fitToPage="1"/></sheetPr>',
          ),
    );
  }

  if (/<sheetPr\b[^>]*\/>/.test(sheetXml)) {
    return sheetXml.replace(
      /<sheetPr\b([^>]*)\/>/,
      (_sheetPr, attributes: string) =>
        `<sheetPr${attributes}><pageSetUpPr fitToPage="1"/></sheetPr>`,
    );
  }

  return sheetXml.replace(
    /<worksheet\b[^>]*>/,
    (worksheetTag) =>
      `${worksheetTag}<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`,
  );
}

function upsertPageSetupAttributes(
  sheetXml: string,
  attributes: { fitToWidth?: number; fitToHeight?: number },
): string {
  const applyAttributes = (pageSetup: string) => {
    let nextPageSetup = pageSetup;

    for (const [name, value] of Object.entries(attributes)) {
      if (value == null) {
        continue;
      }

      nextPageSetup = new RegExp(`\\b${name}=`).test(nextPageSetup)
        ? nextPageSetup.replace(
            new RegExp(`\\b${name}="[^"]*"`),
            `${name}="${value}"`,
          )
        : nextPageSetup.replace(/\/>$/, ` ${name}="${value}"/>`);
    }

    return nextPageSetup;
  };

  if (/<pageSetup\b[^>]*\/>/.test(sheetXml)) {
    return sheetXml.replace(/<pageSetup\b[^>]*\/>/, applyAttributes);
  }

  const pageSetup = applyAttributes("<pageSetup/>");
  if (sheetXml.includes("<pageMargins")) {
    return sheetXml.replace(/<pageMargins\b[^>]*\/>/, (pageMargins) => {
      return `${pageMargins}${pageSetup}`;
    });
  }

  return sheetXml.replace("</worksheet>", `${pageSetup}</worksheet>`);
}

function formatAbsoluteRange(range: string): string {
  return splitPrintAreaRanges(range)
    .map((area) =>
      stripPrintAreaSheetName(area)
        .replace(/\$/g, "")
        .split(":")
        .map((cell) => {
          const trimmed = cell.trim();
          const cellMatch = /^([A-Za-z]+)(\d+)$/.exec(trimmed);
          if (cellMatch) {
            return `$${cellMatch[1]?.toUpperCase()}$${cellMatch[2]}`;
          }

          const columnMatch = /^([A-Za-z]+)$/.exec(trimmed);
          if (columnMatch) {
            return `$${columnMatch[1]?.toUpperCase()}`;
          }

          const rowMatch = /^(\d+)$/.exec(trimmed);
          if (rowMatch) {
            return `$${rowMatch[1]}`;
          }

          throw new Error(`Unsupported print area cell: ${cell}`);
        })
        .join(":"),
    )
    .join(",");
}

function splitPrintAreaRanges(range: string): string[] {
  const ranges: string[] = [];
  let start = 0;
  let inQuotedSheetName = false;

  for (let index = 0; index < range.length; index += 1) {
    const char = range[index];
    if (char === "'") {
      if (inQuotedSheetName && range[index + 1] === "'") {
        index += 1;
        continue;
      }
      inQuotedSheetName = !inQuotedSheetName;
      continue;
    }

    if (char === "," && !inQuotedSheetName) {
      ranges.push(range.slice(start, index).trim());
      start = index + 1;
    }
  }

  ranges.push(range.slice(start).trim());
  return ranges.filter(Boolean);
}

function stripPrintAreaSheetName(range: string): string {
  return range
    .trim()
    .replace(/^'(?:[^']|'')+'!/, "")
    .replace(/^[^!]+!/, "")
    .replace(/\$/g, "")
    .trim();
}

export function setWorksheetCellTexts(
  input: Uint8Array,
  sheetName: string,
  cells: Record<string, string>,
): Uint8Array {
  const entries = readZip(input);
  const sheetPath = readWorkbookSheetPaths(entries).get(sheetName);

  if (!sheetPath) {
    throw new Error(`Sheet "${sheetName}" was not found in workbook.`);
  }

  let sheetXml = readText(entries, sheetPath);
  if (!sheetXml) {
    throw new Error(`Sheet XML for "${sheetName}" was not found.`);
  }

  for (const [cellAddress, value] of Object.entries(cells)) {
    sheetXml = setCellInlineString(sheetXml, cellAddress, value);
  }

  writeText(entries, sheetPath, sheetXml);
  return writeZip(entries);
}

export function readWorkbookSheetPaths(
  entries: ZipEntries,
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

function normalizeImageContentType(value: string | undefined): string {
  const contentType = value?.trim().toLowerCase();
  if (contentType === "image/jpg") return "image/jpeg";
  if (
    contentType === "image/png" ||
    contentType === "image/jpeg" ||
    contentType === "image/gif" ||
    contentType === "image/webp"
  ) {
    return contentType;
  }
  return "image/png";
}

function normalizeImageExtension(
  value: string | undefined,
  contentType: string,
): string {
  const extension = value?.trim().toLowerCase().replace(/^\./, "");
  if (extension && /^[a-z0-9]+$/.test(extension)) {
    return extension === "jpg" ? "jpeg" : extension;
  }
  if (contentType === "image/jpeg") return "jpeg";
  if (contentType === "image/gif") return "gif";
  if (contentType === "image/webp") return "webp";
  return "png";
}

function ensureImageContentType(
  contentTypes: string,
  extension: string,
  contentType: string,
): string {
  const escapedExtension = extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `<Default\\b(?=[^>]*\\bExtension="${escapedExtension}")`,
    "i",
  ).test(contentTypes)
    ? contentTypes
    : contentTypes.replace(
        "</Types>",
        `<Default Extension="${extension}" ContentType="${contentType}"/></Types>`,
      );
}

function ensureDrawingContentType(
  contentTypes: string,
  drawingPath: string,
): string {
  const partName = `/${drawingPath}`;
  const pattern = new RegExp(
    `<Override\\b(?=[^>]*\\bPartName="${escapeRegExp(partName)}")[^>]*/>`,
  );

  return pattern.test(contentTypes)
    ? contentTypes
    : contentTypes.replace(
        "</Types>",
        `<Override PartName="${partName}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`,
      );
}

function ensureWorksheetDrawing(
  entries: ZipEntries,
  sheetPath: string,
  sheetXml: string,
): { sheetXml: string; drawingPath: string } {
  const drawingRelationshipId = sheetXml.match(
    /<drawing\b[^>]*\br:id="([^"]+)"[^>]*\/>/,
  )?.[1];
  let sheetRelsXml = readText(entries, relsPathForPart(sheetPath));

  if (drawingRelationshipId && sheetRelsXml) {
    const target = relationshipTarget(sheetRelsXml, drawingRelationshipId);
    if (target) {
      return {
        sheetXml,
        drawingPath: resolvePackageTarget(dirname(sheetPath), target),
      };
    }
  }

  const drawingPath = nextDrawingPath(entries);
  const sheetRelId = nextRelationshipId(sheetRelsXml ?? "");
  sheetRelsXml = appendRelationship(
    sheetRelsXml ?? createRelationshipsXml(),
    sheetRelId,
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
    relativeTarget(dirname(sheetPath), drawingPath),
  );

  entries[drawingPath] = textEncoder.encode(createDrawingXml());
  writeText(entries, relsPathForPart(sheetPath), sheetRelsXml);

  return {
    sheetXml: insertWorksheetDrawingTag(sheetXml, sheetRelId),
    drawingPath,
  };
}

function insertWorksheetDrawingTag(sheetXml: string, relationshipId: string) {
  let nextXml = sheetXml;
  if (!/<worksheet\b[^>]*\bxmlns:r=/.test(nextXml)) {
    nextXml = nextXml.replace(/<worksheet\b[^>]*>/, (tag) =>
      tag.replace(
        />$/,
        ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      ),
    );
  }

  const drawingTag = `<drawing r:id="${encodeXml(relationshipId)}"/>`;
  if (nextXml.includes("<legacyDrawing")) {
    return nextXml.replace("<legacyDrawing", `${drawingTag}<legacyDrawing`);
  }

  return nextXml.replace("</worksheet>", `${drawingTag}</worksheet>`);
}

function createTwoCellImageAnchor({
  range,
  relationshipId,
  pictureId,
  name,
  sheetXml,
  image,
  fit,
  insetRatio,
}: {
  range: string;
  relationshipId: string;
  pictureId: number;
  name: string;
  sheetXml: string;
  image: Uint8Array;
  fit?: "stretch" | "contain";
  insetRatio?: number;
}) {
  const marker =
    fit === "contain"
      ? createContainedImageMarker(range, sheetXml, image, insetRatio)
      : parseCellRange(range);

  return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${marker.fromCol}</xdr:col><xdr:colOff>${marker.fromColOff}</xdr:colOff><xdr:row>${marker.fromRow}</xdr:row><xdr:rowOff>${marker.fromRowOff}</xdr:rowOff></xdr:from><xdr:to><xdr:col>${marker.toCol}</xdr:col><xdr:colOff>${marker.toColOff}</xdr:colOff><xdr:row>${marker.toRow}</xdr:row><xdr:rowOff>${marker.toRowOff}</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${pictureId}" name="${encodeXml(name)}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${encodeXml(relationshipId)}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`;
}

function parseCellRange(range: string): {
  fromCol: number;
  fromColOff: number;
  fromRow: number;
  fromRowOff: number;
  toCol: number;
  toColOff: number;
  toRow: number;
  toRowOff: number;
} {
  const [start, end = start] = range.replace(/\$/g, "").split(":");
  const from = parseCellReference(start ?? "");
  const to = parseCellReference(end ?? "");

  return {
    fromCol: from.col,
    fromColOff: 0,
    fromRow: from.row,
    fromRowOff: 0,
    toCol: to.col + 1,
    toColOff: 0,
    toRow: to.row + 1,
    toRowOff: 0,
  };
}

function createContainedImageMarker(
  range: string,
  sheetXml: string,
  image: Uint8Array,
  insetRatio = 0,
): ReturnType<typeof parseCellRange> {
  const fallback = parseCellRange(range);
  const imageDimensions = readImageDimensions(image);
  if (!imageDimensions) {
    return fallback;
  }

  const worksheetDimensions = parseWorksheetDimensions(sheetXml);
  const target = getRangePixelBounds(fallback, worksheetDimensions);
  const targetWidth = target.right - target.left;
  const targetHeight = target.bottom - target.top;
  if (targetWidth <= 0 || targetHeight <= 0) {
    return fallback;
  }

  const inset =
    Math.min(targetWidth, targetHeight) *
    Math.max(0, Math.min(0.4, insetRatio));
  const availableWidth = Math.max(1, targetWidth - inset * 2);
  const availableHeight = Math.max(1, targetHeight - inset * 2);
  const scale = Math.min(
    availableWidth / imageDimensions.width,
    availableHeight / imageDimensions.height,
  );
  const renderedWidth = imageDimensions.width * scale;
  const renderedHeight = imageDimensions.height * scale;
  const left = target.left + (targetWidth - renderedWidth) / 2;
  const top = target.top + (targetHeight - renderedHeight) / 2;
  const right = left + renderedWidth;
  const bottom = top + renderedHeight;
  const from = pixelToCellMarker(left, top, worksheetDimensions);
  const to = pixelToCellMarker(right, bottom, worksheetDimensions);

  return {
    fromCol: from.col,
    fromColOff: from.colOff,
    fromRow: from.row,
    fromRowOff: from.rowOff,
    toCol: to.col,
    toColOff: to.colOff,
    toRow: to.row,
    toRowOff: to.rowOff,
  };
}

function parseCellReference(cell: string): { col: number; row: number } {
  const match = /^([A-Za-z]+)(\d+)$/.exec(cell.trim());
  if (!match?.[1] || !match[2]) {
    throw new Error(`Unsupported image target cell: ${cell}`);
  }

  let col = 0;
  for (const char of match[1].toUpperCase()) {
    col = col * 26 + char.charCodeAt(0) - 64;
  }

  return {
    col: col - 1,
    row: Number.parseInt(match[2], 10) - 1,
  };
}

type WorksheetDimensions = {
  columns: Map<number, number>;
  rows: Map<number, number>;
  defaultColumnWidth: number;
  defaultRowHeight: number;
};

function parseWorksheetDimensions(sheetXml: string): WorksheetDimensions {
  const dimensions: WorksheetDimensions = {
    columns: new Map(),
    rows: new Map(),
    defaultColumnWidth: DEFAULT_COLUMN_WIDTH_PIXELS,
    defaultRowHeight: DEFAULT_ROW_HEIGHT_PIXELS,
  };
  const sheetFormatPr = /<sheetFormatPr\b([^>]*)\/?>/.exec(sheetXml)?.[1];
  const sheetFormatAttrs = sheetFormatPr
    ? parseXmlAttributes(sheetFormatPr)
    : {};
  const defaultColWidth = Number.parseFloat(
    sheetFormatAttrs.defaultColWidth ?? "",
  );
  const defaultRowHeight = Number.parseFloat(
    sheetFormatAttrs.defaultRowHeight ?? "",
  );
  if (Number.isFinite(defaultColWidth) && defaultColWidth > 0) {
    dimensions.defaultColumnWidth = excelColumnWidthToPixels(defaultColWidth);
  }
  if (Number.isFinite(defaultRowHeight) && defaultRowHeight > 0) {
    dimensions.defaultRowHeight = pointsToPixels(defaultRowHeight);
  }

  for (const match of sheetXml.matchAll(/<col\b([^>]*)\/?>/g)) {
    const attrs = parseXmlAttributes(match[1] ?? "");
    const min = Number.parseInt(attrs.min ?? "", 10);
    const max = Number.parseInt(attrs.max ?? "", 10);
    const width = Number.parseFloat(attrs.width ?? "");
    if (
      !Number.isInteger(min) ||
      !Number.isInteger(max) ||
      !Number.isFinite(width) ||
      width <= 0
    ) {
      continue;
    }

    const widthPixels = excelColumnWidthToPixels(width);
    for (let col = min - 1; col <= max - 1; col += 1) {
      dimensions.columns.set(col, widthPixels);
    }
  }

  for (const match of sheetXml.matchAll(/<row\b([^>]*)>/g)) {
    const attrs = parseXmlAttributes(match[1] ?? "");
    const row = Number.parseInt(attrs.r ?? "", 10);
    const height = Number.parseFloat(attrs.ht ?? "");
    if (!Number.isInteger(row) || !Number.isFinite(height) || height <= 0) {
      continue;
    }

    dimensions.rows.set(row - 1, pointsToPixels(height));
  }

  return dimensions;
}

function parseXmlAttributes(attributes: string): Record<string, string> {
  return Object.fromEntries(
    Array.from(attributes.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)).map(
      (match) => [match[1] ?? "", match[2] ?? ""],
    ),
  );
}

function excelColumnWidthToPixels(width: number): number {
  return Math.max(1, Math.floor(width * 7 + 5));
}

function pointsToPixels(points: number): number {
  return Math.max(1, (points * 96) / 72);
}

function getColumnWidth(col: number, dimensions: WorksheetDimensions): number {
  return dimensions.columns.get(col) ?? dimensions.defaultColumnWidth;
}

function getRowHeight(row: number, dimensions: WorksheetDimensions): number {
  return dimensions.rows.get(row) ?? dimensions.defaultRowHeight;
}

function getRangePixelBounds(
  marker: ReturnType<typeof parseCellRange>,
  dimensions: WorksheetDimensions,
): { left: number; top: number; right: number; bottom: number } {
  return {
    left: sumColumnsBefore(marker.fromCol, dimensions),
    top: sumRowsBefore(marker.fromRow, dimensions),
    right: sumColumnsBefore(marker.toCol, dimensions),
    bottom: sumRowsBefore(marker.toRow, dimensions),
  };
}

function sumColumnsBefore(
  column: number,
  dimensions: WorksheetDimensions,
): number {
  let total = 0;
  for (let col = 0; col < column; col += 1) {
    total += getColumnWidth(col, dimensions);
  }
  return total;
}

function sumRowsBefore(row: number, dimensions: WorksheetDimensions): number {
  let total = 0;
  for (let currentRow = 0; currentRow < row; currentRow += 1) {
    total += getRowHeight(currentRow, dimensions);
  }
  return total;
}

function pixelToCellMarker(
  x: number,
  y: number,
  dimensions: WorksheetDimensions,
): { col: number; colOff: number; row: number; rowOff: number } {
  const column = pixelToColumnMarker(x, dimensions);
  const row = pixelToRowMarker(y, dimensions);
  return {
    col: column.index,
    colOff: pixelsToEmus(column.offset),
    row: row.index,
    rowOff: pixelsToEmus(row.offset),
  };
}

function pixelToColumnMarker(
  x: number,
  dimensions: WorksheetDimensions,
): { index: number; offset: number } {
  let remaining = Math.max(0, x);
  let index = 0;

  while (remaining >= getColumnWidth(index, dimensions)) {
    remaining -= getColumnWidth(index, dimensions);
    index += 1;
  }

  return { index, offset: remaining };
}

function pixelToRowMarker(
  y: number,
  dimensions: WorksheetDimensions,
): { index: number; offset: number } {
  let remaining = Math.max(0, y);
  let index = 0;

  while (remaining >= getRowHeight(index, dimensions)) {
    remaining -= getRowHeight(index, dimensions);
    index += 1;
  }

  return { index, offset: remaining };
}

function pixelsToEmus(value: number): number {
  return Math.max(0, Math.round(value * EMUS_PER_PIXEL));
}

function readImageDimensions(
  image: Uint8Array,
): { width: number; height: number } | null {
  return (
    readPngDimensions(image) ??
    readJpegDimensions(image) ??
    readWebpDimensions(image)
  );
}

function readPngDimensions(
  image: Uint8Array,
): { width: number; height: number } | null {
  if (
    image.length < 24 ||
    image[0] !== 0x89 ||
    image[1] !== 0x50 ||
    image[2] !== 0x4e ||
    image[3] !== 0x47 ||
    image[4] !== 0x0d ||
    image[5] !== 0x0a ||
    image[6] !== 0x1a ||
    image[7] !== 0x0a
  ) {
    return null;
  }

  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function readJpegDimensions(
  image: Uint8Array,
): { width: number; height: number } | null {
  if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 9 < image.length) {
    if (image[offset] !== 0xff) {
      return null;
    }
    const marker = image[offset + 1];
    const length = ((image[offset + 2] ?? 0) << 8) + (image[offset + 3] ?? 0);
    if (length < 2) {
      return null;
    }
    if (
      marker != null &&
      ((marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf))
    ) {
      const height = ((image[offset + 5] ?? 0) << 8) + (image[offset + 6] ?? 0);
      const width = ((image[offset + 7] ?? 0) << 8) + (image[offset + 8] ?? 0);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + length;
  }

  return null;
}

function readWebpDimensions(
  image: Uint8Array,
): { width: number; height: number } | null {
  if (
    image.length < 30 ||
    String.fromCharCode(...image.slice(0, 4)) !== "RIFF" ||
    String.fromCharCode(...image.slice(8, 12)) !== "WEBP"
  ) {
    return null;
  }

  const chunk = String.fromCharCode(...image.slice(12, 16));
  if (chunk === "VP8X") {
    const width =
      1 +
      ((image[24] ?? 0) | ((image[25] ?? 0) << 8) | ((image[26] ?? 0) << 16));
    const height =
      1 +
      ((image[27] ?? 0) | ((image[28] ?? 0) << 8) | ((image[29] ?? 0) << 16));
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (chunk === "VP8L" && image[20] === 0x2f) {
    const b1 = image[21] ?? 0;
    const b2 = image[22] ?? 0;
    const b3 = image[23] ?? 0;
    const b4 = image[24] ?? 0;
    const width = 1 + (((b2 & 0x3f) << 8) | b1);
    const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (
    chunk === "VP8 " &&
    image[23] === 0x9d &&
    image[24] === 0x01 &&
    image[25] === 0x2a
  ) {
    const width = ((image[27] ?? 0) << 8) | (image[26] ?? 0);
    const height = ((image[29] ?? 0) << 8) | (image[28] ?? 0);
    return { width: width & 0x3fff, height: height & 0x3fff };
  }

  return null;
}

function createDrawingXml(): string {
  return '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"></xdr:wsDr>';
}

function createRelationshipsXml(): string {
  return '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
}

function appendRelationship(
  relsXml: string,
  id: string,
  type: string,
  target: string,
): string {
  return relsXml.replace(
    "</Relationships>",
    `<Relationship Id="${encodeXml(id)}" Type="${encodeXml(type)}" Target="${encodeXml(target)}"/></Relationships>`,
  );
}

function relationshipTarget(relsXml: string, id: string): string | undefined {
  const pattern = new RegExp(
    `<Relationship\\b(?=[^>]*\\bId="${escapeRegExp(id)}")[^>]*/>`,
  );
  const relationship = relsXml.match(pattern)?.[0];
  return relationship?.match(/\bTarget="([^"]+)"/)?.[1];
}

function nextRelationshipId(relsXml: string): string {
  const used = Array.from(relsXml.matchAll(/\bId="rId(\d+)"/g)).map((match) =>
    Number.parseInt(match[1] ?? "0", 10),
  );
  return `rId${Math.max(0, ...used) + 1}`;
}

function nextPictureId(drawingXml: string): number {
  const used = Array.from(drawingXml.matchAll(/\bcNvPr\b[^>]*\bid="(\d+)"/g))
    .map((match) => Number.parseInt(match[1] ?? "0", 10))
    .filter(Number.isFinite);
  return Math.max(0, ...used) + 1;
}

function nextMediaPath(entries: ZipEntries, extension = "png"): string {
  const used = Object.keys(entries)
    .map((path) => path.match(/^xl\/media\/image(\d+)\.[^.]+$/)?.[1])
    .filter((value): value is string => value != null)
    .map((value) => Number.parseInt(value, 10));

  return `xl/media/image${Math.max(0, ...used) + 1}.${extension}`;
}

function nextDrawingPath(entries: ZipEntries): string {
  const used = Object.keys(entries)
    .map((path) => path.match(/^xl\/drawings\/drawing(\d+)\.xml$/)?.[1])
    .filter((value): value is string => value != null)
    .map((value) => Number.parseInt(value, 10));

  return `xl/drawings/drawing${Math.max(0, ...used) + 1}.xml`;
}

function relsPathForPart(partPath: string): string {
  const directory = dirname(partPath);
  const fileName = partPath.slice(directory.length + 1);
  return `${directory}/_rels/${fileName}.rels`;
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index) : "";
}

function relativeTarget(fromDirectory: string, targetPath: string): string {
  const from = fromDirectory.split("/").filter(Boolean);
  const target = targetPath.split("/").filter(Boolean);

  while (from.length > 0 && target.length > 0 && from[0] === target[0]) {
    from.shift();
    target.shift();
  }

  return [...from.map(() => ".."), ...target].join("/");
}

function resolvePackageTarget(fromDirectory: string, target: string): string {
  if (target.startsWith("/")) {
    return target.replace(/^\/+/, "");
  }

  const parts = [...fromDirectory.split("/"), ...target.split("/")].filter(
    Boolean,
  );
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }

  return normalized.join("/");
}

function getSheetNameFromDefinedName(text: string): string | undefined {
  const match = /^'?(.*?)'?!/.exec(text);
  return match?.[1];
}

function setCellInlineString(
  sheetXml: string,
  cellAddress: string,
  value: string,
): string {
  const cellPattern = new RegExp(
    `<c\\b(?=[^>]*\\br="${escapeRegExp(cellAddress)}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`,
  );
  const match = sheetXml.match(cellPattern);

  if (!match?.[0]) {
    throw new Error(`Cell "${cellAddress}" was not found in worksheet XML.`);
  }

  const openTag = match[0].match(/^<c\b[^>]*(?:\/>|>)/)?.[0];
  if (!openTag) {
    throw new Error(`Cell "${cellAddress}" has invalid XML.`);
  }

  const normalizedOpenTag = /\bt=/.test(openTag)
    ? openTag.replace(/\bt="[^"]*"/, 't="inlineStr"').replace(/\/>$/, ">")
    : openTag.endsWith("/>")
      ? openTag.replace(/\/>$/, ' t="inlineStr">')
      : openTag.replace(/>$/, ' t="inlineStr">');
  const nextCellXml = `${normalizedOpenTag}<is><t>${encodeXml(value)}</t></is></c>`;

  return sheetXml.replace(cellPattern, () => nextCellXml);
}

function encodeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
