/** A printer transport failure with a stable machine code + a pt-BR message. */
export class PrinterTransportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PrinterTransportError";
    this.code = code;
  }
}
