import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import QRCode from "qrcode";

import type {
  CertificateXlsxBindingManifest,
  ImageCellBinding,
  ScalarCellBinding,
  TableBinding,
} from "../src/index.js";

export const packageRoot = resolve(import.meta.dirname, "..");
export const fixtureRoot = resolve(packageRoot, "fixtures", "exemplo");
export const exemploSheetName = "FOR 51 - Certificado";
export const templatePath = resolve(fixtureRoot, "exemplo-template.xlsx");
export const sampleDataPath = resolve(fixtureRoot, "exemplo-sample-data.json");
export const manifestPath = resolve(fixtureRoot, "exemplo-binding-manifest.json");
export const tmpRoot = resolve(
  packageRoot,
  "..",
  "..",
  "tmp",
  "certificate-xlsx",
);

export async function ensureParent(path: string) {
  await mkdir(dirname(path), { recursive: true });
}

export async function readBytes(path: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path));
}

export async function writeBytes(path: string, bytes: Uint8Array) {
  await ensureParent(path);
  await writeFile(path, bytes);
}

export async function readSampleData(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(sampleDataPath, "utf8")) as Record<
    string,
    unknown
  >;
}

export async function readManifest(): Promise<CertificateXlsxBindingManifest> {
  return JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as CertificateXlsxBindingManifest;
}

export function scalarBindings(): ScalarCellBinding[] {
  return [
    {
      id: "customer_name",
      sheet: exemploSheetName,
      cell: "D10",
      fieldPath: "customer.name",
      required: true,
      governed: true,
    },
    {
      id: "customer_tax_id",
      sheet: exemploSheetName,
      cell: "P10",
      fieldPath: "customer.taxId",
      required: true,
      governed: true,
    },
    {
      id: "customer_address",
      sheet: exemploSheetName,
      cell: "D11",
      fieldPath: "customer.address",
      required: true,
      governed: true,
    },
    {
      id: "asset_serial_number",
      sheet: exemploSheetName,
      cell: "D16",
      fieldPath: "asset.serialNumber",
      required: true,
      governed: true,
    },
    {
      id: "asset_kind",
      sheet: exemploSheetName,
      cell: "D13",
      fieldPath: "asset.kind",
      governed: true,
    },
    {
      id: "asset_capacity",
      sheet: exemploSheetName,
      cell: "P13",
      fieldPath: "asset.capacity",
      governed: true,
    },
    {
      id: "asset_manufacturer",
      sheet: exemploSheetName,
      cell: "D14",
      fieldPath: "asset.manufacturer",
      governed: true,
    },
    {
      id: "asset_division",
      sheet: exemploSheetName,
      cell: "P14",
      fieldPath: "asset.division",
      governed: true,
    },
    {
      id: "asset_model",
      sheet: exemploSheetName,
      cell: "D15",
      fieldPath: "asset.model",
      governed: true,
    },
    {
      id: "asset_code",
      sheet: exemploSheetName,
      cell: "P15",
      fieldPath: "asset.code",
      governed: true,
    },
    {
      id: "asset_inmetro_registration",
      sheet: exemploSheetName,
      cell: "P16",
      fieldPath: "asset.inmetroRegistration",
      governed: true,
    },
    {
      id: "certificate_number",
      sheet: exemploSheetName,
      cell: "M3",
      fieldPath: "certificate.number",
      required: true,
      governed: true,
    },
    {
      id: "certificate_number_page_2",
      sheet: exemploSheetName,
      cell: "V48",
      fieldPath: "certificate.number",
      required: true,
      governed: true,
    },
    {
      id: "performed_at",
      sheet: exemploSheetName,
      cell: "E18",
      fieldPath: "job.performedAt",
      formatter: "date:dd/mm/yyyy",
      required: true,
      governed: true,
    },
    {
      id: "issued_at",
      sheet: exemploSheetName,
      cell: "Q18",
      fieldPath: "certificate.issuedAt",
      formatter: "date:dd/mm/yyyy",
      required: true,
      governed: true,
    },
    {
      id: "calibration_location",
      sheet: exemploSheetName,
      cell: "E20",
      fieldPath: "job.location",
      governed: true,
    },
    {
      id: "temperature",
      sheet: exemploSheetName,
      cell: "D22",
      fieldPath: "environment.temperature",
      governed: true,
    },
    {
      id: "relative_humidity",
      sheet: exemploSheetName,
      cell: "L22",
      fieldPath: "environment.relativeHumidity",
      governed: true,
    },
    {
      id: "pressure",
      sheet: exemploSheetName,
      cell: "T22",
      fieldPath: "environment.pressure",
      governed: true,
    },
    {
      id: "approved_by",
      sheet: exemploSheetName,
      cell: "H94",
      fieldPath: "approval.approvedBy.name",
      required: true,
      governed: true,
    },
  ];
}

export function imageBindings(): ImageCellBinding[] {
  return [
    {
      id: "qr_code",
      imageKind: "qr_code",
      sheet: exemploSheetName,
      targetRange: "S43:W47",
      sourcePath: "certificate.verificationUrl",
    },
    {
      id: "signature",
      imageKind: "signature",
      sheet: exemploSheetName,
      targetRange: "H93:O94",
      sourcePath: "approval.signaturePng",
    },
    {
      id: "organization_logo",
      imageKind: "organization_logo",
      sheet: exemploSheetName,
      targetRange: "A1:E3",
      sourcePath: "organization.logoPng",
    },
    {
      id: "accreditation_seal",
      imageKind: "accreditation_seal",
      sheet: exemploSheetName,
      targetRange: "A90:G94",
      sourcePath: "organization.accreditationSealPng",
    },
  ];
}

export function tableBinding(): TableBinding {
  return {
    id: "calibration_results",
    kind: "table",
    arrayPath: "results",
    sheet: exemploSheetName,
    templateRange: "B52:V52",
    itemAlias: "result",
    overflowPolicy: "appendRows",
    columns: [
      { cell: "B52", path: "point" },
      { cell: "F52", path: "reading1", formatter: "number:3" },
      { cell: "H52", path: "reading2", formatter: "number:3" },
      { cell: "J52", path: "reading3", formatter: "number:3" },
      { cell: "L52", path: "average", formatter: "number:3" },
      { cell: "O52", path: "error", formatter: "number:3" },
      { cell: "Q52", path: "uncertainty", formatter: "number:3" },
    ],
  };
}

export function sampleManifest(): CertificateXlsxBindingManifest {
  return {
    schemaVersion: "calibrafacil.certificateXlsxBinding.v1",
    requiredFields: [
      "customer.name",
      "customer.taxId",
      "customer.address",
      "asset.serialNumber",
      "certificate.number",
      "job.performedAt",
      "certificate.issuedAt",
      "approval.approvedBy.name",
    ],
    governedFields: [
      "customer.name",
      "customer.taxId",
      "customer.address",
      "asset.serialNumber",
      "certificate.number",
      "job.performedAt",
      "certificate.issuedAt",
      "approval.approvedBy.name",
    ],
    scalarBindings: scalarBindings(),
    imageBindings: imageBindings().map((binding) => ({
      ...binding,
      kind: "image",
      placeholderName: `CF_${binding.id.toUpperCase()}`,
    })),
    tableBindings: [],
    renderPolicy: {
      formulas: "preserve",
      macros: "reject",
      externalLinks: "reject",
      converter: "gotenberg-libreoffice",
    },
  };
}

export async function createQrPng(text: string): Promise<Uint8Array> {
  return new Uint8Array(
    await QRCode.toBuffer(text, {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 220,
    }),
  );
}

export function placeholderPng(): Uint8Array {
  return Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAYAAAAeP4ixAAAAfUlEQVRoge3XMQ6AIAwF0P7/0+1g4tBR1I4kJYObATNLXAK8z7sBhCEWCCYIE4QJwgRhgjBBmCBMECYIE4QJwgRhgjBBmCBMECYIE4QJwgRhgjBBmCBMECYIE4QJwgRhgjBBmCBMECYIE4QJwgRhgjBBmCBMECYIE4QJwgThC0aAAsD5G2v4AAAAAElFTkSuQmCC",
      "base64",
    ),
  );
}
