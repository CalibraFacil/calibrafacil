import { describe, expect, it } from "vitest";
import type { DesktopNotificationsPublish } from "@calibra-facil/contracts";
import { NotificationAnnouncer } from "./notification-announcer";

function page(
  organizationKey: string,
  ids: number[],
  overrides: Partial<DesktopNotificationsPublish> = {},
): DesktopNotificationsPublish {
  return {
    organizationKey,
    unreadCount: ids.length,
    highWaterMarkId: Math.max(0, ...ids),
    entries: ids.map((id) => ({
      id,
      title: `Aviso ${id}`,
      message: "Algo mudou",
      status: "UNREAD",
      actionUrl: null,
    })),
    ...overrides,
  };
}

describe("NotificationAnnouncer", () => {
  it("seeds on the first page and announces only what arrives afterwards", () => {
    const announcer = new NotificationAnnouncer();

    expect(announcer.observe(page("org-a", [1, 2]), false).deliver).toEqual([]);

    const next = announcer.observe(page("org-a", [3, 2, 1]), false);
    expect(next.deliver.map((request) => request.id)).toEqual([3]);
    expect(next.unreadCount).toBe(3);

    expect(announcer.observe(page("org-a", [3, 2, 1]), false).deliver).toEqual(
      [],
    );
  });

  it("stays quiet while the window has focus", () => {
    const announcer = new NotificationAnnouncer();
    announcer.observe(page("org-a", [1]), false);

    expect(announcer.observe(page("org-a", [2, 1]), true).deliver).toEqual([]);
  });

  it("starts a switched organization unprimed, so its backlog is not news", () => {
    const announcer = new NotificationAnnouncer();
    announcer.observe(page("org-a", [1]), false);

    // B's existing unread rows must be seeded, not announced.
    expect(announcer.observe(page("org-b", [10, 11]), false).deliver).toEqual(
      [],
    );
    expect(
      announcer
        .observe(page("org-b", [12, 11, 10]), false)
        .deliver.map((request) => request.id),
    ).toEqual([12]);
  });

  it("forgets the old organization when the user switches back", () => {
    const announcer = new NotificationAnnouncer();
    announcer.observe(page("org-a", [1]), false);
    announcer.observe(page("org-b", [10]), false);

    expect(announcer.observe(page("org-a", [2, 1]), false).deliver).toEqual([]);
  });
});
