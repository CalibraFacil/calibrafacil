import type { PrinterDiscoverResult } from "@calibra-facil/schemas";

// Zebra's USB vendor id. Discovery focuses on Zebra (our supported family); other
// ZPL printers can still be added by entering their vendor/product id manually.
const ZEBRA_VENDOR_ID = 0x0a5f;

async function discoverUsb(): Promise<PrinterDiscoverResult["usb"]> {
  try {
    const usbModule = await import("usb");
    return usbModule
      .getDeviceList()
      .filter((device) => device.deviceDescriptor.idVendor === ZEBRA_VENDOR_ID)
      .map((device) => ({
        vendorId: device.deviceDescriptor.idVendor,
        productId: device.deviceDescriptor.idProduct,
      }));
  } catch {
    return [];
  }
}

async function discoverSerial(): Promise<PrinterDiscoverResult["serial"]> {
  try {
    const { SerialPort } = await import("serialport");
    const ports = await SerialPort.list();
    return ports.map((port) => ({
      path: port.path,
      manufacturer: port.manufacturer ?? undefined,
    }));
  } catch {
    return [];
  }
}

/** Enumerate attached Zebra USB printers and serial ports. */
export async function discoverPrinters(): Promise<PrinterDiscoverResult> {
  const [usb, serial] = await Promise.all([discoverUsb(), discoverSerial()]);
  return { usb, serial };
}
