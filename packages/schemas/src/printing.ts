import { z } from "zod";

// =============================================================================
// THERMAL LABEL PRINTING SCHEMAS — Zebra / ZPL printers
// =============================================================================
//
// A "printer profile" describes how to reach a thermal printer (connection) and
// how to lay out a label on it (dpi/darkness/speed/dimensions/offsets). Profiles
// live in the local-server SQLite store (desktop) or are selected client-side
// (cloud + Zebra Browser Print). The pure @calibra-facil/label-zpl builder reads
// the layout fields; the transport adapters read the connection.

/**
 * Supported printer resolutions (dots per inch). Zebra desktop units are 203 or
 * 300 dpi; the ZPL dot math for the 50×30 mm calibration label depends on it.
 */
export const PrinterDpiSchema = z.union([z.literal(203), z.literal(300)]);
export type PrinterDpi = z.infer<typeof PrinterDpiSchema>;

/**
 * How to physically reach the printer. Discriminated on `type` so each transport
 * carries exactly the fields it needs.
 */
export const PrinterConnectionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("network"),
    host: z.string().trim().min(1, "Endereço do host é obrigatório"),
    // Raw socket port — Zebra/ZPL listens on 9100 by default.
    port: z.coerce.number().int().min(1).max(65535).default(9100),
  }),
  z.object({
    type: z.literal("usb"),
    vendorId: z.coerce.number().int().min(0).max(0xffff),
    productId: z.coerce.number().int().min(0).max(0xffff),
    serialNumber: z.string().trim().optional(),
  }),
  z.object({
    type: z.literal("serial"),
    path: z.string().trim().min(1, "Porta serial é obrigatória"),
    baudRate: z.coerce.number().int().positive().default(9600),
  }),
]);
export type PrinterConnection = z.infer<typeof PrinterConnectionSchema>;
export type PrinterConnectionType = PrinterConnection["type"];

/**
 * Label-home offset in dots, for top-of-form calibration (maps to ZPL `^LH`).
 */
export const PrinterOffsetsSchema = z
  .object({
    xDots: z.coerce.number().int().default(0),
    yDots: z.coerce.number().int().default(0),
  })
  .default({ xDots: 0, yDots: 0 });
export type PrinterOffsets = z.infer<typeof PrinterOffsetsSchema>;

/**
 * A saved printer configuration. `widthDots`/`heightDots` describe the media in
 * dots (50×30 mm ⇒ 400×240 @203 dpi, 591×354 @300 dpi).
 */
export const PrinterProfileSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1, "Nome da impressora é obrigatório"),
  connection: PrinterConnectionSchema,
  dpi: PrinterDpiSchema,
  // ~SD darkness (0–30) and ^PR print speed (1–14 ips); conservative defaults.
  darkness: z.coerce.number().int().min(0).max(30).default(15),
  speed: z.coerce.number().int().min(1).max(14).default(4),
  widthDots: z.coerce.number().int().positive().default(400),
  heightDots: z.coerce.number().int().positive().default(240),
  offsets: PrinterOffsetsSchema,
  isDefault: z.boolean().default(false),
});
export type PrinterProfile = z.infer<typeof PrinterProfileSchema>;

/**
 * Input for saving a profile (id/isDefault assigned server-side).
 */
export const SavePrinterProfileSchema = PrinterProfileSchema.omit({
  id: true,
  isDefault: true,
}).extend({
  id: z.string().trim().min(1).optional(),
  isDefault: z.boolean().optional(),
});
// Request shape: defaulted fields (darkness/speed/dimensions/offsets) are
// optional for callers, so use the schema's *input* type.
export type SavePrinterProfileInput = z.input<typeof SavePrinterProfileSchema>;

/**
 * A print request: either raw `zpl` to send verbatim or a `jobId` to render
 * server-side; targeting either a saved `profileId` or an inline `profile`.
 */
export const PrintLabelRequestSchema = z
  .object({
    jobId: z.union([z.string(), z.coerce.number()]).optional(),
    zpl: z.string().optional(),
    // Target printer: a saved profileId, an inline profile, or neither (the
    // server falls back to the configured default printer).
    profileId: z.string().trim().optional(),
    profile: PrinterProfileSchema.optional(),
  })
  .refine((value) => value.jobId !== undefined || value.zpl !== undefined, {
    message: "Informe jobId ou zpl",
  });
export type PrintLabelRequest = z.infer<typeof PrintLabelRequestSchema>;

/** A "print a test label" request: just which printer to target. */
export const PrintTestRequestSchema = z.object({
  profileId: z.string().trim().optional(),
  profile: PrinterProfileSchema.optional(),
});
export type PrintTestRequest = z.infer<typeof PrintTestRequestSchema>;

export const PrintResultSchema = z.object({
  success: z.boolean(),
  bytesSent: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});
export type PrintResult = z.infer<typeof PrintResultSchema>;

export const DiscoveredUsbPrinterSchema = z.object({
  vendorId: z.number().int(),
  productId: z.number().int(),
  manufacturer: z.string().optional(),
  product: z.string().optional(),
  serialNumber: z.string().optional(),
});

export const DiscoveredSerialPortSchema = z.object({
  path: z.string(),
  manufacturer: z.string().optional(),
});

export const PrinterDiscoverResultSchema = z.object({
  usb: z.array(DiscoveredUsbPrinterSchema),
  serial: z.array(DiscoveredSerialPortSchema),
});
export type PrinterDiscoverResult = z.infer<typeof PrinterDiscoverResultSchema>;
