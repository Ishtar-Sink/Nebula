/**
 * Minimal ZIP writer, in pure Node.
 *
 * `zip` is not installed here and asking the operator to install it just to hand over two
 * files would be silly — zlib already ships everything a ZIP needs. Deflate + CRC32 + the
 * central directory is the whole format for this purpose.
 *
 *   node tools/make-zip.mjs <destino.zip> <arquivo|pasta>...
 */
import { deflateRawSync } from 'node:zlib';
import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join, basename, relative } from 'node:path';

const [out, ...inputs] = process.argv.slice(2);
if (!out || inputs.length === 0) {
  console.error('uso: node tools/make-zip.mjs <destino.zip> <arquivo|pasta>...');
  process.exit(1);
}

/** Table-driven CRC32 — the checksum ZIP stores for every entry. */
const TABLE = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** ZIP keeps MS-DOS timestamps: 2-second resolution, years counted from 1980. */
function dosTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function collect(path, prefix = '') {
  const stat = statSync(path);
  if (stat.isFile()) return [{ name: prefix || basename(path), path }];
  return readdirSync(path).flatMap((child) =>
    collect(join(path, child), prefix ? `${prefix}/${child}` : `${basename(path)}/${child}`));
}

const files = inputs.flatMap((input) => collect(input));
const locals = [];
const central = [];
let offset = 0;

for (const file of files) {
  const raw = readFileSync(file.path);
  const deflated = deflateRawSync(raw, { level: 9 });
  // Storing is smaller than deflating for already-compressed data; pick whichever wins.
  const stored = deflated.length >= raw.length;
  const body = stored ? raw : deflated;
  const name = Buffer.from(file.name.replace(/\\/g, '/'), 'utf8');
  const { time, date } = dosTime(statSync(file.path).mtime);
  const crc = crc32(raw);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);              // version needed
  local.writeUInt16LE(0x0800, 6);          // UTF-8 names
  local.writeUInt16LE(stored ? 0 : 8, 8);  // stored or deflated
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  locals.push(local, name, body);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(0x031e, 4);          // made by: Unix, spec 3.0
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x0800, 8);
  entry.writeUInt16LE(stored ? 0 : 8, 10);
  entry.writeUInt16LE(time, 12);
  entry.writeUInt16LE(date, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(body.length, 20);
  entry.writeUInt32LE(raw.length, 24);
  entry.writeUInt16LE(name.length, 28);
  // `<< 16` overflows into a negative 32-bit int in JS; >>> 0 brings it back unsigned.
  entry.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attributes: -rw-r--r--
  entry.writeUInt32LE(offset, 42);
  central.push(entry, name);

  offset += local.length + name.length + body.length;
  console.log(`  ${file.name}  ${(raw.length / 1024).toFixed(0)} KB -> ${(body.length / 1024).toFixed(0)} KB`);
}

const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);

writeFileSync(out, Buffer.concat([...locals, directory, end]));
const total = statSync(out).size;
console.log(`\n${relative(process.cwd(), out)} — ${(total / 1048576).toFixed(1)} MB, ${files.length} arquivos`);
