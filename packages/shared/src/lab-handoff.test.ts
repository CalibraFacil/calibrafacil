import { describe, expect, it } from "vitest";
import { labHandoffUrl, readLabHandoffOrganizationId } from "./lab-handoff";

describe("lab handoff", () => {
  it("round-trips the organization through the URL the portal builds", () => {
    const url = new URL(labHandoffUrl("https://lab.example.com/", "org 1&x"));
    expect(url.origin + url.pathname).toBe("https://lab.example.com/dashboard");
    expect(readLabHandoffOrganizationId(url.search)).toBe("org 1&x");
  });

  it("reads nothing from a search without the param", () => {
    expect(readLabHandoffOrganizationId(undefined)).toBeNull();
    expect(readLabHandoffOrganizationId("")).toBeNull();
    expect(readLabHandoffOrganizationId("?status=OPEN")).toBeNull();
    expect(readLabHandoffOrganizationId("?organization=")).toBeNull();
  });
});
