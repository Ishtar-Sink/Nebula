/**
 * Builds the Windows .ico from PNGs rendered by make-icon.mjs.
 *
 * Vista and later accept PNG-compressed entries inside an ICO, so the file is just a small
 * header plus the PNG bytes — no BMP conversion needed.
 *
 *   node tools/make-ico.mjs out.ico 16 32 48 64 128 256
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

const HERE = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? 'icon.ico';
const sizes = process.argv.slice(3).map(Number).filter(Boolean);
if (sizes.length === 0) sizes.push(16, 32, 48, 64, 128, 256);

const work = mkdtempSync(join(tmpdir(), 'nebula-ico-'));
const entries = [];

try {
  for (const size of sizes) {
    const png = join(work, `${size}.png`);
    execFileSync(process.execPath, [join(HERE, 'make-icon.mjs'), png, String(size)], { stdio: 'ignore' });
    entries.push({ size, data: readFileSync(png) });
  }

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(entries.length, 4);

  const DIR_ENTRY = 16;
  let offset = header.length + entries.length * DIR_ENTRY;
  const dir = [];

  for (const entry of entries) {
    const e = Buffer.alloc(DIR_ENTRY);
    // 256 is stored as 0 — the field is a single byte.
    e[0] = entry.size >= 256 ? 0 : entry.size;
    e[1] = entry.size >= 256 ? 0 : entry.size;
    e[2] = 0; // palette colours
    e[3] = 0; // reserved
    e.writeUInt16LE(1, 4);  // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(entry.data.length, 8);
    e.writeUInt32LE(offset, 12);
    dir.push(e);
    offset += entry.data.length;
  }

  writeFileSync(out, Buffer.concat([header, ...dir, ...entries.map((e) => e.data)]));
  console.log(`${out} — ${entries.map((e) => e.size).join(', ')} px`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
