/**
 * Encoding a request body for the desktop cloud-auth IPC bridge.
 *
 * Every non-GET cloud request from the desktop renderer crosses a
 * `contextBridge` boundary, which carries strings rather than streams. So the
 * body is buffered, base64-encoded, and sent whole — and that has a cost the
 * previous implementation did not bound.
 *
 * A body of N bytes briefly occupies roughly **3.3 N** in the renderer: the
 * `ArrayBuffer`, the intermediate binary string, and the base64 output — then
 * another copy as it is serialized across IPC. An unbounded upload therefore
 * ends in an out-of-memory crash of the whole window rather than a failed
 * request.
 *
 * The cap is deliberately above every server-side limit (the largest the API
 * accepts is 25 MB), so an oversized-but-plausible file still gets the API's
 * own message. This guard only catches what would otherwise take the renderer
 * down with it.
 */

export const DESKTOP_REQUEST_BODY_LIMIT_BYTES = 32 * 1024 * 1024

/**
 * `String.fromCharCode` is applied to slices rather than the whole array: it
 * takes its bytes as individual arguments, and spreading megabytes of them
 * overflows the call stack.
 */
const BINARY_CHUNK_SIZE = 0x8000

export class DesktopRequestBodyTooLargeError extends Error {
  constructor(readonly byteLength: number) {
    super(
      `O arquivo tem ${formatMegabytes(byteLength)} MB e excede o limite de ${formatMegabytes(
        DESKTOP_REQUEST_BODY_LIMIT_BYTES,
      )} MB para envio pelo aplicativo desktop.`,
    )
    this.name = 'DesktopRequestBodyTooLargeError'
  }
}

function formatMegabytes(bytes: number) {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10
}

/**
 * Reject an oversized body *before* it is buffered.
 *
 * The size check inside `encodeDesktopRequestBody` runs on an `ArrayBuffer`
 * that already exists — by then the renderer has allocated the very memory the
 * limit was meant to protect. Callers that can learn the size beforehand (a
 * `Content-Length`, a `Blob.size`) should use this instead, and treat the
 * later check as the backstop it is.
 *
 * A null size means the length is genuinely unknown, and there is nothing to
 * decide on yet.
 */
export function assertDesktopRequestBodyWithinLimit(
  byteLength: number | null,
  limitBytes: number = DESKTOP_REQUEST_BODY_LIMIT_BYTES,
): void {
  if (byteLength === null) return
  if (byteLength <= limitBytes) return

  throw new DesktopRequestBodyTooLargeError(byteLength)
}

export function encodeDesktopRequestBody(
  buffer: ArrayBuffer,
  limitBytes: number = DESKTOP_REQUEST_BODY_LIMIT_BYTES,
): string {
  if (buffer.byteLength > limitBytes) {
    throw new DesktopRequestBodyTooLargeError(buffer.byteLength)
  }

  const bytes = new Uint8Array(buffer)
  let binary = ''

  for (let index = 0; index < bytes.length; index += BINARY_CHUNK_SIZE) {
    binary += String.fromCharCode(
      ...bytes.subarray(index, index + BINARY_CHUNK_SIZE),
    )
  }

  return btoa(binary)
}
