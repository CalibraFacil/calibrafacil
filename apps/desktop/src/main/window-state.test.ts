import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import {
  DesktopWindowStateStore,
  resolveWindowState,
  type DisplayLike,
  type PersistedWindowState,
} from "./window-state";

const constraints = {
  defaultWidth: 1280,
  defaultHeight: 860,
  minWidth: 960,
  minHeight: 640,
};

/** A 1920x1080 primary with a 40px taskbar at the bottom. */
const primary: DisplayLike = {
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
};

/** A second monitor placed to the right of the primary. */
const secondary: DisplayLike = {
  workArea: { x: 1920, y: 0, width: 1920, height: 1080 },
};

function saved(overrides: Partial<PersistedWindowState> = {}) {
  return {
    bounds: { x: 100, y: 80, width: 1400, height: 900 },
    maximized: false,
    fullScreen: false,
    ...overrides,
  };
}

const tempDirectories: string[] = [];

function createTempUserData() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-window-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("resolveWindowState", () => {
  it("centres a default-sized window on first launch", () => {
    const state = resolveWindowState({
      saved: null,
      displays: [primary],
      constraints,
    });

    expect(state).toEqual({
      width: 1280,
      height: 860,
      minWidth: 960,
      minHeight: 640,
      maximized: false,
      fullScreen: false,
    });
    // No coordinates at all: the platform centres it.
    expect(state.x).toBeUndefined();
    expect(state.y).toBeUndefined();
  });

  it("restores a saved position that still fits", () => {
    expect(
      resolveWindowState({ saved: saved(), displays: [primary], constraints }),
    ).toEqual({
      x: 100,
      y: 80,
      width: 1400,
      height: 900,
      minWidth: 960,
      minHeight: 640,
      maximized: false,
      fullScreen: false,
    });
  });

  it("restores onto a secondary monitor", () => {
    expect(
      resolveWindowState({
        saved: saved({ bounds: { x: 2000, y: 100, width: 1400, height: 900 } }),
        displays: [primary, secondary],
        constraints,
      }),
    ).toMatchObject({ x: 2000, y: 100 });
  });

  it("drops the position when the saved monitor is gone", () => {
    // The docked second monitor is unplugged. Keeping x=2000 would open the
    // window on a desktop the user cannot see or drag it back from.
    const state = resolveWindowState({
      saved: saved({ bounds: { x: 2000, y: 100, width: 1400, height: 900 } }),
      displays: [primary],
      constraints,
    });

    expect(state.x).toBeUndefined();
    expect(state.y).toBeUndefined();
    // Size is still worth keeping.
    expect(state).toMatchObject({ width: 1400, height: 900 });
  });

  it("pulls a partially offscreen window fully back into the work area", () => {
    expect(
      resolveWindowState({
        saved: saved({ bounds: { x: 1800, y: 900, width: 1400, height: 900 } }),
        displays: [primary],
        constraints,
      }),
    ).toMatchObject({ x: 520, y: 140, width: 1400, height: 900 });
  });

  it("never places the window under the taskbar", () => {
    const state = resolveWindowState({
      saved: saved({ bounds: { x: 0, y: 1030, width: 1000, height: 700 } }),
      displays: [primary],
      constraints,
    });

    expect(state.y! + state.height).toBeLessThanOrEqual(
      primary.workArea.y + primary.workArea.height,
    );
  });

  it("shrinks a window saved larger than the current screen", () => {
    // Restoring a 2560-wide window onto a 1366-wide laptop.
    const laptop: DisplayLike = {
      workArea: { x: 0, y: 0, width: 1366, height: 728 },
    };

    expect(
      resolveWindowState({
        saved: saved({ bounds: { x: 0, y: 0, width: 2560, height: 1400 } }),
        displays: [laptop],
        constraints,
      }),
    ).toMatchObject({ x: 0, y: 0, width: 1366, height: 728 });
  });

  it("lowers the window minimums to match a clamped small display", () => {
    // Electron enforces constructor minimums, so returning a size below them
    // without lowering the constraint pushes the window straight back out of
    // the work area — the clamp would have achieved nothing.
    const tiny: DisplayLike = {
      workArea: { x: 0, y: 0, width: 800, height: 600 },
    };

    expect(
      resolveWindowState({
        saved: saved({ bounds: { x: 0, y: 0, width: 400, height: 300 } }),
        displays: [tiny],
        constraints,
      }),
    ).toMatchObject({
      width: 800,
      height: 600,
      minWidth: 800,
      minHeight: 600,
    });
  });

  it("keeps the nominal minimums on a display that can satisfy them", () => {
    expect(
      resolveWindowState({ saved: saved(), displays: [primary], constraints }),
    ).toMatchObject({ minWidth: 960, minHeight: 640 });
  });

  it("lets the work area override the nominal minimum size", () => {
    // A screen smaller than minWidth/minHeight: fitting the screen beats
    // honouring a minimum the display cannot satisfy.
    const tiny: DisplayLike = {
      workArea: { x: 0, y: 0, width: 800, height: 600 },
    };

    expect(
      resolveWindowState({
        saved: saved({ bounds: { x: 0, y: 0, width: 400, height: 300 } }),
        displays: [tiny],
        constraints,
      }),
    ).toMatchObject({ width: 800, height: 600 });
  });

  it("carries maximized and fullscreen through", () => {
    expect(
      resolveWindowState({
        saved: saved({ maximized: true, fullScreen: true }),
        displays: [primary],
        constraints,
      }),
    ).toMatchObject({ maximized: true, fullScreen: true });
  });

  it("falls back to the default when no display is reported", () => {
    expect(
      resolveWindowState({ saved: saved(), displays: [], constraints }),
    ).toEqual({
      width: 1280,
      height: 860,
      minWidth: 960,
      minHeight: 640,
      maximized: false,
      fullScreen: false,
    });
  });
});

describe("DesktopWindowStateStore", () => {
  it("returns null before anything has been saved", async () => {
    const store = new DesktopWindowStateStore(createTempUserData());

    await expect(store.load()).resolves.toBeNull();
  });

  it("round-trips a saved state", async () => {
    const userData = createTempUserData();
    const store = new DesktopWindowStateStore(userData);

    await store.save(saved({ maximized: true }));

    await expect(new DesktopWindowStateStore(userData).load()).resolves.toEqual(
      saved({ maximized: true }),
    );
  });

  it("degrades to the default instead of failing to open on a corrupt file", async () => {
    const userData = createTempUserData();
    mkdirSync(path.join(userData, "settings"), { recursive: true });
    writeFileSync(
      path.join(userData, "settings", "window-state.json"),
      "{ not json",
    );

    await expect(
      new DesktopWindowStateStore(userData).load(),
    ).resolves.toBeNull();
  });

  it("rejects a structurally invalid state rather than restoring garbage", async () => {
    const userData = createTempUserData();
    mkdirSync(path.join(userData, "settings"), { recursive: true });
    writeFileSync(
      path.join(userData, "settings", "window-state.json"),
      JSON.stringify({ bounds: { x: "left", y: 0, width: 0, height: 0 } }),
    );

    await expect(
      new DesktopWindowStateStore(userData).load(),
    ).resolves.toBeNull();
  });

  it("serializes a burst of writes into one final file", async () => {
    // Move/resize events fire in bursts; interleaved atomic renames can leave
    // a truncated file behind.
    const userData = createTempUserData();
    const store = new DesktopWindowStateStore(userData);

    for (let width = 800; width < 810; width += 1) {
      void store.save(saved({ bounds: { x: 0, y: 0, width, height: 600 } }));
    }
    await store.flush();

    const raw = await readFile(
      path.join(userData, "settings", "window-state.json"),
      "utf8",
    );

    expect(JSON.parse(raw)).toMatchObject({ bounds: { width: 809 } });
  });
});
