import type { PrinterProfile } from "@calibra-facil/schemas";

import { PrinterTransportError } from "./errors";
import { sendZplOverNetwork } from "./network-transport";

/**
 * Send ZPL to a printer using the transport described by its profile. Returns
 * the number of bytes written. USB/serial are stubbed until Phase 3 (native
 * modules); network printing works today with zero packaging changes.
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
    case "serial":
      throw new PrinterTransportError(
        "UNSUPPORTED_TRANSPORT",
        `A conexão "${connection.type}" será habilitada em uma próxima versão. Use uma impressora de rede (TCP/IP) por enquanto.`,
      );
  }
}
