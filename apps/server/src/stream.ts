import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Serves an audio file with byte-range support. Range is not optional here: without a 206
 * reply Safari and the iOS/Android media stacks refuse to seek (and often refuse to start).
 */
export async function streamFile(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  mime: string,
): Promise<void> {
  let size: number;
  try {
    const s = await stat(path);
    if (!s.isFile()) throw new Error('not a file');
    size = s.size;
  } catch {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'arquivo não encontrado no disco' }));
    return;
  }

  const base = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
  };

  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, { ...base, 'Content-Length': String(size) });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(path).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) {
    res.writeHead(416, { ...base, 'Content-Range': `bytes */${size}` });
    res.end();
    return;
  }

  const [, rawStart, rawEnd] = match;
  let start: number;
  let end: number;
  if (rawStart === '') {
    // Suffix range ("bytes=-500"): the last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) {
      res.writeHead(416, { ...base, 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    res.writeHead(416, { ...base, 'Content-Range': `bytes */${size}` });
    res.end();
    return;
  }

  res.writeHead(206, {
    ...base,
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Content-Length': String(end - start + 1),
  });
  if (req.method === 'HEAD') { res.end(); return; }

  const stream = createReadStream(path, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}
