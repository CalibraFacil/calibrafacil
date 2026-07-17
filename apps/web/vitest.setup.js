// Shared vitest setup (jsdom + node suites).
//
// jsdom implements getClientRects/getBoundingClientRect on Element but NOT on
// Range. ProseMirror's scrollToSelection calls them on a Range whenever the
// caret sits inside text (coordsAtPos -> singleRect), which jsdom turns into
// an uncaught "target.getClientRects is not a function" AFTER the test body —
// every test passes but vitest exits 1. Zero-rects are fine: scroll math in
// jsdom is meaningless anyway.
const zeroRect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
}

if (typeof Range !== 'undefined') {
  if (typeof Range.prototype.getClientRects !== 'function') {
    Range.prototype.getClientRects = function getClientRects() {
      const list = []
      list.item = () => null
      return list
    }
  }
  if (typeof Range.prototype.getBoundingClientRect !== 'function') {
    Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return { ...zeroRect }
    }
  }
}
