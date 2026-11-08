import { describe, expect, it } from "vitest";

import {
  AUDIT_PACK_MAX_CERTIFICATES,
  auditPackTooLargeMessage,
} from "./audit-pack";

describe("audit pack cap", () => {
  it("names the one cap in the refusal both the API and the worker show", () => {
    expect(auditPackTooLargeMessage()).toContain(
      `mais de ${AUDIT_PACK_MAX_CERTIFICATES} certificados`,
    );
  });
});
