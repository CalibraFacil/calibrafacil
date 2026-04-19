import { describe, expect, it } from "vitest";
import {
  buildCertificateSequenceKey,
  getUnsupportedCertificateTokens,
  renderCertificateTemplate,
  validateCertificateNumberingConfig,
} from "../certificate-numbering";
import type { CertificateNumberingConfig } from "@calibra-facil/db/schema";

const baseConfig: CertificateNumberingConfig = {
  labCode: "LAB01",
  projectCode: null,
  numberTemplate: "{labCode}-{yyyy}-{seq}",
  certificateNameTemplate: "Certificado {number}",
  sequence: {
    resetScope: "year",
    startAt: 1,
    increment: 1,
    padding: 6,
  },
};

describe("certificate numbering helpers", () => {
  it("renders lab/year/sequence formats", () => {
    const rendered = renderCertificateTemplate("{labCode}-{yyyy}-{seq}", {
      labCode: "LAB01",
      yyyy: "2026",
      seq: "000123",
    });

    expect(rendered).toBe("LAB01-2026-000123");
  });

  it("renders slash-separated project formats", () => {
    const rendered = renderCertificateTemplate(
      "{labCode}/{projectCode}/{yyyy}/{seq}",
      {
        labCode: "CHEM",
        projectCode: "BR",
        yyyy: "2026",
        seq: "0456",
      },
    );

    expect(rendered).toBe("CHEM/BR/2026/0456");
  });

  it("renders month abbreviation formats", () => {
    const rendered = renderCertificateTemplate("{labCode}-{mon}-{yy}-{seq}", {
      labCode: "MICROBIO",
      mon: "APR",
      yy: "26",
      seq: "789",
    });

    expect(rendered).toBe("MICROBIO-APR-26-789");
  });

  it("builds reset keys by configured scope", () => {
    const generatedAt = new Date("2026-04-19T12:00:00.000Z");

    expect(
      buildCertificateSequenceKey(
        "never",
        { organizationId: "org", generatedAt },
        baseConfig,
      ),
    ).toBe("global");
    expect(
      buildCertificateSequenceKey(
        "year",
        { organizationId: "org", generatedAt },
        baseConfig,
      ),
    ).toBe("year:2026");
    expect(
      buildCertificateSequenceKey(
        "month",
        { organizationId: "org", generatedAt },
        baseConfig,
      ),
    ).toBe("month:2026-04");
    expect(
      buildCertificateSequenceKey(
        "project",
        { organizationId: "org", generatedAt, projectCode: "BR" },
        baseConfig,
      ),
    ).toBe("project:BR");
  });

  it("rejects unsupported tokens and templates without a sequence token", () => {
    expect(getUnsupportedCertificateTokens("{labCode}-{unknown}")).toEqual([
      "unknown",
    ]);

    expect(() =>
      validateCertificateNumberingConfig({
        ...baseConfig,
        numberTemplate: "{labCode}-{yyyy}",
      }),
    ).toThrow("deve conter o token {seq}");
  });
});
