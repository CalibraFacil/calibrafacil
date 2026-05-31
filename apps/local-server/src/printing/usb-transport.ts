import type { Interface, OutEndpoint } from "usb";

import { PrinterTransportError } from "./errors";

// node-usb is a native module; import it lazily so network/serial printing never
// loads it and so a missing/blocked module degrades to a clear error.
async function loadUsb() {
  try {
    return await import("usb");
  } catch (error) {
    throw new PrinterTransportError(
      "USB_UNAVAILABLE",
      `Suporte a USB indisponível: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function hex(value: number): string {
  return `0x${value.toString(16).padStart(4, "0")}`;
}

function describeUsbError(
  error: unknown,
  vendorId: number,
  productId: number,
): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/access|permission|LIBUSB_ERROR_ACCESS/i.test(message)) {
    return `Permissão negada para a impressora USB ${hex(vendorId)}:${hex(productId)}. No Linux, adicione uma regra udev para o fornecedor (ex.: SUBSYSTEM=="usb", ATTRS{idVendor}=="0a5f", MODE="0666"). Detalhe: ${message}`;
  }
  return `Falha na impressão USB ${hex(vendorId)}:${hex(productId)}: ${message}`;
}

/**
 * Send printer commands to a USB printer via node-usb: claim interface 0, find
 * the bulk OUT endpoint, transfer, then release/close. On Linux a kernel driver
 * (usblp) may own the device — detach it first.
 */
export async function sendCommandsOverUsb(
  connection: { vendorId: number; productId: number; serialNumber?: string },
  commands: string,
): Promise<number> {
  const usbModule = await loadUsb();
  const device = usbModule.findByIds(connection.vendorId, connection.productId);
  if (!device) {
    throw new PrinterTransportError(
      "DEVICE_NOT_FOUND",
      `Impressora USB ${hex(connection.vendorId)}:${hex(connection.productId)} não encontrada. Verifique a conexão.`,
    );
  }

  try {
    device.open();
    const usbInterface: Interface = device.interface(0);
    if (process.platform === "linux" && usbInterface.isKernelDriverActive()) {
      usbInterface.detachKernelDriver();
    }
    usbInterface.claim();
    try {
      const outEndpoint = usbInterface.endpoints.find(
        (endpoint): endpoint is OutEndpoint =>
          endpoint instanceof usbModule.OutEndpoint,
      );
      if (!outEndpoint) {
        throw new PrinterTransportError(
          "NO_OUT_ENDPOINT",
          "A impressora USB não expôs um endpoint de saída.",
        );
      }
      const payload = Buffer.from(commands, "latin1");
      await outEndpoint.transferAsync(payload);
      return payload.byteLength;
    } finally {
      await usbInterface.releaseAsync().catch(() => {});
    }
  } catch (error) {
    if (error instanceof PrinterTransportError) {
      throw error;
    }
    throw new PrinterTransportError(
      "USB_ERROR",
      describeUsbError(error, connection.vendorId, connection.productId),
    );
  } finally {
    try {
      device.close();
    } catch {
      // Device may not be open if it failed early; ignore.
    }
  }
}
