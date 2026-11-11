"use strict";

// Draws the transparent VERTEX mark (images/logo.png, the turning logo; the
// Marketplace icon is the galaxy in images/icon.png) and writes it as a PNG, with nothing installed:
// Node's own zlib does the compression and the rest is a few hundred bytes of
// chunk headers. 2x2 supersampling smooths the arms' edges.
//
// The mark is a spiral galaxy - a vertex is where things meet, and everything
// here spirals into one core. Three arms, one per tool: Data, Code, Version.
// The background is transparent, so the same icon reads on a dark and a light
// theme: the arms are deep colours with their glow as opacity, not light added
// to a dark sky, which on white faded to nothing.

const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const SIZE = Number(process.argv[3]) || 256;
const SS = 2;

const CORE = [0xe0, 0x8a, 0x1e];                // the core, warm amber
const HEART = [0xff, 0xd0, 0x70];               // its bright centre
const ARMS = [
  [0x1f, 0x6f, 0xc0],                           // Data
  [0x2e, 0x93, 0x46],                           // Code
  [0xc9, 0x86, 0x0c]                            // Version
];

const TWIST = 2.6;          // how tightly the arms wind: bigger is tighter
const ARM_WIDTH = 0.098;    // half width of an arm at the rim
const CORE_RADIUS = 0.11;
const HEART_RADIUS = 0.05;
const DISC = 0.62;          // the arms fade out by here
const EDGE = 0.98;          // and are gone before the image's edge, measured from the centre
const EDGE_FADE = 0.3;

function wrapAngle(a) {
  while (a > Math.PI) { a -= 2 * Math.PI; }
  while (a < -Math.PI) { a += 2 * Math.PI; }
  return a;
}

/** Paint one layer over what is there: colour and coverage, premultiplied. */
function over(pixel, colour, alpha) {
  const a = Math.max(0, Math.min(1, alpha));
  for (let c = 0; c < 3; c++) { pixel[c] = colour[c] * a + pixel[c] * (1 - a); }
  pixel[3] = a + pixel[3] * (1 - a);
}

/** One sample as premultiplied r/g/b (0..255) and coverage (0..1). */
function sample(u, v) {
  // Centre the disc and tilt it a little: a galaxy seen exactly face on looks
  // like a logo of a fan, and one seen edge on is a line.
  const x = (u - 0.5) * 2;
  const y = (v - 0.5) * 2 / 0.82;
  const r = Math.hypot(x, y);
  const theta = Math.atan2(y, x);
  const pixel = [0, 0, 0, 0];

  // Near the image's edge the arms fade out smoothly rather than being cut off by it.
  const e = Math.max(0, Math.min(1, (EDGE - Math.hypot(u - 0.5, v - 0.5) * 2) / EDGE_FADE));
  const edge = e * e * (3 - 2 * e);

  // The arms. A logarithmic spiral has theta = phi + TWIST * ln(r), so the
  // distance across an arm is the angular gap times the radius - which keeps
  // the arm about as wide near the core as at the rim. Where arms meet, their
  // colours mix by weight and their coverage adds up: painted one over another,
  // the last arm cut the one beneath it.
  if (r > 0.02) {
    const spiral = TWIST * Math.log(r);
    const mixed = [0, 0, 0];
    let weight = 0;
    let clear = 1;
    for (let k = 0; k < ARMS.length; k++) {
      const phi = (2 * Math.PI * k) / ARMS.length;
      const across = Math.abs(wrapAngle(theta - (phi + spiral))) * r;
      // The arms open out as they leave the core and fade at the rim.
      const width = ARM_WIDTH * (0.45 + r);
      const along = Math.exp(-(r * r) / (2 * DISC * DISC)) * Math.min(1, r / 0.16);
      // A little over one keeps the arms legible where the icon is drawn at
      // forty-odd pixels, which is the size that actually gets looked at.
      const glow = Math.min(1, 1.25 * Math.exp(-(across * across) / (2 * width * width))) * along * edge;
      for (let c = 0; c < 3; c++) { mixed[c] += ARMS[k][c] * glow; }
      weight += glow;
      clear *= 1 - Math.min(1, glow * 1.1);
    }
    if (weight > 0) {
      pixel[3] = 1 - clear;
      for (let c = 0; c < 3; c++) { pixel[c] = (mixed[c] / weight) * pixel[3]; }
    }
  }

  // The core last, so it sits on top of where the arms converge.
  over(pixel, CORE, 1.2 * Math.exp(-(r * r) / (2 * CORE_RADIUS * CORE_RADIUS)));
  over(pixel, HEART, Math.exp(-(r * r) / (2 * HEART_RADIUS * HEART_RADIUS)));
  return pixel;
}

function render() {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  const n = SS * SS;
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const s = sample((px + (sx + 0.5) / SS) / SIZE, (py + (sy + 0.5) / SS) / SIZE);
          for (let c = 0; c < 4; c++) { sum[c] += s[c]; }
        }
      }
      const alpha = sum[3] / n;
      const i = (py * SIZE + px) * 4;
      for (let c = 0; c < 3; c++) { pixels[i + c] = alpha ? Math.round(sum[c] / n / alpha) : 0; }
      pixels[i + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}

/* ---------- PNG ---------- */

const CRC_TABLE = (function () {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
}());

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function png(pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  ihdr[10] = 0;   // deflate
  ihdr[11] = 0;   // adaptive filtering
  ihdr[12] = 0;   // no interlace

  // Filter 1 (Sub) pays here: a gradient changes little from pixel to pixel.
  const stride = SIZE * 4;
  const raw = Buffer.alloc(SIZE * (stride + 1));
  for (let y = 0; y < SIZE; y++) {
    const at = y * (stride + 1);
    raw[at] = 1;
    for (let x = 0; x < stride; x++) {
      const here = pixels[y * stride + x];
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      raw[at + 1 + x] = (here - left) & 0xff;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const out = process.argv[2];
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png(render()));
console.log("wrote " + out + ", " + fs.statSync(out).size + " bytes, " + SIZE + "x" + SIZE);
