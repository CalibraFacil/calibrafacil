import { describe, expect, it } from "vitest";
import {
  isPendingObjectKey,
  pendingStandardCertificateKey,
} from "./storage-keys";

describe("the placeholder key of an unuploaded document", () => {
  it("a key the writer produces is pending, a stored key is not", () => {
    expect(isPendingObjectKey(pendingStandardCertificateKey(7, "abc"))).toBe(
      true,
    );
    expect(
      isPendingObjectKey("org/lab-1/standards/7/certificates/1-a.pdf"),
    ).toBe(false);
    expect(isPendingObjectKey("not-pending/x.pdf")).toBe(false);
  });
});
