import { PrinterTransportError } from "./errors";

// serialport is a native module; import it lazily (see usb-transport.ts).
async function loadSerial() {
  try {
    return await import("serialport");
  } catch (error) {
    throw new PrinterTransportError(
      "SERIAL_UNAVAILABLE",
      `Suporte a serial indisponível: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Send printer commands to a serial printer: open the port, write, drain (wait
 * for the bytes to leave the buffer), then close.
 */
export async function sendCommandsOverSerial(
  connection: { path: string; baudRate: number },
  commands: string,
): Promise<number> {
  const { SerialPort } = await loadSerial();
  const payload = Buffer.from(commands, "latin1");

  return new Promise<number>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(
        new PrinterTransportError(
          "SERIAL_ERROR",
          `Falha na impressão serial (${connection.path}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
    };

    const port = new SerialPort(
      { path: connection.path, baudRate: connection.baudRate },
      (openError) => {
        if (openError) {
          fail(openError);
          return;
        }
        port.write(payload, (writeError) => {
          if (writeError) {
            port.close(() => {});
            fail(writeError);
            return;
          }
          port.drain((drainError) => {
            port.close(() => {
              if (settled) return;
              if (drainError) {
                fail(drainError);
                return;
              }
              settled = true;
              resolve(payload.byteLength);
            });
          });
        });
      },
    );

    port.on("error", fail);
  });
}
