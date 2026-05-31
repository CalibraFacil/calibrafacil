import { Socket } from "node:net";

import { PrinterTransportError } from "./errors";

// Zebra/ZPL printers accept raw bytes on TCP port 9100. We open a socket, write
// the ZPL, flush, and close. No driver, no spooler — the most reliable path for
// a shared LAN label printer.

const DEFAULT_TIMEOUT_MS = 10_000;

function nodeErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function describeSocketError(
  error: unknown,
  host: string,
  port: number,
): PrinterTransportError {
  switch (nodeErrorCode(error)) {
    case "ECONNREFUSED":
      return new PrinterTransportError(
        "CONNECTION_REFUSED",
        `A impressora recusou a conexão em ${host}:${port}. Verifique se está ligada e aceitando ZPL na porta ${port}.`,
      );
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return new PrinterTransportError(
        "HOST_UNREACHABLE",
        `Não foi possível alcançar ${host}:${port}. Verifique a rede e o IP da impressora.`,
      );
    case "ETIMEDOUT":
      return new PrinterTransportError(
        "TIMEOUT",
        `Tempo de conexão esgotado ao conectar em ${host}:${port}.`,
      );
    default:
      return new PrinterTransportError(
        "CONNECTION_FAILED",
        `Falha ao conectar em ${host}:${port}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
  }
}

/**
 * Send printer commands to a network printer. Resolves with the number of bytes
 * written, or rejects with a {@link PrinterTransportError}.
 */
export function sendCommandsOverNetwork(
  host: string,
  port: number,
  commands: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<number> {
  return new Promise((resolve, reject) => {
    // Commands are single-byte (ASCII / hex-escaped), so latin1 maps each code
    // unit to one byte without mangling.
    const payload = Buffer.from(commands, "latin1");
    const socket = new Socket();
    let settled = false;

    const settle = (error: PrinterTransportError | null, bytes: number = 0) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve(bytes);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.once("timeout", () =>
      settle(
        new PrinterTransportError(
          "TIMEOUT",
          `Tempo de conexão esgotado ao conectar em ${host}:${port}.`,
        ),
      ),
    );
    socket.once("error", (error) =>
      settle(describeSocketError(error, host, port)),
    );
    socket.connect(port, host, () => {
      socket.write(payload, (writeError) => {
        if (writeError) {
          settle(describeSocketError(writeError, host, port));
          return;
        }
        socket.end(() => settle(null, payload.byteLength));
      });
    });
  });
}
