import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import os from "node:os";
import path from "node:path";

import { openLocalDatabase, type LocalDatabase } from "@calibra-facil/local-db";
import { afterEach, describe, expect, it } from "vitest";

import type { LocalServerConfig } from "../bootstrap";
import { createLocalServer } from "../server";
import { PrinterTransportError } from "./errors";
import { sendCommandsOverNetwork } from "./network-transport";
import { sendToPrinter } from "./transport-types";

const tempDirectories: string[] = [];

function openTempDatabase(): LocalDatabase {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-printing-"));
  tempDirectories.push(directory);
  return openLocalDatabase({
    filePath: path.join(directory, "calibra.sqlite"),
  });
}

function createConfig(): LocalServerConfig {
  return {
    host: "127.0.0.1",
    port: 4317,
    appVersion: "test",
    localServerVersion: "test",
    dbPath: ":memory:",
    storageRoot: path.join(os.tmpdir(), "calibra-printing-files"),
    deviceId: "device-test",
    tenantId: null,
    organizationId: "org-1",
    unitId: 1,
    userId: "user-1",
    syncEnabled: false,
    bootstrapToken: null,
    cloudApiUrl: null,
    cloudAuthToken: null,
    cloudProxyToken: null,
    desktopRunId: "desktop-test-run",
    localServerRunId: "local-server-test-run",
  };
}

type CaptureServer = {
  port: number;
  received: Promise<string>;
  close: () => void;
};

async function startCaptureServer(): Promise<CaptureServer> {
  const chunks: Buffer[] = [];
  let resolveReceived: (value: string) => void = () => {};
  const received = new Promise<string>((resolve) => {
    resolveReceived = resolve;
  });

  const server: Server = createServer((socket) => {
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () =>
      resolveReceived(Buffer.concat(chunks).toString("latin1")),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;

  return {
    port,
    received,
    close: () => server.close(),
  };
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("network transport", () => {
  it("writes ZPL bytes to a TCP socket", async () => {
    const server = await startCaptureServer();
    const bytes = await sendCommandsOverNetwork(
      "127.0.0.1",
      server.port,
      "^XA^XZ",
    );
    expect(bytes).toBe(6);
    expect(await server.received).toBe("^XA^XZ");
    server.close();
  });

  it("rejects with CONNECTION_REFUSED on a closed port", async () => {
    const server = await startCaptureServer();
    const port = server.port;
    server.close();
    await new Promise((resolve) => setTimeout(resolve, 20));

    await expect(
      sendCommandsOverNetwork("127.0.0.1", port, "^XA^XZ", 2_000),
    ).rejects.toMatchObject({ code: "CONNECTION_REFUSED" });
  });

  it("dispatches network profiles and rejects usb/serial", async () => {
    const server = await startCaptureServer();
    await sendToPrinter(
      {
        id: "p",
        name: "Zebra",
        connection: { type: "network", host: "127.0.0.1", port: server.port },
        language: "zpl",
        dpi: 203,
        darkness: 15,
        speed: 4,
        widthDots: 400,
        heightDots: 240,
        offsets: { xDots: 0, yDots: 0 },
        isDefault: true,
      },
      "^XAtest^XZ",
    );
    expect(await server.received).toBe("^XAtest^XZ");
    server.close();

    await expect(
      sendToPrinter(
        {
          id: "u",
          name: "USB Zebra",
          connection: { type: "usb", vendorId: 0x0a5f, productId: 1 },
          language: "zpl",
          dpi: 203,
          darkness: 15,
          speed: 4,
          widthDots: 400,
          heightDots: 240,
          offsets: { xDots: 0, yDots: 0 },
          isDefault: false,
        },
        "^XA^XZ",
      ),
    ).rejects.toBeInstanceOf(PrinterTransportError);
  });
});

describe("printer routes", () => {
  it("creates, lists and deletes profiles", async () => {
    const app = createLocalServer(createConfig(), openTempDatabase());

    const created = await app.fetch(
      new Request("http://127.0.0.1/api/printer/profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Bench Zebra",
          connection: { type: "network", host: "192.168.0.10" },
          dpi: 203,
        }),
      }),
    );
    expect(created.status).toBe(200);
    const createdBody: unknown = await created.json();
    const profileId =
      typeof createdBody === "object" &&
      createdBody !== null &&
      "profile" in createdBody &&
      typeof createdBody.profile === "object" &&
      createdBody.profile !== null &&
      "id" in createdBody.profile &&
      typeof createdBody.profile.id === "string"
        ? createdBody.profile.id
        : "";
    expect(profileId).not.toBe("");

    const listed = await app.fetch(
      new Request("http://127.0.0.1/api/printer/profiles"),
    );
    const listedBody: unknown = await listed.json();
    expect(JSON.stringify(listedBody)).toContain("Bench Zebra");

    const deleted = await app.fetch(
      new Request(`http://127.0.0.1/api/printer/profiles/${profileId}`, {
        method: "DELETE",
      }),
    );
    expect(deleted.status).toBe(200);
  });

  it("requires ZPL and a printer to print", async () => {
    const app = createLocalServer(createConfig(), openTempDatabase());

    const missingZpl = await app.fetch(
      new Request("http://127.0.0.1/api/printer/print", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jobId: 1,
          profile: {
            id: "p",
            name: "Z",
            connection: { type: "network", host: "x" },
            dpi: 203,
          },
        }),
      }),
    );
    expect(missingZpl.status).toBe(422);
  });

  it("prints ZPL to a configured network printer", async () => {
    const server = await startCaptureServer();
    const app = createLocalServer(createConfig(), openTempDatabase());

    const response = await app.fetch(
      new Request("http://127.0.0.1/api/printer/print", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commands: "^XAhello^XZ",
          profile: {
            id: "p",
            name: "Bench Zebra",
            connection: {
              type: "network",
              host: "127.0.0.1",
              port: server.port,
            },
            dpi: 203,
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ success: true });
    expect(await server.received).toBe("^XAhello^XZ");
    server.close();
  });
});
