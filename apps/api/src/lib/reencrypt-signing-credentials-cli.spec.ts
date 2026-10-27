import { describe, expect, it, vi } from "vitest";
import { generateMasterKey } from "@calibra-facil/signing";
import {
  runReencryptCli,
  type ReencryptCliDeps,
} from "./reencrypt-signing-credentials-cli";

type Summary = Awaited<ReturnType<ReencryptCliDeps["reencrypt"]>>;

const KEY = generateMasterKey();
const OTHER_KEY = generateMasterKey();

function summary(overrides: Partial<Summary> = {}): Summary {
  return {
    dryRun: false,
    currentKekId: "k1",
    total: 2,
    rewrapped: 1,
    unchanged: 1,
    skipped: 0,
    failed: 0,
    rows: [],
    ...overrides,
  };
}

function setup(options: {
  signing?: Partial<ReturnType<ReencryptCliDeps["readSigning"]>>;
  result?: Summary | Error;
}) {
  const out: string[] = [];
  const err: string[] = [];
  const reencrypt = vi.fn(async () => {
    if (options.result instanceof Error) throw options.result;
    return options.result ?? summary();
  });
  const deps: ReencryptCliDeps = {
    readSigning: () => ({
      masterKey: KEY,
      masterKeyId: undefined,
      masterKeyPrevious: undefined,
      ...options.signing,
    }),
    reencrypt,
    log: (line) => out.push(line),
    error: (line) => err.push(line),
  };
  return { deps, reencrypt, out, err };
}

describe("REQ-B4A-2: the reencrypt-signing-credentials command line", () => {
  it("exits 0 when every credential was re-encrypted or already current, and passes --dry-run through", async () => {
    const live = setup({});
    expect(await runReencryptCli([], live.deps)).toBe(0);
    expect(live.reencrypt).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: false }),
    );

    const dry = setup({ result: summary({ dryRun: true }) });
    expect(await runReencryptCli(["--dry-run"], dry.deps)).toBe(0);
    expect(dry.reencrypt).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
    );
    expect(dry.out.at(-1)).toContain("[dry run]");
  });

  it("exits NON-ZERO when any credential failed, and says so", async () => {
    const run = setup({
      result: summary({
        failed: 1,
        rows: [
          {
            id: 7,
            organizationId: "org-a",
            unitId: 1,
            serialNumber: "S-1",
            outcome: "failed",
            from: "k0",
            to: "k1",
            error: "sealed under KEK k0, which is not configured",
          },
        ],
      }),
    });
    expect(await runReencryptCli([], run.deps)).toBe(1);
    expect(run.out.join("\n")).toContain("failed 1");
    expect(run.out.join("\n")).toContain("credential 7");
  });

  it("exits non-zero when the sweep itself throws, without printing the error message (it may carry ciphertext)", async () => {
    const run = setup({
      result: new Error("Failed query: update ... params: enc:v2:k1:SECRET"),
    });
    expect(await runReencryptCli([], run.deps)).toBe(1);
    expect(run.err.join("\n")).not.toContain("SECRET");
  });

  it("a misconfigured key ring stops it with exit 1 and never echoes the key, even when it is in the wrong place", async () => {
    const cases = [
      // reversed id:key entry
      { masterKeyPrevious: `${OTHER_KEY}:k0` },
      // the key pasted into the id setting
      { masterKeyId: OTHER_KEY },
      // an id colliding with the current one
      { masterKeyId: "k0", masterKeyPrevious: `k0:${OTHER_KEY}` },
    ];
    for (const signing of cases) {
      const run = setup({ signing });
      expect(await runReencryptCli([], run.deps), JSON.stringify(signing)).toBe(
        1,
      );
      expect(run.reencrypt).not.toHaveBeenCalled();
      const printed = [...run.out, ...run.err].join("\n");
      expect(printed).toContain("SIGNING_MASTER_KEY");
      expect(printed).not.toContain(OTHER_KEY);
      expect(printed).not.toContain(KEY);
    }
  });

  it("exits 1 without a master key, and on unknown arguments", async () => {
    const none = setup({ signing: { masterKey: undefined } });
    expect(await runReencryptCli([], none.deps)).toBe(1);
    expect(none.reencrypt).not.toHaveBeenCalled();
    const bad = setup({});
    expect(await runReencryptCli(["--nope"], bad.deps)).toBe(1);
    expect(bad.reencrypt).not.toHaveBeenCalled();
  });
});
