import { describe, expect, it } from "vitest";

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_TYPES,
} from "./notification-types";

describe("notification type registry", () => {
  it("lists no priority value as a type (it is a different axis)", () => {
    const priorities = ["HIGH", "MEDIUM", "LOW"];
    expect(
      NOTIFICATION_TYPES.filter((type) => priorities.includes(type)),
    ).toEqual([]);
  });

  it("lists every type once", () => {
    expect(new Set(NOTIFICATION_TYPES).size).toBe(NOTIFICATION_TYPES.length);
  });

  it("gives every type, and only the types, a default preference", () => {
    expect(Object.keys(DEFAULT_NOTIFICATION_PREFERENCES).sort()).toEqual(
      [...NOTIFICATION_TYPES].sort(),
    );
  });
});
