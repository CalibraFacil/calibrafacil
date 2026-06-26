import { describe, it, expect } from "vitest";
import {
  verifyResendSignature,
  parseResendEvent,
  resendEventRecipients,
  resendBounceIsHard,
} from "./resend-webhook";

// ---------------------------------------------------------------------------
// Independent oracle for the Svix HMAC scheme.
//
// secret/id/timestamp/body below are a fixed vector; VALID_SIGNATURE was computed
// OUT OF BAND (a throwaway `node -e` HMAC, not this module's code). Pinning that
// constant means a bug in verifyResendSignature (signing the wrong content, not
// stripping `whsec_`, not base64-decoding the key) fails to reproduce it → RED.
// ---------------------------------------------------------------------------
const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const SVIX_ID = "msg_p5jXN8AQM9LWM0D4loKWxJek";
const SVIX_TIMESTAMP = "1614265330";
const BODY = '{"test": 2432232314}';
const VALID_SIGNATURE = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=";
// A `now` inside the tolerance window of the fixture timestamp.
const NOW = new Date(Number(SVIX_TIMESTAMP) * 1000 + 10_000);

function baseInput() {
  return {
    secret: SECRET,
    svixId: SVIX_ID,
    svixTimestamp: SVIX_TIMESTAMP,
    svixSignature: VALID_SIGNATURE,
    body: BODY,
    now: NOW,
  };
}

describe("REQ-WH-001: verifyResendSignature (Svix HMAC-SHA256)", () => {
  it("REQ-WH-001 accepts a correctly signed payload", () => {
    expect(verifyResendSignature(baseInput())).toBe(true);
  });

  it("REQ-WH-001 rejects a tampered body (signature no longer matches)", () => {
    expect(
      verifyResendSignature({ ...baseInput(), body: '{"test": 9999999999}' }),
    ).toBe(false);
  });

  it("REQ-WH-001 rejects a wrong/forged secret", () => {
    expect(
      verifyResendSignature({
        ...baseInput(),
        secret: "whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      }),
    ).toBe(false);
  });

  it("REQ-WH-001 rejects a stale timestamp outside the tolerance window", () => {
    expect(
      verifyResendSignature({
        ...baseInput(),
        now: new Date(Number(SVIX_TIMESTAMP) * 1000 + 60 * 60 * 1000),
      }),
    ).toBe(false);
  });

  it("REQ-WH-001 rejects when required headers are missing", () => {
    expect(verifyResendSignature({ ...baseInput(), svixId: null })).toBe(false);
    expect(
      verifyResendSignature({ ...baseInput(), svixSignature: null }),
    ).toBe(false);
    expect(verifyResendSignature({ ...baseInput(), secret: "" })).toBe(false);
  });

  it("REQ-WH-001 accepts when ANY of several space-separated signatures matches", () => {
    expect(
      verifyResendSignature({
        ...baseInput(),
        svixSignature: `v1,not-the-right-signature ${VALID_SIGNATURE}`,
      }),
    ).toBe(true);
  });
});

describe("REQ-WH-003: Resend event classification", () => {
  it("REQ-WH-003 parses a well-formed event into { type, data }", () => {
    const event = parseResendEvent({
      type: "email.complained",
      data: { to: ["a@lab.com"] },
    });
    expect(event?.type).toBe("email.complained");
  });

  it("REQ-WH-003 returns null for a malformed event", () => {
    expect(parseResendEvent({ nope: true })).toBeNull();
    expect(parseResendEvent("not-json")).toBeNull();
  });

  it("REQ-WH-003 extracts recipient addresses from string or array `to`", () => {
    expect(resendEventRecipients({ to: ["a@lab.com", "b@lab.com"] })).toEqual([
      "a@lab.com",
      "b@lab.com",
    ]);
    expect(resendEventRecipients({ to: "c@lab.com" })).toEqual(["c@lab.com"]);
    expect(resendEventRecipients({})).toEqual([]);
  });

  it("REQ-WH-003 treats a Permanent bounce as hard, others as soft", () => {
    expect(resendBounceIsHard({ bounce: { type: "Permanent" } })).toBe(true);
    expect(resendBounceIsHard({ bounce: { type: "Transient" } })).toBe(false);
    expect(resendBounceIsHard({ bounce: { type: "Undetermined" } })).toBe(
      false,
    );
    expect(resendBounceIsHard({})).toBe(false);
  });
});
