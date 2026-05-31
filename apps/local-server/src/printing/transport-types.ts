import type { PrinterProfile } from "@calibra-facil/schemas";

import { sendZplOverNetwork } from "./network-transport";
import { sendZplOverSerial } from "./serial-transport";
import { sendZplOverUsb } from "./usb-transport";

/**
 * Send ZPL to a printer using the transport described by its profile. Returns
 * the number of bytes written.
 */
export async function sendToPrinter(
  profile: PrinterProfile,
  zpl: string,
): Promise<number> {
  const { connection } = profile;
  switch (connection.type) {
    case "network":
      return sendZplOverNetwork(connection.host, connection.port, zpl);
    case "usb":
      return sendZplOverUsb(connection, zpl);
    case "serial":
      return sendZplOverSerial(connection, zpl);
  }
}
