import { describe, expect, it } from "vitest";

import {
  observeNotifications,
  type NotificationFeedEntry,
  type ObserveNotificationsInput,
} from "./native-notifications";

function entry(
  id: number,
  overrides: Partial<NotificationFeedEntry> = {},
): NotificationFeedEntry {
  return {
    id,
    title: `Job ${id} aguarda revisão`,
    message: "Enviado por Ana",
    status: "UNREAD",
    actionUrl: `/dashboard/jobs/${id}`,
    ...overrides,
  };
}

function observe(overrides: Partial<ObserveNotificationsInput> = {}) {
  return observeNotifications({
    entries: [],
    seen: new Set(),
    primed: true,
    windowFocused: false,
    ...overrides,
  });
}

describe("observeNotifications", () => {
  it("announces a new unread notification", () => {
    const result = observe({ entries: [entry(7)] });

    expect(result.deliver).toEqual([
      {
        id: 7,
        title: "Job 7 aguarda revisão",
        body: "Enviado por Ana",
        actionPath: "/dashboard/jobs/7",
      },
    ]);
  });

  it("seeds without announcing on the first observation", () => {
    // The first poll after launch returns every unread notification — possibly
    // weeks of them. Thirty toasts at once is worse than none.
    const first = observe({
      entries: [entry(1), entry(2), entry(3)],
      primed: false,
    });

    expect(first.deliver).toEqual([]);
    expect([...first.seen]).toEqual([1, 2, 3]);
  });

  it("announces only what arrived after the seeding poll", () => {
    const first = observe({ entries: [entry(1)], primed: false });
    const second = observe({
      entries: [entry(2), entry(1)],
      seen: first.seen,
    });

    expect(second.deliver.map((item) => item.id)).toEqual([2]);
  });

  it("never announces the same notification twice", () => {
    // The feed is polled, so the same row comes back in every response.
    const first = observe({ entries: [entry(9)] });
    const second = observe({ entries: [entry(9)], seen: first.seen });
    const third = observe({ entries: [entry(9)], seen: second.seen });

    expect(first.deliver).toHaveLength(1);
    expect(second.deliver).toEqual([]);
    expect(third.deliver).toEqual([]);
  });

  it("stays quiet while the window is focused", () => {
    const result = observe({ entries: [entry(4)], windowFocused: true });

    expect(result.deliver).toEqual([]);
    // Still recorded, so it is not announced later when focus is lost.
    expect(result.seen.has(4)).toBe(true);
  });

  it("ignores notifications the user already read elsewhere", () => {
    expect(
      observe({ entries: [entry(5, { status: "READ" })] }).deliver,
    ).toEqual([]);
  });

  it("drops an action URL that is not a same-app path", () => {
    // A server payload must not be able to navigate the desktop shell
    // off-origin.
    for (const actionUrl of [
      "https://evil.example/steal",
      "//evil.example/steal",
      "javascript:alert(1)",
      "dashboard/jobs/1",
      "",
    ]) {
      const [delivered] = observe({
        entries: [entry(11, { actionUrl })],
      }).deliver;

      expect(delivered?.actionPath).toBeNull();
    }
  });

  it("tolerates a missing action URL", () => {
    expect(
      observe({ entries: [entry(12, { actionUrl: null })] }).deliver[0]
        ?.actionPath,
    ).toBeNull();
  });

  it("bounds the id set over a long session", () => {
    let seen: ReadonlySet<number> = new Set();

    for (let batch = 0; batch < 50; batch += 1) {
      seen = observe({
        entries: [entry(batch * 2), entry(batch * 2 + 1)],
        seen,
        maxSeen: 10,
      }).seen;
    }

    expect(seen.size).toBeLessThanOrEqual(10);
  });

  it("keeps every id still in the feed even when trimming", () => {
    // If trimming evicted something the current page still shows, the next
    // poll would announce it a second time.
    const entries = [entry(1), entry(2), entry(3)];
    const result = observeNotifications({
      entries,
      seen: new Set([90, 91, 92, 93, 94]),
      primed: true,
      windowFocused: false,
      maxSeen: 4,
    });

    for (const item of entries) {
      expect(result.seen.has(item.id)).toBe(true);
    }
    expect(result.seen.size).toBe(4);
  });
});
