import { describe, expect, it } from "vitest";
import {
  DEFAULT_CERTIFICATE_NUMBERING_CONFIG,
  buildCertificateSequenceKey,
  getUnsupportedCertificateTokens,
  renderCertificateTemplate,
  validateCertificateNumberingConfig,
} from "../certificate-numbering";
import type { CertificateNumberingConfig } from "@calibra-facil/db/schema";

// Shared base config used across multiple test groups
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

// REQ-CERTNUM-006 / REQ-CERTNUM-007: use Date.UTC to be TZ-agnostic
// Run with TZ=UTC so local getFullYear/getMonth match UTC
const JUNE_2026 = new Date(Date.UTC(2026, 5, 15)); // month index 5 = June

// ─── REQ-CERTNUM-001 ──────────────────────────────────────────────────────────

describe("REQ-CERTNUM-001: getUnsupportedCertificateTokens", () => {
  it("REQ-CERTNUM-001 returns [] when all tokens are supported", () => {
    // Every token in the supported set should produce no unsupported result
    const allSupportedTemplate =
      "{number}-{labCode}-{labName}-{labSlug}-{projectCode}-{yyyy}-{yy}-{mm}-{mon}-{dd}-{seq}";
    expect(getUnsupportedCertificateTokens(allSupportedTemplate)).toEqual([]);
  });

  it("REQ-CERTNUM-001 returns the unsupported token name for a single unknown token", () => {
    expect(getUnsupportedCertificateTokens("{labCode}-{unknown}")).toEqual([
      "unknown",
    ]);
  });

  it("REQ-CERTNUM-001 returns distinct unsupported token names (no duplicates)", () => {
    // {foo} appears twice, {bar} once — result must be distinct
    const result = getUnsupportedCertificateTokens("{foo}/{foo}/{bar}");
    expect(result).toContain("foo");
    expect(result).toContain("bar");
    expect(result).toHaveLength(2);
  });

  it("REQ-CERTNUM-001 ignores braces around non-matching patterns (numeric starters, etc.)", () => {
    // {1abc} does not match /\{([a-zA-Z][a-zA-Z0-9]*)\}/ — should not appear
    expect(getUnsupportedCertificateTokens("{1abc}")).toEqual([]);
  });

  it("REQ-CERTNUM-001 template with no braces returns []", () => {
    expect(getUnsupportedCertificateTokens("CAL-2026-0001")).toEqual([]);
  });
});

// ─── REQ-CERTNUM-002 ──────────────────────────────────────────────────────────

describe("REQ-CERTNUM-002: validateCertificateNumberingConfig — happy path", () => {
  it("REQ-CERTNUM-002 returns the config object unchanged when templates are valid and {seq} is present", () => {
    const result = validateCertificateNumberingConfig(baseConfig);
    // Must return the same reference (strict identity) or at least the same value
    expect(result).toEqual(baseConfig);
    expect(result).toBe(baseConfig);
  });

  it("REQ-CERTNUM-002 accepts all supported tokens in nameTemplate without throwing", () => {
    const config: CertificateNumberingConfig = {
      ...baseConfig,
      certificateNameTemplate:
        "{number}-{labCode}-{labName}-{labSlug}-{projectCode}-{yyyy}-{yy}-{mm}-{mon}-{dd}-{seq}",
    };
    expect(() => validateCertificateNumberingConfig(config)).not.toThrow();
  });
});

// ─── REQ-CERTNUM-003 ──────────────────────────────────────────────────────────

describe("REQ-CERTNUM-003: validateCertificateNumberingConfig — unsupported tokens", () => {
  it("REQ-CERTNUM-003 throws naming the unsupported token when numberTemplate has unknown token", () => {
    expect(() =>
      validateCertificateNumberingConfig({
        ...baseConfig,
        numberTemplate: "{labCode}-{badToken}-{seq}",
      }),
    ).toThrow("Tokens nao suportados");
  });

  it("REQ-CERTNUM-003 thrown message contains the unsupported token name", () => {
    expect(() =>
      validateCertificateNumberingConfig({
        ...baseConfig,
        numberTemplate: "{labCode}-{badToken}-{seq}",
      }),
    ).toThrow("badToken");
  });

  it("REQ-CERTNUM-003 throws when certificateNameTemplate has an unsupported token", () => {
    expect(() =>
      validateCertificateNumberingConfig({
        ...baseConfig,
        certificateNameTemplate: "Certificado {number} {invalidField}",
      }),
    ).toThrow("Tokens nao suportados");
  });

  it("REQ-CERTNUM-003 thrown message names multiple unsupported tokens (deduped)", () => {
    // Both {foo} and {bar} are unsupported; message must name them
    let caughtMessage = "";
    try {
      validateCertificateNumberingConfig({
        ...baseConfig,
        numberTemplate: "{seq}-{foo}-{bar}",
      });
    } catch (e) {
      if (e instanceof Error) caughtMessage = e.message;
    }
    expect(caughtMessage).toMatch(/foo/);
    expect(caughtMessage).toMatch(/bar/);
    expect(caughtMessage).toMatch(/^Tokens nao suportados/);
  });
});

// ─── REQ-CERTNUM-004 ──────────────────────────────────────────────────────────

describe("REQ-CERTNUM-004: validateCertificateNumberingConfig — missing {seq}", () => {
  it("REQ-CERTNUM-004 throws the exact message when numberTemplate omits {seq}", () => {
    expect(() =>
      validateCertificateNumberingConfig({
        ...baseConfig,
        numberTemplate: "{labCode}-{yyyy}",
      }),
    ).toThrow("Formato do numero deve conter o token {seq}");
  });

  it("REQ-CERTNUM-004 does not throw when numberTemplate only contains {seq} (minimal valid)", () => {
    expect(() =>
      validateCertificateNumberingConfig({
        ...baseConfig,
        numberTemplate: "{seq}",
      }),
    ).not.toThrow();
  });
});

// ─── REQ-CERTNUM-005 ──────────────────────────────────────────────────────────

describe("REQ-CERTNUM-005: renderCertificateTemplate", () => {
  it("REQ-CERTNUM-005 substitutes every defined token", () => {
    const rendered = renderCertificateTemplate("{labCode}-{yyyy}-{seq}", {
      labCode: "CAL",
      yyyy: "2026",
      seq: "0001",
    });
    expect(rendered).toBe("CAL-2026-0001");
  });

  it("REQ-CERTNUM-005 leaves an unknown {token} literally unchanged in the output", () => {
    const rendered = renderCertificateTemplate("{labCode}-{ghost}-{seq}", {
      labCode: "CAL",
      seq: "0001",
      // ghost is intentionally absent
    });
    // The unknown {ghost} must appear verbatim
    expect(rendered).toBe("CAL-{ghost}-0001");
  });

  it("REQ-CERTNUM-005 substitutes all supported token names when provided", () => {
    const tokens = {
      number: "CAL-2026-0001",
      labCode: "CAL",
      labName: "Laboratorio",
      labSlug: "laboratorio",
      projectCode: "PROJ",
      yyyy: "2026",
      yy: "26",
      mm: "06",
      mon: "JUN",
      dd: "15",
      seq: "0001",
    };
    const template =
      "{number}/{labCode}/{labName}/{labSlug}/{projectCode}/{yyyy}/{yy}/{mm}/{mon}/{dd}/{seq}";
    const rendered = renderCertificateTemplate(template, tokens);
    expect(rendered).toBe(
      "CAL-2026-0001/CAL/Laboratorio/laboratorio/PROJ/2026/26/06/JUN/15/0001",
    );
  });

  it("REQ-CERTNUM-005 renders lab/year/sequence formats (existing)", () => {
    const rendered = renderCertificateTemplate("{labCode}-{yyyy}-{seq}", {
      labCode: "LAB01",
      yyyy: "2026",
      seq: "000123",
    });
    expect(rendered).toBe("LAB01-2026-000123");
  });

  it("REQ-CERTNUM-005 renders slash-separated project formats (existing)", () => {
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

  it("REQ-CERTNUM-005 renders month abbreviation formats (existing)", () => {
    const rendered = renderCertificateTemplate("{labCode}-{mon}-{yy}-{seq}", {
      labCode: "MICROBIO",
      mon: "APR",
      yy: "26",
      seq: "789",
    });
    expect(rendered).toBe("MICROBIO-APR-26-789");
  });
});

// ─── REQ-CERTNUM-006 ──────────────────────────────────────────────────────────

describe("REQ-CERTNUM-006: buildCertificateSequenceKey — all reset scopes", () => {
  // JUNE_2026 = new Date(Date.UTC(2026, 5, 15)) → year=2026, month=06 in UTC
  const ctx = { organizationId: "org1", generatedAt: JUNE_2026 };

  it('REQ-CERTNUM-006 returns "global" for never scope', () => {
    expect(buildCertificateSequenceKey("never", ctx, baseConfig)).toBe(
      "global",
    );
  });

  it('REQ-CERTNUM-006 returns "year:<YYYY>" for year scope', () => {
    expect(buildCertificateSequenceKey("year", ctx, baseConfig)).toBe(
      "year:2026",
    );
  });

  it('REQ-CERTNUM-006 returns "month:<YYYY>-<MM>" with zero-padded MM for month scope', () => {
    expect(buildCertificateSequenceKey("month", ctx, baseConfig)).toBe(
      "month:2026-06",
    );
  });

  it('REQ-CERTNUM-006 returns "project:<code>" for project scope when code is set', () => {
    const ctxWithProject = { ...ctx, projectCode: "GERAL" };
    expect(
      buildCertificateSequenceKey("project", ctxWithProject, baseConfig),
    ).toBe("project:GERAL");
  });

  it("REQ-CERTNUM-006 zero-pads month 1 (January) to 01", () => {
    const jan2026 = new Date(Date.UTC(2026, 0, 1));
    expect(
      buildCertificateSequenceKey(
        "month",
        { organizationId: "org1", generatedAt: jan2026 },
        baseConfig,
      ),
    ).toBe("month:2026-01");
  });

  it("REQ-CERTNUM-006 builds reset keys by configured scope (existing)", () => {
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
});

// ─── REQ-CERTNUM-007 ──────────────────────────────────────────────────────────

describe("REQ-CERTNUM-007: buildCertificateSequenceKey — project scope fallbacks", () => {
  const ctx = { organizationId: "org1", generatedAt: JUNE_2026 };

  it('REQ-CERTNUM-007 falls back to "project:GERAL" when neither context nor config has projectCode', () => {
    // baseConfig has projectCode: null
    expect(buildCertificateSequenceKey("project", ctx, baseConfig)).toBe(
      "project:GERAL",
    );
  });

  it("REQ-CERTNUM-007 uses config.projectCode as fallback when context.projectCode is absent", () => {
    const configWithProject: CertificateNumberingConfig = {
      ...baseConfig,
      projectCode: "CONF_PROJ",
    };
    expect(buildCertificateSequenceKey("project", ctx, configWithProject)).toBe(
      "project:CONF_PROJ",
    );
  });

  it("REQ-CERTNUM-007 context.projectCode takes precedence over config.projectCode", () => {
    const configWithProject: CertificateNumberingConfig = {
      ...baseConfig,
      projectCode: "CONF_PROJ",
    };
    const ctxWithProject = { ...ctx, projectCode: "CTX_PROJ" };
    expect(
      buildCertificateSequenceKey("project", ctxWithProject, configWithProject),
    ).toBe("project:CTX_PROJ");
  });

  it('REQ-CERTNUM-007 whitespace-only context.projectCode falls back to "project:GERAL"', () => {
    // trim() of "   " is "", which is falsy → falls back through chain to GERAL
    expect(
      buildCertificateSequenceKey(
        "project",
        { ...ctx, projectCode: "   " },
        baseConfig,
      ),
    ).toBe("project:GERAL");
  });
});

// ─── REQ-CERTNUM-008 ──────────────────────────────────────────────────────────

describe("REQ-CERTNUM-008: DEFAULT_CERTIFICATE_NUMBERING_CONFIG", () => {
  it('REQ-CERTNUM-008 numberTemplate is "{labCode}-{yyyy}-{seq}"', () => {
    expect(DEFAULT_CERTIFICATE_NUMBERING_CONFIG.numberTemplate).toBe(
      "{labCode}-{yyyy}-{seq}",
    );
  });

  it('REQ-CERTNUM-008 labCode is "CAL"', () => {
    expect(DEFAULT_CERTIFICATE_NUMBERING_CONFIG.labCode).toBe("CAL");
  });

  it('REQ-CERTNUM-008 resetScope is "year"', () => {
    expect(DEFAULT_CERTIFICATE_NUMBERING_CONFIG.sequence.resetScope).toBe(
      "year",
    );
  });

  it("REQ-CERTNUM-008 padding is 4", () => {
    expect(DEFAULT_CERTIFICATE_NUMBERING_CONFIG.sequence.padding).toBe(4);
  });

  it("REQ-CERTNUM-008 passes validateCertificateNumberingConfig without throwing", () => {
    expect(() =>
      validateCertificateNumberingConfig(DEFAULT_CERTIFICATE_NUMBERING_CONFIG),
    ).not.toThrow();
  });

  it("REQ-CERTNUM-008 validate returns the config unchanged", () => {
    const result = validateCertificateNumberingConfig(
      DEFAULT_CERTIFICATE_NUMBERING_CONFIG,
    );
    expect(result).toBe(DEFAULT_CERTIFICATE_NUMBERING_CONFIG);
  });
});
