import { describe, expect, it } from "vitest";

import {
  renderEccentricityIndicatorPng,
  resolveCertificateImageBindings,
  workbookImageFromDataUrl,
} from "./render.js";
import type { CertificateXlsxBindingManifest } from "./manifest.js";
import type { WorkbookImage } from "./types.js";

type ManifestImageBinding =
  CertificateXlsxBindingManifest["imageBindings"][number];

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

function imageBytes(image: WorkbookImage | undefined): Uint8Array {
  if (image === undefined) throw new Error("expected an image");
  return image instanceof Uint8Array ? image : image.bytes;
}

function expectPng(image: WorkbookImage | undefined) {
  const bytes = imageBytes(image);
  expect(Array.from(bytes.slice(0, 4))).toEqual(PNG_MAGIC);
}

function binding(
  imageKind: ManifestImageBinding["imageKind"],
  sourcePath: string,
): ManifestImageBinding {
  return {
    id: `binding-${imageKind}`,
    kind: "image",
    sheet: "Sheet1",
    targetRange: "A1:B2",
    imageKind,
    sourcePath,
  };
}

// A 1x1 transparent PNG.
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("workbookImageFromDataUrl", () => {
  it("decodes a base64 png data url", () => {
    const image = workbookImageFromDataUrl(PNG_DATA_URL);
    expect(image).not.toBeNull();
    if (!image || image instanceof Uint8Array) throw new Error("unexpected");
    expect(image.contentType).toBe("image/png");
    expectPng(image);
  });

  it("rasterizes svg data urls to png", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#ff0000"/></svg>`;
    const image = workbookImageFromDataUrl(
      `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    );
    expect(image).not.toBeNull();
    if (!image || image instanceof Uint8Array) throw new Error("unexpected");
    expect(image.contentType).toBe("image/png");
    expectPng(image);
  });

  it("rejects values that are not image data urls", () => {
    expect(workbookImageFromDataUrl("https://example.com/logo.png")).toBeNull();
    expect(workbookImageFromDataUrl("data:text/plain;base64,aGk=")).toBeNull();
  });
});

describe("renderEccentricityIndicatorPng", () => {
  it("renders the circular platform variant by default", () => {
    expectPng(renderEccentricityIndicatorPng(undefined, {}));
  });

  it("renders the road scale variant selected by the method data field", () => {
    const png = renderEccentricityIndicatorPng(
      {
        dataFields: [
          {
            key: "excentricidade",
            eccentricityIndicator: { enabled: true, variant: "road_scale" },
          },
        ],
        specifications: { eccentricityIndicatorPosition: "2" },
        data: null,
      },
      {},
    );
    expectPng(png);
  });
});

describe("resolveCertificateImageBindings", () => {
  it("builds QR codes, decodes data urls and renders the eccentricity indicator", async () => {
    const images = await resolveCertificateImageBindings(
      [
        binding("qr_code", "verificationUrl"),
        binding("organization_logo", "lab.logo"),
        binding("eccentricity_indicator", "graphics.eccentricityIndicator"),
      ],
      {
        verificationUrl: "https://calibrafacil.com/v/token-123",
        lab: { logo: PNG_DATA_URL },
      },
      undefined,
    );

    expectPng(images["verificationUrl"]);
    expectPng(images["lab.logo"]);
    expectPng(images["graphics.eccentricityIndicator"]);
    // Each image is also addressable by its binding id.
    expectPng(images["binding-qr_code"]);
  });

  it("omits bindings whose source value is missing", async () => {
    const images = await resolveCertificateImageBindings(
      [binding("signature", "approverSignatureUrl")],
      {},
      undefined,
    );

    expect(images).toEqual({});
  });
});
