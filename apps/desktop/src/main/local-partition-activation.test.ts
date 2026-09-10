import { describe, expect, it } from "vitest";

import {
  describeLocalPartitionRefusal,
  resolveLocalPartitionActivation,
  type ResolveLocalPartitionInput,
} from "./local-partition-activation";

const ana = { userId: "user-ana", organizationId: "org-1" };
/** Same organization as Ana, different account — the case an org-only
 * partition would not separate. */
const bruno = { userId: "user-bruno", organizationId: "org-1" };
const anaOtherOrg = { userId: "user-ana", organizationId: "org-2" };

function resolve(overrides: Partial<ResolveLocalPartitionInput> = {}) {
  return resolveLocalPartitionActivation({
    requested: null,
    identityVerified: false,
    running: null,
    remembered: null,
    ...overrides,
  });
}

describe("offline start", () => {
  it("opens the last authorized partition when nothing is verified yet", () => {
    // A technician opening a laptop with no signal must keep working.
    expect(resolve({ remembered: ana })).toEqual({
      action: "start",
      partition: ana,
      offline: true,
    });
  });

  it("keeps serving what is already open", () => {
    expect(resolve({ running: ana, remembered: ana })).toEqual({
      action: "reuse",
      partition: ana,
    });
  });

  it("opens nothing on a device that never authorized anyone", () => {
    expect(resolve()).toEqual({ action: "idle" });
  });
});

describe("steady state", () => {
  it("carries on when the verified identity matches", () => {
    expect(
      resolve({ requested: ana, identityVerified: true, running: ana }),
    ).toEqual({ action: "reuse", partition: ana });
  });

  it("carries on even without verification when it matches what is open", () => {
    // Offline refresh of a session that is already the open partition: there
    // is nothing to switch to, so nothing to refuse.
    expect(
      resolve({ requested: ana, identityVerified: false, running: ana }),
    ).toEqual({ action: "reuse", partition: ana });
  });
});

describe("switching accounts", () => {
  it("switches when the new identity was verified online", () => {
    expect(
      resolve({ requested: bruno, identityVerified: true, running: ana }),
    ).toEqual({ action: "switch", from: ana, to: bruno });
  });

  it("switches between organizations for the same account", () => {
    expect(
      resolve({
        requested: anaOtherOrg,
        identityVerified: true,
        running: ana,
      }),
    ).toEqual({ action: "switch", from: ana, to: anaOtherOrg });
  });

  it("starts fresh when nothing is open yet", () => {
    expect(resolve({ requested: ana, identityVerified: true })).toEqual({
      action: "start",
      partition: ana,
      offline: false,
    });
  });

  it("starts a different account than the remembered one, once verified", () => {
    expect(
      resolve({ requested: bruno, identityVerified: true, remembered: ana }),
    ).toEqual({ action: "start", partition: bruno, offline: false });
  });
});

describe("unverified switches are refused", () => {
  it("refuses another account in the same organization while offline", () => {
    // The exposure this policy exists to close. A cached session says who the
    // browser thinks you are, not whether that is still true — offline there
    // is nothing to check a revoked membership against.
    expect(
      resolve({ requested: bruno, identityVerified: false, running: ana }),
    ).toEqual({
      action: "refuse",
      reason: "offline-switch-requires-authentication",
    });
  });

  it("refuses even when the target is the remembered partition", () => {
    // Remembering an identity is not re-authenticating it.
    expect(
      resolve({ requested: ana, identityVerified: false, remembered: ana }),
    ).toEqual({
      action: "refuse",
      reason: "offline-switch-requires-authentication",
    });
  });

  it("refuses a first-ever sign-in that could not reach the cloud", () => {
    expect(resolve({ requested: ana, identityVerified: false })).toEqual({
      action: "refuse",
      reason: "no-authorized-identity",
    });
  });
});

describe("nothing is ever destroyed", () => {
  it("has no action that deletes or transfers a partition", () => {
    // The outgoing account's queued field work stays in its own database. If
    // an action like "purge" or "adopt" ever appears here, it needs its own
    // deliberate review — this test is the tripwire.
    const actions = new Set(
      [
        resolve({ remembered: ana }),
        resolve({ running: ana, remembered: ana }),
        resolve(),
        resolve({ requested: ana, identityVerified: true, running: ana }),
        resolve({ requested: bruno, identityVerified: true, running: ana }),
        resolve({ requested: ana, identityVerified: true }),
        resolve({ requested: bruno, identityVerified: false, running: ana }),
      ].map((decision) => decision.action),
    );

    expect([...actions].sort()).toEqual([
      "idle",
      "refuse",
      "reuse",
      "start",
      "switch",
    ]);
  });
});

describe("describeLocalPartitionRefusal", () => {
  it("tells the user their previous data is intact", () => {
    // Someone who cannot get in needs to know their offline work is not lost.
    expect(
      describeLocalPartitionRefusal("offline-switch-requires-authentication"),
    ).toMatch(/intact/i);
  });

  it("has a message for every refusal", () => {
    for (const reason of [
      "offline-switch-requires-authentication",
      "no-authorized-identity",
    ] as const) {
      expect(describeLocalPartitionRefusal(reason)).toMatch(/\S/);
    }
  });
});
