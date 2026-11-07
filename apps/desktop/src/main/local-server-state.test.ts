import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp", isPackaged: false },
}));

const { LOCAL_SERVER_TRANSITIONS, canMoveLocalServer } =
  await import("./local-server-manager");

describe("the local server lifecycle table", () => {
  it("a ready server only crashes or stops", () => {
    expect(LOCAL_SERVER_TRANSITIONS.ready).toEqual(["crashed", "stopping"]);
    expect(canMoveLocalServer("ready", "starting")).toBe(false);
  });

  it("stopping always ends stopped, and every state can be stopped", () => {
    expect(LOCAL_SERVER_TRANSITIONS.stopping).toEqual(["stopped"]);
    for (const [state, next] of Object.entries(LOCAL_SERVER_TRANSITIONS)) {
      if (state === "stopping") continue;
      expect(next).toContain("stopping");
    }
  });
});
