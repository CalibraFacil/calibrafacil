/**
 * The image type of an upload, read from its first bytes (roadmap 2 D3, review
 * 3.3), never from the type the client declared. Only raster formats: an SVG can
 * carry script and markup, and a laboratory logo ends up embedded in certificates.
 */
export type RasterImageType = "image/png" | "image/jpeg" | "image/webp";

export function sniffRasterImage(bytes: ArrayBuffer): RasterImageType | null {
  const head = new Uint8Array(bytes.slice(0, 12));
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // RIFF....WEBP
  if (
    startsWith(head, [0x52, 0x49, 0x46, 0x46]) &&
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]) {
  return prefix.every((byte, index) => bytes[index] === byte);
}
