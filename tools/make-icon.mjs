/**
 * Renders the Nebula app icon as a PNG, with no image library involved.
 *
 * Shapes are drawn from signed-distance fields so the edges stay smooth at any size, and
 * the PNG is assembled by hand (zlib is the only thing needed).
 *
 *   node tools/make-icon.mjs [output.png] [size]
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';

const out = process.argv[2] ?? 'icon.png';
const SIZE = Number(process.argv[3] ?? 1024);

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
/** Smooth 0..1 ramp used to antialias every edge. */
const smooth = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** Signed distance to a rounded rectangle centred on the canvas. */
function sdRoundedRect(px, py, halfW, halfH, radius) {
  const qx = Math.abs(px) - (halfW - radius);
  const qy = Math.abs(py) - (halfH - radius);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - radius;
}

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

const A = hex('#A855F7');
const B = hex('#EC4899');

const s = SIZE;
const center = s / 2;
// macOS icons leave a margin around the squircle so they line up with system icons.
const half = s * 0.402;
const radius = s * 0.223;
const aa = s / 512; // antialiasing width, scaled with the canvas

const pixels = Buffer.alloc(s * s * 4);

for (let y = 0; y < s; y++) {
  for (let x = 0; x < s; x++) {
    const px = x + 0.5 - center;
    const py = y + 0.5 - center;

    const body = smooth(aa, -aa, sdRoundedRect(px, py, half, half, radius));
    if (body <= 0) continue;

    // Diagonal gradient, top-left to bottom-right.
    const t = clamp((px + py) / (4 * half) + 0.5);
    let r = A[0] + (B[0] - A[0]) * t;
    let g = A[1] + (B[1] - A[1]) * t;
    let b = A[2] + (B[2] - A[2]) * t;

    // Soft highlight in the upper-left, the way the web covers are lit.
    const gloss = smooth(s * 0.5, 0, Math.hypot(px + half * 0.45, py + half * 0.5)) * 0.28;
    r += (255 - r) * gloss;
    g += (255 - g) * gloss;
    b += (255 - b) * gloss;

    // The mark: a disc — white ring plus a solid centre.
    const d = Math.hypot(px, py);
    const ring = smooth(aa, -aa, Math.abs(d - s * 0.238) - s * 0.031);
    const hub = smooth(aa, -aa, d - s * 0.062);
    const mark = clamp(Math.max(ring, hub));

    r += (255 - r) * mark;
    g += (255 - g) * mark;
    b += (255 - b) * mark;

    const i = (y * s + x) * 4;
    pixels[i] = Math.round(r);
    pixels[i + 1] = Math.round(g);
    pixels[i + 2] = Math.round(b);
    pixels[i + 3] = Math.round(body * 255);
  }
}

// ---------------------------------------------------------------- PNG container

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(s, 0);
ihdr.writeUInt32BE(s, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA
// 10..12 stay zero: deflate, adaptive filtering, no interlace.

// Each scanline is prefixed with its filter type; 0 (none) keeps this simple.
const raw = Buffer.alloc(s * (s * 4 + 1));
for (let y = 0; y < s; y++) {
  raw[y * (s * 4 + 1)] = 0;
  pixels.copy(raw, y * (s * 4 + 1) + 1, y * s * 4, (y + 1) * s * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

writeFileSync(out, png);
console.log(`${out} — ${s}x${s}, ${Math.round(png.length / 1024)} KB`);
