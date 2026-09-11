"use strict";

// Draws the extension icon and writes it as a PNG, with nothing installed:
// Node's own zlib does the compression and the rest is a few hundred bytes of
// chunk headers. The field is smooth, so 2x2 supersampling is only there for
// the rounded corner.
//
// The mark is a spiral galaxy - a vertex is where things meet, and everything
// here spirals into one core. Three arms, one per tool: Data, Code, Version.

const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const SIZE = Number(process.argv[3]) || 256;
const SS = 2;

const SPACE = [0x14, 0x18, 0x22];               // the dark between the arms
const CORE = [0xff, 0xf3, 0xd8];                // the core, warm white
const ARMS = [
  [0x5a, 0xa9, 0xe6],                           // Data
  [0x6c, 0xc0, 0x7a],                           // Code
  [0xe0, 0xb3, 0x41]                            // Version
];

const RADIUS = 0.22;        // corner radius of the tile, fraction of the side
const TWIST = 2.6;          // how tightly the arms wind: bigger is tighter
const ARM_WIDTH = 0.098;    // half width of an arm at the rim
const CORE_RADIUS = 0.105;
const DISC = 0.62;          // the arms fade out by here

function insideRoundedSquare(u, v) {
  const r = RADIUS;
  const dx = Math.max(r - u, 0, u - (1 - r));
  const dy = Math.max(r - v, 0, v - (1 - r));
  return Math.hypot(dx, dy) <= r;
}

/** Deterministic noise in [0,1), so the stars are the same in every build. */
function hash(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function wrapAngle(a) {
  while (a > Math.PI) { a -= 2 * Math.PI; }
  while (a < -Math.PI) { a += 2 * Math.PI; }
  return a;
}

/** Light at one sample, as r/g/b in 0..255, or null outside the tile. */
function sample(u, v) {
  if (!insideRoundedSquare(u, v)) {
    return null;
  }

  // Centre the disc and tilt it a little: a galaxy seen exactly face on looks
  // like a logo of a fan, and one seen edge on is a line.
  const x = (u - 0.5) * 2;
  const y = (v - 0.5) * 2 / 0.82;

  const r = Math.hypot(x, y);
  const theta = Math.atan2(y, x);

  let red = SPACE[0];
  let green = SPACE[1];
  let blue = SPACE[2];

  // A faint halo, so the tile is not flat black where no arm reaches.
  const halo = Math.exp(-(r * r) / (2 * 0.42 * 0.42)) * 0.30;
  red += 0x2a * halo;
  green += 0x33 * halo;
  blue += 0x4d * halo;

  // Stars, thinner towards the core where the light drowns them.
  const sx = Math.floor(u * 190);
  const sy = Math.floor(v * 190);
  const star = hash(sx, sy);
  if (star > 0.9975 && r > 0.30) {
    const twinkle = 0.45 + 0.55 * hash(sy, sx);
    red += 0xd0 * twinkle;
    green += 0xdc * twinkle;
    blue = Math.min(255, blue + 0xff * twinkle);
  }

  // The arms. A logarithmic spiral has theta = phi + TWIST * ln(r), so the
  // distance across an arm is the angular gap times the radius - which keeps
  // the arm about as wide near the core as at the rim.
  if (r > 0.02) {
    const spiral = TWIST * Math.log(r);
    for (let k = 0; k < ARMS.length; k++) {
      const phi = (2 * Math.PI * k) / ARMS.length;
      const across = Math.abs(wrapAngle(theta - (phi + spiral))) * r;
      // The arms open out as they leave the core and fade at the rim.
      const width = ARM_WIDTH * (0.45 + r);
      const along = Math.exp(-(r * r) / (2 * DISC * DISC)) * Math.min(1, r / 0.16);
      // A little over one keeps the arms legible where the icon is drawn at
      // forty-odd pixels, which is the size that actually gets looked at.
      const glow = Math.min(1, 1.25 * Math.exp(-(across * across) / (2 * width * width))) * along;
      red += ARMS[k][0] * glow;
      green += ARMS[k][1] * glow;
      blue += ARMS[k][2] * glow;
    }
  }

  // The core last, so it sits on top of where the arms converge.
  const core = Math.exp(-(r * r) / (2 * CORE_RADIUS * CORE_RADIUS));
  red += CORE[0] * core;
  green += CORE[1] * core;
  blue += CORE[2] * core;

  return [Math.min(255, red), Math.min(255, green), Math.min(255, blue)];
}

function render() {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      let r = 0, g = 0, b = 0, covered = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample((px + (sx + 0.5) / SS) / SIZE, (py + (sy + 0.5) / SS) / SIZE);
          if (c) {
            r += c[0]; g += c[1]; b += c[2]; covered++;
          }
        }
      }
      const n = SS * SS;
      const i = (py * SIZE + px) * 4;
      pixels[i] = covered ? Math.round(r / covered) : 0;
      pixels[i + 1] = covered ? Math.round(g / covered) : 0;
      pixels[i + 2] = covered ? Math.round(b / covered) : 0;
      pixels[i + 3] = Math.round((covered / n) * 255);
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
