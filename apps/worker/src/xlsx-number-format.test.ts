import assert from "node:assert/strict";
import { fractionDigitsOf, formatNumberForXlsx } from "./xlsx-number-format.js";

// fractionDigitsOf — locale-independent, exact. The original bug: for 5e-7,
// String(5e-7).split(".")[1] is undefined, so the old code used 1 decimal.
assert.equal(fractionDigitsOf(5e-7), 7);
assert.equal(fractionDigitsOf(1e-9), 9);
assert.equal(fractionDigitsOf(2), 0);
assert.equal(fractionDigitsOf(9999.99), 2);
assert.equal(fractionDigitsOf(1.000061), 6);
assert.equal(fractionDigitsOf(0.0110000000004), 13);

// formatNumberForXlsx (pt-BR). Regression: sub-microgram scientific-notation
// values must NOT collapse to "0,0".
const tiny = formatNumberForXlsx(5e-7);
assert.notEqual(tiny, "0,0");
assert.match(tiny, /^0,\d{6}$/);

assert.equal(formatNumberForXlsx(6e-7), "0,000001");
assert.equal(formatNumberForXlsx(9999.99), "9999,99");
assert.equal(formatNumberForXlsx(20000.46), "20000,46");
assert.equal(formatNumberForXlsx(1.000061), "1,000061");
assert.equal(formatNumberForXlsx(0.05), "0,05");
assert.equal(formatNumberForXlsx(2), "2");
assert.equal(formatNumberForXlsx(20000, 0), "20000"); // explicit fractionDigits honored

console.log("xlsx-number-format tests passed");
