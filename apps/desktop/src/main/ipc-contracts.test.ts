import { describe, expect, it } from "vitest";
import { desktopIpcChannels } from "./channels";
import {
  desktopIpcEventContracts,
  desktopIpcInvokeContracts,
} from "./ipc-contracts";

describe("desktop IPC contracts", () => {
  it("assigns every IPC channel to an invocation or event schema", () => {
    const invokeChannels = Object.keys(desktopIpcInvokeContracts).sort();
    const eventChannels = Object.keys(desktopIpcEventContracts).sort();
    const contractedChannels = [...invokeChannels, ...eventChannels].sort();

    expect(contractedChannels).toEqual(
      Object.values(desktopIpcChannels).sort(),
    );
  });

  it("validates bridge request and response payloads", () => {
    const authFetchContract =
      desktopIpcInvokeContracts[desktopIpcChannels.authFetch];
    expect(() =>
      authFetchContract.args.parse([
        {
          url: "https://api.calibrafacil.com/api/sync/bootstrap",
          method: "POST",
          headers: [["content-type", "application/json"]],
          body: null,
        },
      ]),
    ).not.toThrow();
    expect(() =>
      authFetchContract.args.parse([
        {
          url: "not-a-url",
          method: "GET",
          headers: [],
          body: null,
        },
      ]),
    ).toThrow();

    const updateContract =
      desktopIpcInvokeContracts[desktopIpcChannels.getUpdateState];
    expect(() =>
      updateContract.response.parse({
        status: "downloaded",
        version: "1.2.3",
      }),
    ).not.toThrow();
    expect(() =>
      updateContract.response.parse({
        status: "installed-without-sync-check",
      }),
    ).toThrow();
  });
});
