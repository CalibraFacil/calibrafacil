import { describe, expect, it, vi } from "vitest";

// Shared, hoisted fakes for the native modules so we can assert the call
// sequence without real hardware.
const usbMock = vi.hoisted(() => {
  const calls: string[] = [];
  class OutEndpoint {
    transferAsync = async (buffer: Buffer): Promise<number> => {
      calls.push(`transfer:${buffer.length}`);
      return buffer.length;
    };
  }
  const outEndpoint = new OutEndpoint();
  const usbInterface = {
    isKernelDriverActive: () => true,
    detachKernelDriver: () => calls.push("detach"),
    claim: () => calls.push("claim"),
    endpoints: [outEndpoint],
    releaseAsync: async () => {
      calls.push("release");
    },
  };
  const device = {
    open: () => calls.push("open"),
    interface: () => {
      calls.push("interface");
      return usbInterface;
    },
    close: () => calls.push("close"),
  };
  const deviceList = [
    { deviceDescriptor: { idVendor: 0x0a5f, idProduct: 0x0001 } },
    { deviceDescriptor: { idVendor: 0x1234, idProduct: 0x5678 } },
  ];
  return { calls, OutEndpoint, device, deviceList };
});

const serialMock = vi.hoisted(() => {
  const calls: string[] = [];
  class SerialPort {
    constructor(
      options: { path: string; baudRate: number },
      openCallback: (error: Error | null) => void,
    ) {
      calls.push(`open:${options.path}@${options.baudRate}`);
      queueMicrotask(() => openCallback(null));
    }
    write(buffer: Buffer, cb: (error?: Error | null) => void) {
      calls.push(`write:${buffer.length}`);
      cb(null);
      return true;
    }
    drain(cb: (error?: Error | null) => void) {
      calls.push("drain");
      cb(null);
    }
    close(cb: (error?: Error | null) => void) {
      calls.push("close");
      cb(null);
    }
    on() {
      return this;
    }
    static list = async () => [
      { path: "/dev/ttyUSB0", manufacturer: "Zebra Technologies" },
    ];
  }
  return { calls, SerialPort };
});

vi.mock("usb", () => ({
  findByIds: () => usbMock.device,
  getDeviceList: () => usbMock.deviceList,
  OutEndpoint: usbMock.OutEndpoint,
}));

vi.mock("serialport", () => ({ SerialPort: serialMock.SerialPort }));

const { sendZplOverUsb } = await import("./usb-transport");
const { sendZplOverSerial } = await import("./serial-transport");
const { sendToPrinter } = await import("./transport-types");
const { discoverPrinters } = await import("./discovery");

describe("usb transport", () => {
  it("claims, detaches the kernel driver, transfers, then releases/closes", async () => {
    usbMock.calls.length = 0;
    const bytes = await sendZplOverUsb(
      { vendorId: 0x0a5f, productId: 0x0001 },
      "^XA^XZ",
    );
    expect(bytes).toBe(6);
    expect(usbMock.calls).toEqual([
      "open",
      "interface",
      "detach",
      "claim",
      "transfer:6",
      "release",
      "close",
    ]);
  });
});

describe("serial transport", () => {
  it("opens, writes, drains and closes", async () => {
    serialMock.calls.length = 0;
    const bytes = await sendZplOverSerial(
      { path: "/dev/ttyUSB0", baudRate: 9600 },
      "^XA^XZ",
    );
    expect(bytes).toBe(6);
    expect(serialMock.calls).toEqual([
      "open:/dev/ttyUSB0@9600",
      "write:6",
      "drain",
      "close",
    ]);
  });
});

describe("transport dispatcher", () => {
  it("routes usb + serial profiles to their transports", async () => {
    usbMock.calls.length = 0;
    await sendToPrinter(
      {
        id: "u",
        name: "USB",
        connection: { type: "usb", vendorId: 0x0a5f, productId: 1 },
        dpi: 203,
        darkness: 15,
        speed: 4,
        widthDots: 400,
        heightDots: 240,
        offsets: { xDots: 0, yDots: 0 },
        isDefault: false,
      },
      "^XA^XZ",
    );
    expect(usbMock.calls).toContain("transfer:6");
  });
});

describe("discovery", () => {
  it("filters USB to Zebra and lists serial ports", async () => {
    const result = await discoverPrinters();
    expect(result.usb).toEqual([{ vendorId: 0x0a5f, productId: 0x0001 }]);
    expect(result.serial).toEqual([
      { path: "/dev/ttyUSB0", manufacturer: "Zebra Technologies" },
    ]);
  });
});
