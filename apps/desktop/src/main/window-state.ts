import { readFile } from "node:fs/promises";
import path from "node:path";

import { writeJsonFileAtomically } from "./atomic-json-file";
import { z } from "zod";

/**
 * Window size, position and maximized state across restarts.
 *
 * The interesting part is not saving — it is refusing to restore a position
 * that no longer exists. A technician who docks a laptop to a second monitor
 * at the lab, then opens it on the train, would otherwise get a window placed
 * off the visible desktop with no way to drag it back.
 *
 * Everything here is in **device-independent pixels**. Electron reports
 * `BrowserWindow` bounds and `Display.workArea` in the same DIP space, so
 * there is no scale factor to apply — mixing in `scaleFactor` would double
 * the correction on a HiDPI screen.
 */

export const windowBoundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

export const persistedWindowStateSchema = z.object({
  bounds: windowBoundsSchema.nullable().default(null),
  maximized: z.boolean().default(false),
  fullScreen: z.boolean().default(false),
});

export type WindowBounds = z.infer<typeof windowBoundsSchema>;
export type PersistedWindowState = z.infer<typeof persistedWindowStateSchema>;

export type DisplayLike = {
  /** Usable area, excluding taskbars and docks. DIPs. */
  workArea: WindowBounds;
};

export type WindowSizeConstraints = {
  defaultWidth: number;
  defaultHeight: number;
  minWidth: number;
  minHeight: number;
};

export type ResolvedWindowState = {
  width: number;
  height: number;
  /** Omitted when the window should be centred by the platform. */
  x?: number;
  y?: number;
  maximized: boolean;
  fullScreen: boolean;
  /**
   * The minimums to hand `BrowserWindow`, which may be *below* the nominal
   * ones. Electron enforces constructor minimums, so a window clamped to a
   * work area smaller than 960x640 would otherwise be enlarged straight back
   * out of view — the clamp and the constraint have to agree.
   */
  minWidth: number;
  minHeight: number;
};

/**
 * Decide where to open. Falls back to a centred default whenever the saved
 * position cannot be honoured — a missing file, a disconnected monitor, a
 * resolution change — rather than trusting coordinates that no display covers.
 */
export function resolveWindowState({
  saved,
  displays,
  constraints,
}: {
  saved: PersistedWindowState | null;
  displays: readonly DisplayLike[];
  constraints: WindowSizeConstraints;
}): ResolvedWindowState {
  const maximized = saved?.maximized ?? false;
  const fullScreen = saved?.fullScreen ?? false;
  const centredDefault: ResolvedWindowState = {
    width: constraints.defaultWidth,
    height: constraints.defaultHeight,
    minWidth: constraints.minWidth,
    minHeight: constraints.minHeight,
    maximized,
    fullScreen,
  };

  const bounds = saved?.bounds;
  const [firstDisplay] = displays;
  if (!bounds || !firstDisplay) return centredDefault;

  const target = findDisplayFor(bounds, displays);
  if (!target) {
    // The monitor this window was last on is gone. Keeping the *size* is still
    // useful; keeping the coordinates is how a window ends up unreachable.
    const size = clampSize(bounds, firstDisplay.workArea, constraints);
    return {
      ...centredDefault,
      ...size,
      ...minimumsFor(size, constraints),
    };
  }

  const size = clampSize(bounds, target.workArea, constraints);

  return {
    ...size,
    ...minimumsFor(size, constraints),
    ...clampPosition({ ...bounds, ...size }, target.workArea),
    maximized,
    fullScreen,
  };
}

/**
 * The display showing most of the window. Requires a real overlap, not merely
 * the nearest one, so a window on a removed monitor is reported as homeless
 * instead of being silently reassigned to a display it was never on.
 */
function findDisplayFor(
  bounds: WindowBounds,
  displays: readonly DisplayLike[],
): DisplayLike | null {
  let best: DisplayLike | null = null;
  let bestOverlap = 0;

  for (const display of displays) {
    const overlap = overlapArea(bounds, display.workArea);
    if (overlap > bestOverlap) {
      best = display;
      bestOverlap = overlap;
    }
  }

  return best;
}

function overlapArea(a: WindowBounds, b: WindowBounds) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);

  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * Never larger than the size we just resolved. On a display too small for the
 * nominal minimum this lowers the constraint to match, rather than letting
 * Electron push the window back beyond the work area.
 */
function minimumsFor(
  size: { width: number; height: number },
  constraints: WindowSizeConstraints,
) {
  return {
    minWidth: Math.min(size.width, constraints.minWidth),
    minHeight: Math.min(size.height, constraints.minHeight),
  };
}

function clampSize(
  bounds: WindowBounds,
  workArea: WindowBounds,
  constraints: WindowSizeConstraints,
) {
  return {
    // The work area wins over the minimum: a window wider than the screen is
    // worse than one narrower than its nominal minimum.
    width: clamp(
      Math.round(bounds.width),
      Math.min(constraints.minWidth, workArea.width),
      workArea.width,
    ),
    height: clamp(
      Math.round(bounds.height),
      Math.min(constraints.minHeight, workArea.height),
      workArea.height,
    ),
  };
}

function clampPosition(bounds: WindowBounds, workArea: WindowBounds) {
  return {
    x: clamp(
      Math.round(bounds.x),
      workArea.x,
      workArea.x + workArea.width - bounds.width,
    ),
    y: clamp(
      Math.round(bounds.y),
      workArea.y,
      workArea.y + workArea.height - bounds.height,
    ),
  };
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

const windowStateDirectory = "settings";
const windowStateFileName = "window-state.json";

/**
 * Persisted separately from `DesktopSettings`: window geometry is
 * machine-local noise that changes on every drag, and mixing it into the
 * settings file would rewrite user preferences dozens of times per session.
 */
export class DesktopWindowStateStore {
  private current: PersistedWindowState | null = null;
  private loaded = false;
  private writing: Promise<void> = Promise.resolve();
  private readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.join(
      userDataPath,
      windowStateDirectory,
      windowStateFileName,
    );
  }

  async load(): Promise<PersistedWindowState | null> {
    if (this.loaded) return this.current;
    this.loaded = true;

    try {
      const parsed = persistedWindowStateSchema.safeParse(
        JSON.parse(await readFile(this.filePath, "utf8")),
      );
      this.current = parsed.success ? parsed.data : null;
    } catch {
      // Missing or corrupt: a bad geometry file must never stop the app from
      // opening, so it degrades to the centred default.
      this.current = null;
    }

    return this.current;
  }

  /**
   * Queue a write. Calls are serialized because move/resize events fire in
   * bursts, and two concurrent atomic renames can interleave into a truncated
   * file.
   */
  save(state: PersistedWindowState): Promise<void> {
    this.current = state;
    this.loaded = true;
    this.writing = this.writing
      .catch(() => undefined)
      .then(() => this.persist(state));

    return this.writing;
  }

  /** Resolves once every queued write has settled. */
  async flush(): Promise<void> {
    await this.writing.catch(() => undefined);
  }

  private async persist(state: PersistedWindowState) {
    await writeJsonFileAtomically(this.filePath, state);
  }
}
