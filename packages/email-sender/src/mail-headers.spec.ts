import { describe, expect, it } from "vitest";
import {
  formatFromEmail,
  getEmailAddress,
  getReplyToEmail,
  sanitizeMailHeader,
  stripBrandSender,
} from "./mail-headers";

describe("sanitizeMailHeader", () => {
  it("turns line breaks into one space so a value cannot inject a header", () => {
    expect(sanitizeMailHeader("Convite\r\nBcc: x@evil.test")).toBe(
      "Convite Bcc: x@evil.test",
    );
  });
});

describe("getEmailAddress", () => {
  it("takes the address out of `Name <address>`", () => {
    expect(getEmailAddress("Calibra <noreply@x.test>")).toBe("noreply@x.test");
  });

  it("returns a bare address trimmed", () => {
    expect(getEmailAddress("  noreply@x.test ")).toBe("noreply@x.test");
  });
});

describe("formatFromEmail", () => {
  const platform = "Calibra Fácil <noreply@x.test>";

  it("keeps the platform address for a brand that is not white-label", () => {
    expect(formatFromEmail(platform, { name: "Lab" })).toBe(platform);
    expect(formatFromEmail(platform, undefined)).toBe(platform);
  });

  it("shows a white-label brand as `Lab via CalibraFácil` on the platform address", () => {
    expect(
      formatFromEmail(platform, { name: "Lab\r\nX", isWhiteLabel: true }),
    ).toBe("Lab X via CalibraFácil <noreply@x.test>");
  });
});

describe("getReplyToEmail", () => {
  it("uses the support address when it looks like one, on one line", () => {
    expect(getReplyToEmail({ name: "Lab", supportEmail: " a@b.test\n" })).toBe(
      "a@b.test",
    );
  });

  it("is undefined without an address", () => {
    expect(getReplyToEmail({ name: "Lab", supportEmail: "no-at" })).toBe(
      undefined,
    );
    expect(getReplyToEmail(undefined)).toBe(undefined);
  });
});

describe("stripBrandSender", () => {
  it("drops the lab sender and leaves the rest of the brand", () => {
    const brand = { name: "Lab", sender: { organizationId: "o" } };
    expect(stripBrandSender(brand)).toEqual({ name: "Lab", sender: undefined });
  });

  it("returns a brand without a sender as it is", () => {
    const brand = { name: "Lab" };
    expect(stripBrandSender(brand)).toBe(brand);
    expect(stripBrandSender(undefined)).toBeUndefined();
  });
});
