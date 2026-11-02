"use strict";
// Base64 VLQ, the number encoding of a source map's mappings: the transpiler writes it, the local trace reads which
// ABAP line a JavaScript line came from, and a copied include's map is rewritten with it.

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// One segment of a mapping line ("AAgBC") as its numbers.
function decodeVlq(segment) {
  const values = [];
  let value = 0, shift = 0;
  for (const letter of segment) {
    const digit = BASE64.indexOf(letter);
    if (digit < 0) throw new Error("Invalid source map mapping.");
    value += (digit & 31) * 2 ** shift;
    if (digit & 32) shift += 5;
    else { values.push(value & 1 ? -(value >> 1) : value >> 1); value = 0; shift = 0; }
  }
  return values;
}

// Numbers as one segment of a mapping line.
function encodeVlq(values) {
  let text = "";
  for (const number of values) {
    let value = number < 0 ? (-number << 1) | 1 : number << 1;
    do { let digit = value & 31; value >>>= 5; if (value) digit |= 32; text += BASE64[digit]; } while (value);
  }
  return text;
}

module.exports = { decodeVlq, encodeVlq };
