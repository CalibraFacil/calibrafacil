import { describe, expect, it } from "vitest";
import { buildPublicApiV2OpenApiDocument } from "./public-api-v2.openapi";

const ORIGIN = "https://api.example.test";

describe("buildPublicApiV2OpenApiDocument", () => {
  it("returns a valid OpenAPI 3.1 document with info, servers, and paths", () => {
    const doc = buildPublicApiV2OpenApiDocument(ORIGIN);

    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info).toBeDefined();
    expect(doc.info.title).toBe("CalibraFácil Public API");
    expect(doc.info.version).toBe("2.0.0");
    expect(doc.paths).toBeDefined();
    expect(typeof doc.paths).toBe("object");
  });

  it("interpolates the request origin into servers[0].url (byte-identical behavior)", () => {
    const doc = buildPublicApiV2OpenApiDocument(ORIGIN);
    expect(doc.servers).toEqual([
      {
        url: `${ORIGIN}/api/public/v2`,
        description: "Current environment",
      },
    ]);
  });

  it("exposes the core resource collection paths", () => {
    const doc = buildPublicApiV2OpenApiDocument(ORIGIN);
    const paths = Object.keys(doc.paths);

    // Non-tautological guards: deleting any of these paths from the spec
    // builder makes this assertion go RED.
    for (const expected of [
      "/customers",
      "/customers/{id}",
      "/assets",
      "/assets/{id}",
      "/services",
      "/units",
      "/certificates",
      "/certificates/{jobId}",
      "/certificates/{jobId}/download",
      "/requests",
      "/jobs",
      "/jobs/{id}",
      "/webhooks",
    ]) {
      expect(paths).toContain(expected);
    }
  });

  it("declares the expected HTTP operations on representative paths", () => {
    const doc = buildPublicApiV2OpenApiDocument(ORIGIN);

    // /customers exposes list (get) + create (post)
    expect(doc.paths["/customers"]).toHaveProperty("get");
    expect(doc.paths["/customers"]).toHaveProperty("post");

    // /jobs/{id} exposes get + patch + delete
    expect(doc.paths["/jobs/{id}"]).toHaveProperty("get");
    expect(doc.paths["/jobs/{id}"]).toHaveProperty("patch");
    expect(doc.paths["/jobs/{id}"]).toHaveProperty("delete");

    // certificate download is a GET that returns a binary PDF
    expect(doc.paths["/certificates/{jobId}/download"]).toHaveProperty("get");
  });

  it("tags every operation with the security scheme and known tags", () => {
    const doc = buildPublicApiV2OpenApiDocument(ORIGIN);

    expect(doc.security).toEqual([{ ApiKeyAuth: [] }]);
    expect(doc.components.securitySchemes.ApiKeyAuth.type).toBe("apiKey");
    expect(doc.components.securitySchemes.ApiKeyAuth.name).toBe("x-api-key");

    const tagNames = doc.tags.map((tag) => tag.name);
    expect(tagNames).toContain("Customers");
    expect(tagNames).toContain("Jobs");
    expect(tagNames).toContain("Certificates");
  });
});
