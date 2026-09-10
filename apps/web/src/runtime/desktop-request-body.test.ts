import { describe, expect, it } from 'vitest'

import {
  assertDesktopRequestBodyWithinLimit,
  DESKTOP_REQUEST_BODY_LIMIT_BYTES,
  DesktopRequestBodyTooLargeError,
  encodeDesktopRequestBody,
} from './desktop-request-body'

function bufferOf(bytes: number[]) {
  return new Uint8Array(bytes).buffer
}

function decode(base64: string) {
  return [...atob(base64)].map((character) => character.charCodeAt(0))
}

describe('encodeDesktopRequestBody', () => {
  it('round-trips an ASCII body', () => {
    const bytes = [...'{"nome":"Exemplo"}'].map((c) => c.charCodeAt(0))

    expect(decode(encodeDesktopRequestBody(bufferOf(bytes)))).toEqual(bytes)
  })

  it('round-trips arbitrary binary, including the high bytes', () => {
    // Photos and PDFs are the real payloads here; a signed-byte bug would
    // corrupt them silently.
    const bytes = Array.from({ length: 256 }, (_, index) => index)

    expect(decode(encodeDesktopRequestBody(bufferOf(bytes)))).toEqual(bytes)
  })

  it('round-trips a body spanning several chunks', () => {
    // The encoder slices at 32 KiB; a boundary bug shows up as a corrupted
    // upload rather than an error.
    const bytes = Array.from({ length: 0x8000 * 2 + 7 }, (_, i) => i % 256)

    expect(decode(encodeDesktopRequestBody(bufferOf(bytes)))).toEqual(bytes)
  })

  it('round-trips exactly one chunk', () => {
    const bytes = Array.from({ length: 0x8000 }, (_, i) => i % 256)

    expect(decode(encodeDesktopRequestBody(bufferOf(bytes)))).toEqual(bytes)
  })

  it('encodes an empty body as an empty string', () => {
    expect(encodeDesktopRequestBody(bufferOf([]))).toBe('')
  })

  it('rejects a body that would take the renderer down with it', () => {
    // Buffering N bytes costs roughly 3.3 N in the renderer before IPC copies
    // it again; unbounded, that is an out-of-memory crash of the window.
    expect(() => encodeDesktopRequestBody(bufferOf([1, 2, 3]), 2)).toThrow(
      DesktopRequestBodyTooLargeError,
    )
  })

  it('accepts a body exactly at the limit', () => {
    expect(() => encodeDesktopRequestBody(bufferOf([1, 2]), 2)).not.toThrow()
  })

  it('reports the size and the limit in the message', () => {
    // The operator needs to know their file is too big, not that something
    // failed.
    const oversize = new ArrayBuffer(DESKTOP_REQUEST_BODY_LIMIT_BYTES + 1)

    expect(() => encodeDesktopRequestBody(oversize)).toThrow(/32 MB/)
  })

  it('stays above every server-side upload limit', () => {
    // The largest the API accepts is 25 MB. If this guard were lower, the
    // desktop would reject files the web app happily uploads — a parity bug
    // introduced by a safety check.
    expect(DESKTOP_REQUEST_BODY_LIMIT_BYTES).toBeGreaterThan(25 * 1024 * 1024)
  })
})

describe('assertDesktopRequestBodyWithinLimit', () => {
  it('rejects before anything is buffered', () => {
    // The check inside the encoder runs on a buffer that already exists — by
    // then the renderer has allocated the memory the limit exists to protect.
    expect(() =>
      assertDesktopRequestBodyWithinLimit(DESKTOP_REQUEST_BODY_LIMIT_BYTES + 1),
    ).toThrow(DesktopRequestBodyTooLargeError)
  })

  it('accepts a body at the limit', () => {
    expect(() =>
      assertDesktopRequestBodyWithinLimit(DESKTOP_REQUEST_BODY_LIMIT_BYTES),
    ).not.toThrow()
  })

  it('says nothing when the size is genuinely unknown', () => {
    // A streamed body of unknown length; the encoder's check is the backstop.
    expect(() => assertDesktopRequestBodyWithinLimit(null)).not.toThrow()
  })
})
