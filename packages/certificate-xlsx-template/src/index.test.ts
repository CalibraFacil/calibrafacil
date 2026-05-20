import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Workbook } from "@cj-tech-master/excelts";
import QRCode from "qrcode";
import { describe, expect, it, vi } from "vitest";

import { GotenbergXlsxToPdfConverter } from "./conversion.js";
import { LocalLibreOfficeXlsxToPdfConverter } from "./conversion.js";
import {
  ExcelTsCertificateWorkbookEngine,
  normalizeWorkbookPrintSettings,
} from "./engine.js";
import {
  certificateXlsxBindingManifestSchema,
  getCertificateXlsxManifestFieldWarnings,
  hashCertificateXlsxBindingManifest,
} from "./manifest.js";
import {
  configureWorkbookPrintSettings,
  findWorkbookImageTargets,
  insertWorkbookPngImages,
  keepOnlyVisibleSheet,
  readZip,
  setWorksheetCellTexts,
  writeZip,
} from "./ooxml.js";
import type { CertificateXlsxBindingManifest } from "./manifest.js";

describe("ExcelTsCertificateWorkbookEngine", () => {
  it("analyzes a workbook and detects placeholders and named ranges", async () => {
    const input = await createWorkbookFixture();
    const engine = new ExcelTsCertificateWorkbookEngine();

    const analysis = await engine.analyze(input);

    expect(analysis.warnings).toEqual([]);
    expect(analysis.sheets).toHaveLength(1);
    expect(analysis.sheets[0]).toMatchObject({
      name: "Certificado",
      printArea: "'Certificado'!$A$1:$D$12",
      namedRanges: ["CF_CUSTOMER_NAME"],
    });
    expect(analysis.sheets[0]?.placeholders).toContainEqual({
      sheet: "Certificado",
      cell: "B2",
      token: "{{customer.name}}",
      fieldPath: "customer.name",
    });
  });

  it("rejects non-XLSX inputs without throwing", async () => {
    const engine = new ExcelTsCertificateWorkbookEngine();

    const analysis = await engine.analyze(new TextEncoder().encode("not xlsx"));

    expect(analysis.sheets).toEqual([]);
    expect(analysis.warnings).toContainEqual({
      code: "unsupported_file_type",
      message: "Input is not an XLSX workbook.",
    });
  });

  it("reports macro-enabled workbook containers", async () => {
    const input = await createWorkbookFixture();
    const entries = readZip(input);
    entries["xl/vbaProject.bin"] = Uint8Array.from([1, 2, 3]);
    const engine = new ExcelTsCertificateWorkbookEngine();

    const analysis = await engine.analyze(writeZip(entries));

    expect(analysis.warnings).toContainEqual(
      expect.objectContaining({ code: "macros_rejected" }),
    );
  });

  it("reports external workbook links", async () => {
    const input = await createWorkbookFixture();
    const entries = readZip(input);
    entries["xl/externalLinks/externalLink1.xml"] = new TextEncoder().encode(
      "<externalLink/>",
    );
    const engine = new ExcelTsCertificateWorkbookEngine();

    const analysis = await engine.analyze(writeZip(entries));

    expect(analysis.warnings).toContainEqual(
      expect.objectContaining({ code: "external_links" }),
    );
  });

  it("reports volatile formulas for reject-volatile render policies", async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet("Certificado");
    sheet.getCell("A1").value = { formula: "NOW()", result: 1 };
    const engine = new ExcelTsCertificateWorkbookEngine();

    const analysis = await engine.analyze(
      await workbook.xlsx.writeBuffer({ validate: false }),
    );

    expect(analysis.warnings).toContainEqual(
      expect.objectContaining({
        code: "volatile_formula",
        sheet: "Certificado",
        cell: "A1",
      }),
    );
  });

  it("replaces scalar placeholders and reports missing required fields", async () => {
    const input = await createWorkbookFixture();
    const engine = new ExcelTsCertificateWorkbookEngine();

    const result = await engine.fillScalarsWithWarnings(
      input,
      [
        {
          id: "customer",
          sheet: "Certificado",
          cell: "B2",
          fieldPath: "customer.name",
          required: true,
        },
        {
          id: "missing",
          sheet: "Certificado",
          cell: "B3",
          fieldPath: "asset.serialNumber",
          required: true,
        },
      ],
      { customer: { name: "EXEMPLO FOR" } },
    );

    const workbook = new Workbook();
    await workbook.xlsx.load(result.workbook);

    expect(workbook.getWorksheet("Certificado")?.getCell("B2").text).toBe(
      "Cliente: EXEMPLO FOR",
    );
    expect((await engine.analyze(result.workbook)).sheets[0]?.printArea).toBe(
      "'Certificado'!$A$1:$D$12",
    );
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: "missing_required_field",
        fieldPath: "asset.serialNumber",
      }),
    );
  });

  it("uses binding field paths even when the cell token text is stale", async () => {
    const input = setWorksheetCellTexts(
      await createWorkbookFixture(),
      "Certificado",
      {
        B2: "Cliente: {{legacy.customerName}}",
      },
    );
    const engine = new ExcelTsCertificateWorkbookEngine();

    const result = await engine.fillScalarsWithWarnings(
      input,
      [
        {
          id: "customer",
          sheet: "Certificado",
          cell: "B2",
          fieldPath: "customer.name",
        },
      ],
      { customer: { name: "Cliente atualizado" } },
    );

    const workbook = new Workbook();
    await workbook.xlsx.load(result.workbook);

    expect(workbook.getWorksheet("Certificado")?.getCell("B2").text).toBe(
      "Cliente: Cliente atualizado",
    );
  });

  it("replaces only the bound placeholder in cells with multiple scalar tokens", async () => {
    const input = setWorksheetCellTexts(
      await createWorkbookFixture(),
      "Certificado",
      {
        B2: "{{asset.serialNumber}} / {{asset.model}}",
      },
    );
    const engine = new ExcelTsCertificateWorkbookEngine();

    const result = await engine.fillScalarsWithWarnings(
      input,
      [
        {
          id: "serial",
          sheet: "Certificado",
          cell: "B2",
          fieldPath: "asset.serialNumber",
        },
        {
          id: "model",
          sheet: "Certificado",
          cell: "B2",
          fieldPath: "asset.model",
        },
      ],
      { asset: { serialNumber: "SN-001", model: "MK-2" } },
    );

    const workbook = new Workbook();
    await workbook.xlsx.load(result.workbook);

    expect(workbook.getWorksheet("Certificado")?.getCell("B2").text).toBe(
      "SN-001 / MK-2",
    );
  });

  it("fills a repeated table by duplicating the template row", async () => {
    const input = await createWorkbookFixture();
    const engine = new ExcelTsCertificateWorkbookEngine();

    const result = await engine.fillTableRows(
      input,
      {
        id: "results",
        kind: "table",
        arrayPath: "results",
        sheet: "Certificado",
        templateRange: "A8:D8",
        itemAlias: "result",
        overflowPolicy: "appendRows",
        columns: [
          { cell: "A8", path: "point" },
          { cell: "B8", path: "value", formatter: "number:2" },
        ],
      },
      {
        results: [
          { point: "1 kg", value: 1 },
          { point: "2 kg", value: 2.345 },
        ],
      },
    );

    const workbook = new Workbook();
    await workbook.xlsx.load(result.workbook);
    const sheet = workbook.getWorksheet("Certificado");

    expect(sheet?.getCell("A8").text).toBe("1 kg");
    expect(sheet?.getCell("B9").text).toBe("2.35");
  });

  it("can replace an existing placeholder image with a QR PNG while preserving media target", async () => {
    const input = await createWorkbookFixture();
    const engine = new ExcelTsCertificateWorkbookEngine();
    const beforeTarget = findWorkbookImageTargets(readZip(input))[0];

    expect(beforeTarget).toBe("xl/media/image1.png");

    const replacement = new Uint8Array(
      await QRCode.toBuffer("https://calibrafacil.example/c/CF-2026-0001", {
        type: "png",
        width: 180,
        margin: 1,
      }),
    );
    const output = await engine.replacePlaceholderImages(input, {
      image1: replacement,
    });
    const entries = readZip(output);

    expect(entries[beforeTarget!]).toEqual(replacement);
  });

  it("fits contain images inside the target range without stretching to its borders", async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet("Certificado");
    sheet.getCell("A1").value = "logo";

    const input = await workbook.xlsx.writeBuffer({ validate: false });
    const image = new Uint8Array(
      await QRCode.toBuffer("logo", {
        type: "png",
        width: 100,
        margin: 0,
      }),
    );
    const output = insertWorkbookPngImages(input, [
      {
        sheetName: "Certificado",
        targetRange: "A1:E3",
        image,
        name: "Logo",
        fit: "contain",
        insetRatio: 0.06,
      },
    ]);
    const entries = readZip(output);
    const drawingPath = Object.keys(entries).find((path) =>
      path.startsWith("xl/drawings/drawing"),
    );
    expect(drawingPath).toBeTruthy();

    const drawingXml = new TextDecoder().decode(entries[drawingPath!]);
    const markerMatch = drawingXml.match(
      /<xdr:from><xdr:col>(\d+)<\/xdr:col><xdr:colOff>(\d+)<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row><xdr:rowOff>(\d+)<\/xdr:rowOff><\/xdr:from><xdr:to><xdr:col>(\d+)<\/xdr:col><xdr:colOff>(\d+)<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row><xdr:rowOff>(\d+)<\/xdr:rowOff><\/xdr:to>/,
    );
    expect(markerMatch).toBeTruthy();

    const markerValues = markerMatch!.slice(1).map(Number) as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const [
      fromCol,
      fromColOff,
      fromRow,
      fromRowOff,
      toCol,
      toColOff,
      toRow,
      toRowOff,
    ] = markerValues;

    expect({ fromCol, fromRow, toCol, toRow }).not.toEqual({
      fromCol: 0,
      fromRow: 0,
      toCol: 5,
      toRow: 3,
    });
    expect(fromCol).toBeGreaterThan(0);
    expect(fromColOff).toBeGreaterThanOrEqual(0);
    expect(fromRow).toBe(0);
    expect(fromRowOff).toBeGreaterThan(0);
    expect(toCol).toBeLessThan(5);
    expect(toColOff).toBeGreaterThanOrEqual(0);
    expect(toRow).toBeLessThanOrEqual(3);
    expect(toRowOff).toBeGreaterThanOrEqual(0);
  });

  it("patches self-closing worksheet cells without consuming neighboring cells", async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet("Certificado");
    sheet.getCell("B1").border = { bottom: { style: "thin" } };
    sheet.getCell("C1").value = "after";

    const input = await workbook.xlsx.writeBuffer({ validate: false });
    const output = setWorksheetCellTexts(input, "Certificado", {
      B1: "{{customer.name}}",
    });

    const reloaded = new Workbook();
    await reloaded.xlsx.load(output);

    expect(reloaded.getWorksheet("Certificado")?.getCell("B1").text).toBe(
      "{{customer.name}}",
    );
    expect(reloaded.getWorksheet("Certificado")?.getCell("C1").text).toBe(
      "after",
    );
  });

  it("isolates the selected sheet and removes print areas from other sheets", async () => {
    const input = await createTwoSheetWorkbookFixture();
    const output = keepOnlyVisibleSheet(input, "FOR 51 - Certificado", {
      printArea: "A1:W100",
      fitToWidth: 1,
      fitToHeight: 2,
    });
    const entries = readZip(output);
    const workbookXml = new TextDecoder().decode(entries["xl/workbook.xml"]);
    const sheetXml = new TextDecoder().decode(
      entries["xl/worksheets/sheet1.xml"],
    );

    expect(workbookXml).toContain('name="FOR 51 - Certificado"');
    expect(workbookXml).toContain('name="FOR 50 - Formulario"');
    expect(workbookXml).toMatch(
      /<sheet\b(?=[^>]*name="FOR 50 - Formulario")(?=[^>]*state="hidden")/,
    );
    expect(workbookXml).not.toContain('activeTab="1"');
    expect(workbookXml).not.toContain("FOR 50 - Formulario'!$A$1:$D$12");
    expect(workbookXml).toContain("'FOR 51 - Certificado'!$A$1:$W$100");
    expect(sheetXml).toContain('fitToPage="1"');
    expect(sheetXml).toContain('fitToWidth="1"');
    expect(sheetXml).toContain('fitToHeight="2"');
  });

  it("matches escaped sheet names when isolating sheets", async () => {
    const workbook = new Workbook();
    workbook.addWorksheet("FOR 50 & 51").getCell("A1").value = "selected";
    workbook.addWorksheet("Auxiliar").getCell("A1").value = "hidden";

    const input = await workbook.xlsx.writeBuffer({ validate: false });
    const output = keepOnlyVisibleSheet(input, "FOR 50 & 51");
    const workbookXml = new TextDecoder().decode(
      readZip(output)["xl/workbook.xml"],
    );

    expect(workbookXml).toContain('name="FOR 50 &amp; 51"');
    expect(workbookXml).toMatch(
      /<sheet\b(?=[^>]*name="Auxiliar")(?=[^>]*state="hidden")/,
    );
  });

  it("accepts column and row print areas when configuring workbook settings", async () => {
    const workbook = new Workbook();
    workbook.addWorksheet("Certificado").getCell("A1").value = "print";

    const input = await workbook.xlsx.writeBuffer({ validate: false });
    const output = configureWorkbookPrintSettings(input, [
      { sheetName: "Certificado", printArea: "A:W" },
    ]);
    const columnAreaXml = new TextDecoder().decode(
      readZip(output)["xl/workbook.xml"],
    );

    expect(columnAreaXml).toContain("'Certificado'!$A:$W");

    const rowAreaOutput = configureWorkbookPrintSettings(input, [
      { sheetName: "Certificado", printArea: "1:50" },
    ]);
    const rowAreaXml = new TextDecoder().decode(
      readZip(rowAreaOutput)["xl/workbook.xml"],
    );

    expect(rowAreaXml).toContain("'Certificado'!$1:$50");
  });

  it("accepts multi-area print ranges when configuring workbook settings", async () => {
    const workbook = new Workbook();
    workbook.addWorksheet("Certificado").getCell("A1").value = "print";

    const input = await workbook.xlsx.writeBuffer({ validate: false });
    const output = configureWorkbookPrintSettings(input, [
      {
        sheetName: "Certificado",
        printArea: "'Certificado'!A1:B10,'Certificado'!D1:E10",
      },
    ]);
    const workbookXml = new TextDecoder().decode(
      readZip(output)["xl/workbook.xml"],
    );

    expect(workbookXml).toContain("'Certificado'!$A$1:$B$10,$D$1:$E$10");
  });

  it("normalizes visible worksheet print settings for upload analysis", async () => {
    const input = await createTwoSheetWorkbookFixture();
    const engine = new ExcelTsCertificateWorkbookEngine();

    expect((await engine.analyze(input)).warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_print_area",
          sheet: "FOR 51 - Certificado",
        }),
        expect.objectContaining({
          code: "missing_fit_to_width",
          sheet: "FOR 51 - Certificado",
        }),
        expect.objectContaining({
          code: "missing_fit_to_width",
          sheet: "FOR 50 - Formulario",
        }),
      ]),
    );

    const output = await normalizeWorkbookPrintSettings(input);
    const analysis = await engine.analyze(output);

    expect(analysis.warnings).toEqual([]);
    expect(analysis.sheets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "FOR 51 - Certificado",
          printArea: "'FOR 51 - Certificado'!$A$1:$A$1",
        }),
        expect.objectContaining({
          name: "FOR 50 - Formulario",
          printArea: "'FOR 50 - Formulario'!$A$1:$D$12",
        }),
      ]),
    );
  });
});

describe("certificate XLSX binding manifest", () => {
  it("validates strict manifests and hashes canonical JSON", () => {
    const manifest: CertificateXlsxBindingManifest = {
      schemaVersion: "calibrafacil.certificateXlsxBinding.v1",
      requiredFields: ["customer.name"],
      governedFields: ["customer.name"],
      scalarBindings: [
        {
          id: "customer",
          sheet: "Certificado",
          cell: "B2",
          fieldPath: "customer.name",
          required: true,
          governed: true,
        },
      ],
      imageBindings: [],
      tableBindings: [],
      renderPolicy: {
        formulas: "preserve",
        macros: "reject",
        externalLinks: "reject",
        converter: "gotenberg-libreoffice",
      },
    };

    expect(certificateXlsxBindingManifestSchema.parse(manifest)).toEqual(
      manifest,
    );
    expect(hashCertificateXlsxBindingManifest(manifest)).toHaveLength(64);
    expect(() =>
      certificateXlsxBindingManifestSchema.parse({
        ...manifest,
        unknown: true,
      }),
    ).toThrow();
  });

  it("reports unsupported and unsafe field paths", () => {
    const manifest: CertificateXlsxBindingManifest = {
      schemaVersion: "calibrafacil.certificateXlsxBinding.v1",
      requiredFields: ["customer.name", "billing.name"],
      governedFields: ["asset.__proto__.serial"],
      scalarBindings: [
        {
          id: "ok",
          sheet: "Certificado",
          cell: "B2",
          fieldPath: "customer.name",
        },
        {
          id: "bad",
          sheet: "Certificado",
          cell: "B3",
          fieldPath: "invoice.number",
        },
      ],
      imageBindings: [
        {
          id: "bad-image",
          kind: "image",
          imageKind: "signature",
          sheet: "Certificado",
          targetRange: "A1:B2",
          sourcePath: "approval.constructor.signature",
        },
      ],
      tableBindings: [],
      renderPolicy: {
        formulas: "preserve",
        macros: "reject",
        externalLinks: "reject",
        converter: "gotenberg-libreoffice",
      },
    };

    expect(getCertificateXlsxManifestFieldWarnings(manifest)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unknown_field_path",
          fieldPath: "billing.name",
        }),
        expect.objectContaining({
          code: "unknown_field_path",
          fieldPath: "asset.__proto__.serial",
        }),
        expect.objectContaining({
          code: "unknown_field_path",
          fieldPath: "invoice.number",
          cell: "B3",
        }),
        expect.objectContaining({
          code: "unknown_field_path",
          fieldPath: "approval.constructor.signature",
        }),
      ]),
    );
  });
});

describe("GotenbergXlsxToPdfConverter", () => {
  it("posts XLSX bytes to the LibreOffice conversion route and records metadata", async () => {
    const fetchMock = vi.fn(
      async () => new Response(new Uint8Array([37, 80, 68, 70])),
    );
    vi.stubGlobal("fetch", fetchMock);

    const converter = new GotenbergXlsxToPdfConverter("http://gotenberg.local");
    const result = await converter.convert(Uint8Array.from([1, 2, 3]), {
      fileName: "preview.xlsx",
      singlePageSheets: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://gotenberg.local/forms/libreoffice/convert",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.bytes).toEqual(Uint8Array.from([37, 80, 68, 70]));
    expect(result.metadata).toEqual({
      engine: "gotenberg-libreoffice",
      url: "http://gotenberg.local",
      options: {
        fileName: "preview.xlsx",
        singlePageSheets: true,
      },
    });

    vi.unstubAllGlobals();
  });
});

describe("LocalLibreOfficeXlsxToPdfConverter", () => {
  it("runs a local LibreOffice-compatible command and records metadata", async () => {
    const fakeSoffice = await writeFakeSoffice();
    const converter = new LocalLibreOfficeXlsxToPdfConverter(fakeSoffice);

    const result = await converter.convert(Uint8Array.from([1, 2, 3]), {
      fileName: "preview.xlsx",
    });

    expect(result.bytes).toEqual(Uint8Array.from([37, 80, 68, 70]));
    expect(result.metadata).toEqual({
      engine: "local-libreoffice",
      command: fakeSoffice,
      options: { fileName: "preview.xlsx" },
    });
  });

  it("fails early when no local LibreOffice command is available", () => {
    expect(() => new LocalLibreOfficeXlsxToPdfConverter("")).toThrow(
      /libreoffice/i,
    );
  });
});

async function createWorkbookFixture(): Promise<Uint8Array> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("Certificado");
  sheet.pageSetup.printArea = "'Certificado'!$A$1:$D$12";
  sheet.pageSetup.fitToPage = true;
  sheet.pageSetup.fitToWidth = 1;
  sheet.columns = [
    { key: "a", width: 10 },
    { key: "b", width: 25 },
    { key: "c", width: 10 },
    { key: "d", width: 10 },
  ];
  sheet.getCell("B2").value = "Cliente: {{customer.name}}";
  sheet.getCell("B2").addName("CF_CUSTOMER_NAME");
  sheet.getCell("B3").value = "Serie: {{asset.serialNumber}}";
  sheet.getCell("A8").value = "{{result.point}}";
  sheet.getCell("B8").value = "{{result.value}}";
  sheet.getCell("A8").border = { bottom: { style: "thin" } };
  sheet.getCell("B8").border = { bottom: { style: "thin" } };

  const imageId = workbook.addImage({
    buffer: placeholderPng(),
    extension: "png",
  });
  sheet.addImage(imageId, "C2:D4");

  return normalizeWorkbookPrintSettings(
    await workbook.xlsx.writeBuffer({ validate: false }),
  );
}

async function createTwoSheetWorkbookFixture(): Promise<Uint8Array> {
  const workbook = new Workbook();
  const certificate = workbook.addWorksheet("FOR 51 - Certificado");
  certificate.getCell("A1").value = "certificado";
  const form = workbook.addWorksheet("FOR 50 - Formulario");
  form.pageSetup.printArea = "'FOR 50 - Formulario'!$A$1:$D$12";
  form.getCell("A1").value = "formulario";

  return workbook.xlsx.writeBuffer({ validate: false });
}

function placeholderPng(): Uint8Array {
  return Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lWqX3QAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
}

async function writeFakeSoffice(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "fake-soffice-"));
  const script = join(directory, "soffice");
  await writeFile(
    script,
    `#!/usr/bin/env bash
set -euo pipefail
outdir=""
input=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --outdir)
      outdir="$2"
      shift 2
      ;;
    --*)
      shift
      ;;
    *)
      input="$1"
      shift
      ;;
  esac
done
base="$(basename "$input" .xlsx)"
printf '%s' '%PDF' > "$outdir/$base.pdf"
`,
  );
  await chmod(script, 0o755);
  return script;
}
