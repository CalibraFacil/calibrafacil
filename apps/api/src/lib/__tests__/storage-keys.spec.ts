import { describe, expect, it } from "vitest";
import {
  avatarKey,
  bucketFor,
  buildOrganizationLogoUrl,
  decodeLogoAssetKey,
  desktopCertificatePdfKey,
  encodeKeyPart,
  encodeLogoAssetKey,
  getLogoKeyFromUrl,
  getYear,
  getYearMonth,
  issuedCertificatePdfKey,
  jobLabelKey,
  memberSignatureKey,
  organizationLogoKey,
  orgPartition,
  safeR2Segment,
  serviceOrderDocKey,
  slugify,
  standardCertificateKey,
  syncAttachmentKey,
} from "@calibra-facil/shared/storage-keys";

const ORG = {
  id: "Kq3VvX9mZ2LdP8tN4rB7cY1wH6jF5sGe",
  slug: "acme-metrologia",
};
const PART = "acme-metrologia-Kq3VvX9mZ2LdP8tN4rB7cY1wH6jF5sGe";

describe("bucketFor", () => {
  it("routes regulated documents to the documents bucket", () => {
    for (const category of [
      "ISSUED_CERTIFICATE",
      "SERVICE_ORDER_DOC",
      "JOB_LABEL",
      "DESKTOP_CERTIFICATE",
      "STANDARD_DOC",
      "SYNC_ATTACHMENT",
    ] as const) {
      expect(bucketFor(category)).toBe("documents");
    }
  });

  it("routes branding/media to the media bucket", () => {
    for (const category of [
      "ORG_LOGO",
      "SIGNATURE",
      "AVATAR",
      "BRANDING_LOGO",
    ] as const) {
      expect(bucketFor(category)).toBe("media");
    }
  });
});

describe("slugify", () => {
  it("ascii-folds, lowercases and collapses separators", () => {
    expect(slugify("Açaí & Cia Ltda")).toBe("acai-cia-ltda");
    expect(slugify("Toledo do Brasil S/A")).toBe("toledo-do-brasil-s-a");
    expect(slugify("  Balança 01  ")).toBe("balanca-01");
  });

  it("caps length and trims a dash left by the cut", () => {
    expect(slugify("a".repeat(50), 40)).toBe("a".repeat(40));
    // "ab-ab-..." cut at an odd boundary must not leave a trailing dash
    expect(slugify("ab ".repeat(20), 5)).toBe("ab-ab");
  });

  it("returns empty string when nothing survives", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("safeR2Segment", () => {
  it("keeps safe chars and falls back to local", () => {
    expect(safeR2Segment("abc_1.2-3")).toBe("abc_1.2-3");
    expect(safeR2Segment("a b/c")).toBe("a-b-c");
    expect(safeR2Segment("???")).toBe("local");
  });
});

describe("encodeKeyPart", () => {
  it("encodes and throws on empty", () => {
    expect(encodeKeyPart("jobId", "CAL-2026-9001")).toBe("CAL-2026-9001");
    expect(encodeKeyPart("x", "a/b")).toBe("a%2Fb");
    expect(() => encodeKeyPart("orgId", "   ")).toThrow();
  });
});

describe("orgPartition", () => {
  it("prefixes the readable slug to the stable id", () => {
    expect(orgPartition(ORG)).toBe(PART);
  });

  it("falls back to the id alone when the slug is unusable", () => {
    expect(orgPartition({ id: ORG.id, slug: "!!!" })).toBe(ORG.id);
  });
});

describe("getYear / getYearMonth", () => {
  it("reads UTC year+month from Date and string forms", () => {
    expect(getYear(new Date("2026-05-31T12:00:00Z"), "x")).toBe(2026);
    expect(getYearMonth("2026-05-31T12:00:00Z", "x")).toEqual({
      year: 2026,
      month: "05",
    });
    // Postgres-style "YYYY-MM-DD HH:MM:SS" is normalized to ISO.
    expect(getYearMonth("2026-01-09 08:30:00", "x")).toEqual({
      year: 2026,
      month: "01",
    });
  });

  it("throws on missing/invalid input", () => {
    expect(() => getYear(null, "x")).toThrow();
    expect(() => getYearMonth("not-a-date", "x")).toThrow();
  });
});

describe("issued certificate keys", () => {
  const params = {
    org: ORG,
    jobId: "CAL-2026-9001",
    issuedId: "issued-123",
    certNumber: "CAL-2026-9001",
    year: 2026,
    companyName: "Açaí & Cia Ltda",
    assetTag: "BAL-01",
    brand: "Toledo",
  };

  it("builds a descriptive pdf key in the documents bucket", () => {
    expect(issuedCertificatePdfKey(params)).toEqual({
      bucket: "documents",
      key: `org/${PART}/2026/jobs/CAL-2026-9001/issued/issued-123/cal-2026-9001-2026-acai-cia-ltda-bal-01-toledo.pdf`,
    });
  });

  it("omits missing descriptive fields", () => {
    expect(
      issuedCertificatePdfKey({
        ...params,
        companyName: null,
        assetTag: null,
        brand: null,
      }).key,
    ).toBe(
      `org/${PART}/2026/jobs/CAL-2026-9001/issued/issued-123/cal-2026-9001-2026.pdf`,
    );
  });
});

describe("job label / desktop certificate keys", () => {
  it("builds a job label key", () => {
    expect(
      jobLabelKey({ org: ORG, jobId: "CAL-2026-9001", year: 2026 }),
    ).toEqual({
      bucket: "documents",
      key: `org/${PART}/2026/jobs/CAL-2026-9001/label.pdf`,
    });
  });

  it("builds a desktop certificate key", () => {
    expect(
      desktopCertificatePdfKey({
        org: ORG,
        jobId: "CAL-2026-9001",
        year: 2026,
        draftId: "draft-9",
      }).key,
    ).toBe(`org/${PART}/2026/jobs/CAL-2026-9001/desktop-draft-9.pdf`);
  });
});

describe("service order doc keys (month-partitioned)", () => {
  const base = {
    org: ORG,
    serviceOrderNumber: "SO-2026-001",
    year: 2026,
    month: "05",
  } as const;

  it("intake", () => {
    expect(serviceOrderDocKey({ ...base, type: "INTAKE", version: 1 })).toEqual(
      {
        bucket: "documents",
        key: `org/${PART}/2026/05/service-orders/SO-2026-001/intake-v1.pdf`,
      },
    );
  });

  it("delivery", () => {
    expect(
      serviceOrderDocKey({ ...base, type: "DELIVERY", version: 2 }).key,
    ).toBe(`org/${PART}/2026/05/service-orders/SO-2026-001/delivery-v2.pdf`);
  });

  it("tag", () => {
    expect(
      serviceOrderDocKey({ ...base, type: "TAG", tagNumber: "T-42" }).key,
    ).toBe(`org/${PART}/2026/05/service-orders/SO-2026-001/tag-T-42.pdf`);
  });

  it("quote", () => {
    expect(
      serviceOrderDocKey({
        ...base,
        type: "QUOTE",
        quoteNumber: "Q-7",
        version: 3,
      }).key,
    ).toBe(`org/${PART}/2026/05/service-orders/SO-2026-001/quotes/Q-7-v3.pdf`);
  });
});

describe("other documents-bucket keys", () => {
  it("standard certificate", () => {
    expect(
      standardCertificateKey({
        org: ORG,
        standardId: 5,
        documentId: 9,
        fileName: "certificado.pdf",
      }).key,
    ).toBe(`org/${PART}/standards/5/certificates/9-certificado.pdf`);
  });

  it("sync attachment stays compatible with the existing validator", () => {
    const { key } = syncAttachmentKey({
      org: ORG,
      entityType: "job",
      entityId: "abc 123",
      fileIdentity: "deadbeef-evt1",
      extension: ".pdf",
    });
    expect(key).toBe(
      `org/${PART}/sync-attachments/job/abc-123/deadbeef-evt1.pdf`,
    );
    expect(key.startsWith("org/")).toBe(true);
    expect(key.includes("/sync-attachments/")).toBe(true);
  });
});

describe("media-bucket keys", () => {
  it("organization logo", () => {
    expect(
      organizationLogoKey({
        org: ORG,
        timestamp: 1_700_000_000_000,
        uniqueId: "uuid-2",
      }),
    ).toEqual({
      bucket: "media",
      key: `organization-logos/${PART}/1700000000000-uuid-2`,
    });
  });

  it("member signature", () => {
    expect(memberSignatureKey({ org: ORG, memberId: "mem_1" })).toEqual({
      bucket: "media",
      key: `signatures/${PART}/mem_1.png`,
    });
  });

  it("avatar (no slug, reconstructable by user id)", () => {
    expect(avatarKey("user_1")).toEqual({
      bucket: "media",
      key: "avatars/user_1",
    });
  });
});

describe("organization logo proxy-url helpers", () => {
  const key = `organization-logos/${PART}/123-abc`;

  it("round-trips encode/decode", () => {
    expect(decodeLogoAssetKey(encodeLogoAssetKey(key))).toBe(key);
  });

  it("rejects a non-logo key", () => {
    expect(decodeLogoAssetKey(encodeLogoAssetKey("avatars/user_1"))).toBeNull();
  });

  it("builds and parses the proxy url", () => {
    const url = buildOrganizationLogoUrl(key, "https://api.example.com");
    expect(url).toBe(
      `https://api.example.com/api/organization-media/logo/${encodeLogoAssetKey(key)}`,
    );
    expect(getLogoKeyFromUrl(url)).toBe(key);
    expect(getLogoKeyFromUrl(null)).toBeNull();
    expect(getLogoKeyFromUrl("https://api.example.com/other")).toBeNull();
  });
});
