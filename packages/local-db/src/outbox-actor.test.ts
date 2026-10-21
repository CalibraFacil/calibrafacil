import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  countPendingOutboxForOtherUsers,
  createLocalCustomer,
  listPendingOutboxEvents,
  markOutboxEventsFailedForRetry,
  openLocalDatabase,
} from "./index";

// On a shared desktop the outbox can hold events recorded by more than one
// account. The cloud attributes a pushed event to the session that pushes it,
// so an event must only leave the device while its author is signed in.

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createDatabase() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-actor-"));
  tempDirectories.push(directory);
  return openLocalDatabase({
    filePath: path.join(directory, "calibra.sqlite"),
  });
}

type Database = ReturnType<typeof createDatabase>;

function recordCustomer(
  database: Database,
  name: string,
  actorUserId: string | null,
) {
  createLocalCustomer(database, {
    organizationId: "org-1",
    unitId: 1,
    name,
    actorUserId,
    deviceId: "device-1",
  });
}

function seed(database: Database) {
  recordCustomer(database, "Da Ana", "user-ana");
  recordCustomer(database, "Do Bruno", "user-bruno");
  recordCustomer(database, "Sem autor", null);
}

function pushedNames(database: Database, actorUserId?: string | null) {
  return listPendingOutboxEvents(database, 50, {
    includeDeferred: true,
    actorUserId,
  }).map((event) => {
    const payload =
      event.payload && typeof event.payload === "object"
        ? Object.fromEntries(Object.entries(event.payload))
        : {};
    return payload.name;
  });
}

describe("outbox events and the signed-in user", () => {
  it("lists only the signed-in user's events and those with no recorded author", () => {
    const database = createDatabase();
    seed(database);

    expect(pushedNames(database, "user-bruno")).toEqual([
      "Do Bruno",
      "Sem autor",
    ]);
    expect(pushedNames(database, "user-ana")).toEqual(["Da Ana", "Sem autor"]);

    database.close();
  });

  it("lists everything when the signed-in user is not known", () => {
    const database = createDatabase();
    seed(database);

    expect(pushedNames(database, null)).toHaveLength(3);
    expect(pushedNames(database)).toHaveLength(3);

    database.close();
  });

  it("does not let other users' events crowd the signed-in user's out of a page", () => {
    const database = createDatabase();
    for (let index = 0; index < 5; index += 1) {
      recordCustomer(database, `Ana ${index}`, "user-ana");
    }
    recordCustomer(database, "Bruno", "user-bruno");

    const events = listPendingOutboxEvents(database, 2, {
      includeDeferred: true,
      actorUserId: "user-bruno",
    });

    expect(events).toHaveLength(1);

    database.close();
  });

  it("counts the pending events that belong to other users", () => {
    const database = createDatabase();
    seed(database);

    expect(countPendingOutboxForOtherUsers(database, "user-bruno")).toBe(1);
    expect(countPendingOutboxForOtherUsers(database, "user-ana")).toBe(1);
    expect(countPendingOutboxForOtherUsers(database, "user-carla")).toBe(2);
    expect(countPendingOutboxForOtherUsers(database, null)).toBe(0);

    database.close();
  });

  it("counts a failed event of another user too, and stops counting it once synced", () => {
    const database = createDatabase();
    recordCustomer(database, "Da Ana", "user-ana");
    const [event] = listPendingOutboxEvents(database, 50, {
      includeDeferred: true,
    });
    if (!event) throw new Error("Expected an event");
    markOutboxEventsFailedForRetry(database, [event.eventId], "offline");

    expect(countPendingOutboxForOtherUsers(database, "user-bruno")).toBe(1);

    database
      .prepare("UPDATE outbox SET status = 'synced' WHERE event_id = ?")
      .run(event.eventId);

    expect(countPendingOutboxForOtherUsers(database, "user-bruno")).toBe(0);

    database.close();
  });
});
