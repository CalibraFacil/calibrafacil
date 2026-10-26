import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeDatabases,
  getDb,
  getSystemDb,
  setQueryObserver,
  systemDb,
} from "./db";

// The SYSTEM path (P2-18): the owner connection that the statements which are
// cross-organization by design run on. postgres.js connects lazily, so these
// tests never open a socket: they read the options the pool was built with.

function connectedUser(database: unknown): unknown {
  if (typeof database !== "object" || database === null) return undefined;
  const client: unknown = Reflect.get(database, "$client");
  // postgres.js hands out its client as a function that also carries `options`.
  if (typeof client !== "function") return undefined;
  const options: unknown = Reflect.get(client, "options");
  if (typeof options !== "object" || options === null) return undefined;
  return Reflect.get(options, "user");
}

afterEach(() => {
  vi.unstubAllEnvs();
  setQueryObserver(null);
});

describe("systemDb (P2-18: the named owner/system path)", () => {
  it("without DATABASE_OWNER_URL it is the application connection (shadow mode: the app is the owner)", () => {
    vi.stubEnv("DATABASE_URL", "postgres://app_user:pw@localhost:1/calibra");
    vi.stubEnv("DATABASE_OWNER_URL", "");
    expect(getSystemDb()).toBe(getDb());
    expect(connectedUser(getSystemDb())).toBe("app_user");
  });

  it("with DATABASE_OWNER_URL it is a pool of its own, as the owner", () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://calibra_app_login:pw@localhost:1/db",
    );
    vi.stubEnv(
      "DATABASE_OWNER_URL",
      "postgres://table_owner:pw@localhost:1/db",
    );
    const application = getDb();
    const system = getSystemDb();
    expect(system).not.toBe(application);
    expect(connectedUser(application)).toBe("calibra_app_login");
    expect(connectedUser(system)).toBe("table_owner");
    // Stable: asking again does not open a second pool, and does not evict the
    // application pool.
    expect(getSystemDb()).toBe(system);
    expect(getDb()).toBe(application);
  });

  it("the exported proxy resolves to the same pool as getSystemDb()", () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://calibra_app_login:pw@localhost:1/db",
    );
    vi.stubEnv(
      "DATABASE_OWNER_URL",
      "postgres://table_owner:pw@localhost:1/db",
    );
    expect(Reflect.get(systemDb, "$client")).toBe(
      Reflect.get(getSystemDb(), "$client"),
    );
  });

  it("reports exactly one access to the query observer per call, with or without an owner URL", () => {
    vi.stubEnv("DATABASE_URL", "postgres://app_user:pw@localhost:1/calibra");
    const onAccess = vi.fn();
    setQueryObserver({ onAccess, onQuery: () => {} });

    vi.stubEnv("DATABASE_OWNER_URL", "");
    getSystemDb();
    expect(onAccess).toHaveBeenCalledTimes(1);

    onAccess.mockClear();
    vi.stubEnv(
      "DATABASE_OWNER_URL",
      "postgres://table_owner:pw@localhost:1/db",
    );
    getSystemDb();
    expect(onAccess).toHaveBeenCalledTimes(1);
  });
});

describe("closeDatabases (graceful shutdown)", () => {
  it("closes both pools, forgets them, and is idempotent", async () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://calibra_app_login:pw@localhost:1/db",
    );
    vi.stubEnv(
      "DATABASE_OWNER_URL",
      "postgres://table_owner:pw@localhost:1/db",
    );
    const application = getDb();
    const system = getSystemDb();

    await closeDatabases();
    await closeDatabases();

    // A later access opens a fresh pool rather than reusing a closed one.
    expect(getDb()).not.toBe(application);
    expect(getSystemDb()).not.toBe(system);
    await closeDatabases();
  });
});
