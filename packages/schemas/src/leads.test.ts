import { describe, expect, it } from "vitest";

import { LeadSubmissionSchema } from "./leads";

describe("LeadSubmissionSchema", () => {
  it("accepts a minimal valid lead and applies defaults", () => {
    const parsed = LeadSubmissionSchema.parse({
      name: "Maria Silva",
      email: "MARIA@LAB.com.BR",
    });

    expect(parsed.email).toBe("maria@lab.com.br"); // lowercased + trimmed
    expect(parsed.segment).toBe("outro"); // defaulted
    expect(parsed.phone).toBe("");
    expect(parsed.website).toBe(""); // honeypot default
    expect(parsed.utmSource).toBe("");
  });

  it("rejects a missing or too-short name", () => {
    expect(
      LeadSubmissionSchema.safeParse({ name: "M", email: "a@b.com" }).success,
    ).toBe(false);
  });

  it("rejects an invalid email", () => {
    expect(
      LeadSubmissionSchema.safeParse({ name: "Maria", email: "not-an-email" })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown segment", () => {
    const result = LeadSubmissionSchema.safeParse({
      name: "Maria",
      email: "a@b.com",
      segment: "hospital",
    });
    expect(result.success).toBe(false);
  });

  it("keeps a filled honeypot so the server can discard it", () => {
    const parsed = LeadSubmissionSchema.parse({
      name: "Bot",
      email: "bot@spam.com",
      website: "http://spam.example",
    });
    expect(parsed.website).toBe("http://spam.example");
  });

  it("carries attribution fields through", () => {
    const parsed = LeadSubmissionSchema.parse({
      name: "Maria",
      email: "a@b.com",
      segment: "lab",
      utmSource: "google",
      utmCampaign: "brand",
      referrer: "https://google.com",
    });
    expect(parsed.segment).toBe("lab");
    expect(parsed.utmSource).toBe("google");
    expect(parsed.referrer).toBe("https://google.com");
  });
});
