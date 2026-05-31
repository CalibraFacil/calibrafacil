import type { PrinterProfile } from "@calibra-facil/schemas";

import { sendCommandsOverNetwork } from "./network-transport";
import { sendCommandsOverSerial } from "./serial-transport";
import { sendCommandsOverUsb } from "./usb-transport";

/**
 * Send printer commands (ZPL/TSPL — opaque bytes here) to a printer using the
 * transport described by its profile. Returns the number of bytes written.
 */
export async function sendToPrinter(
  profile: PrinterProfile,
  commands: string,
): Promise<number> {
  const { connection } = profile;
  switch (connection.type) {
    case "network":
      return sendCommandsOverNetwork(
        connection.host,
        connection.port,
        commands,
      );
    case "usb":
      return sendCommandsOverUsb(connection, commands);
    case "serial":
      return sendCommandsOverSerial(connection, commands);
  }
}
