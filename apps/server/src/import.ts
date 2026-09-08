/**
 * Importing audio from the web into the catalog.
 *
 * The server never ships a downloader: it drives `yt-dlp` and `ffmpeg`, which the operator
 * installs. That keeps this module small, keeps licence-encumbered binaries out of the repo,
 * and means the list of supported sites is whatever yt-dlp already knows.
 *
 * Downloads are slow and long, so they run as jobs the backoffice polls, rather than inside
 * one very patient HTTP request.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { accessSync, constants, existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve as resolvePath } from 'node:path';
import { CATALOG_DIR } from './config.ts';
import { detectProvider, type Provider } from './providers.ts';
import { publishCatalogFile, stagingPath, type TrackMeta } from './admin.ts';
import { readManifest, type CatalogEntry } from './library.ts';

const YTDLP = process.env.NEBULA_YTDLP ?? 'yt-dlp';
const FFMPEG = process.env.NEBULA_FFMPEG ?? 'ffmpeg';

/**
 * Turns a command into an absolute path, the way a shell would.
 *
 * yt-dlp's `--ffmpeg-location` wants a real path: handed the bare word "ffmpeg" it treats it
 * as a relative path, finds nothing, and aborts post-processing with "ffmpeg not found" even
 * when ffmpeg is sitting right there on the PATH.
 */
function resolveExecutable(command: string): string | null {
  const usable = (candidate: string): boolean => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };

  if (command.includes('/') || isAbsolute(command)) {
    const full = resolvePath(command);
    return usable(full) ? full : null;
  }
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (!dir) continue;
    const full = join(dir, command);
    if (usable(full)) return full;
  }
  return null;
}

// ------------------------------------------------------------------ running commands

interface RunResult { code: number; stdout: string; stderr: string }

function run(command: string, args: string[], onChild?: (child: ChildProcess) => void): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // No shell: the URL comes from the operator and must never be parsed by one.
    const child = spawn(command, args, { shell: false });
    onChild?.(child);

    // Collected as buffers and decoded once at the end: a chunk boundary lands in the middle
    // of a multi-byte character often enough, and decoding per chunk turns accented titles
    // into replacement characters.
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outSize = 0;
    let errSize = 0;

    // yt-dlp's JSON for a long playlist is large; cap it so a runaway cannot eat the heap.
    const CAP = 24_000_000;
    child.stdout.on('data', (d: Buffer) => { if (outSize < CAP) { out.push(d); outSize += d.length; } });
    child.stderr.on('data', (d: Buffer) => { if (errSize < CAP) { err.push(d); errSize += d.length; } });
    child.on('error', reject);
    child.on('close', (code) => resolve({
      code: code ?? -1,
      stdout: Buffer.concat(out).toString('utf8'),
      stderr: Buffer.concat(err).toString('utf8'),
    }));
  });
}

// ------------------------------------------------------------------ tooling

export interface ToolStatus {
  ready: boolean;
  ytdlp: { found: boolean; version: string | null };
  ffmpeg: { found: boolean; version: string | null };
  /** What to run to fix it, ready to paste. */
  hint: string;
}

let cachedTools: { at: number; status: ToolStatus } | null = null;
/** Absolute path to ffmpeg, so yt-dlp is told exactly where to look. */
let ffmpegDir: string | null = null;

export async function toolStatus(force = false): Promise<ToolStatus> {
  // Cached briefly so opening the tab does not spawn two processes on every render.
  if (!force && cachedTools && Date.now() - cachedTools.at < 30_000) return cachedTools.status;

  const probe = async (command: string, args: string[]) => {
    try {
      const { code, stdout } = await run(command, args);
      return code === 0 ? (stdout.trim().split('\n')[0] ?? '') : null;
    } catch {
      return null; // not on PATH
    }
  };

  const ytdlp = await probe(YTDLP, ['--version']);
  const ffmpeg = await probe(FFMPEG, ['-version']);

  // ffprobe lives beside ffmpeg and yt-dlp needs both; pointing at the directory covers it.
  const ffmpegPath = ffmpeg ? resolveExecutable(FFMPEG) : null;
  ffmpegDir = ffmpegPath ? dirname(ffmpegPath) : null;

  const missing: string[] = [];
  if (!ytdlp) missing.push('yt-dlp');
  if (!ffmpeg) missing.push('ffmpeg');

  const status: ToolStatus = {
    ready: missing.length === 0,
    ytdlp: { found: Boolean(ytdlp), version: ytdlp },
    // "ffmpeg version N-126435-g... Copyright (c) ..." — only the token after "version" is useful.
    ffmpeg: { found: Boolean(ffmpeg), version: ffmpeg ? (/^ffmpeg version (\S+)/.exec(ffmpeg)?.[1] ?? ffmpeg) : null },
    hint: missing.length === 0
      ? ''
      : `Instale ${missing.join(' e ')} na máquina do servidor. `
        + 'Debian/Ubuntu: sudo apt install ffmpeg && sudo pip install -U yt-dlp · '
        + 'macOS: brew install yt-dlp ffmpeg · '
        + 'Windows: winget install yt-dlp.yt-dlp Gyan.FFmpeg',
  };

  cachedTools = { at: Date.now(), status };
  return status;
}

function requireTools(status: ToolStatus): void {
  if (!status.ready) {
    throw Object.assign(new Error(status.hint), { status: 503 });
  }
}

// ------------------------------------------------------------------ probing a URL

export interface ProbeEntry {
  /** Canonical URL for this single track, which is what a download is started with. */
  url: string;
  /** `<extrator>:<id>` — the identity used to tell an already-imported item apart. */
  sourceId: string;
  title: string;
  uploader: string;
  durationMs: number;
  thumbnail: string | null;
  /** Title it already has in the catalog, or null when it is new. */
  duplicateOf: string | null;
}

export interface ProbeResult {
  provider: { id: string; name: string; notes: string };
  kind: 'track' | 'collection';
  title: string;
  uploader: string;
  suggestedLicense: string;
  entries: ProbeEntry[];
}

interface YtdlpEntry {
  id?: string;
  extractor?: string;
  ie_key?: string;
  extractor_key?: string;
  url?: string;
  webpage_url?: string;
  original_url?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  artist?: string;
  duration?: number;
  thumbnail?: string;
  entries?: YtdlpEntry[];
  _type?: string;
  playlist_title?: string;
}

/**
 * Which field holds the URL depends on where we are looking.
 *
 * Inside a playlist, `url` is the item and `webpage_url` is the *collection* — the Internet
 * Archive returns the album page for all fifteen tracks, so preferring `webpage_url` there
 * would download the same thing fifteen times. At the top level of a single-item probe it is
 * the reverse: `url` is a raw media stream and `webpage_url` is the page we want to keep.
 */
function entryUrl(entry: YtdlpEntry, provider: Provider, inPlaylist: boolean): string | null {
  const candidates = inPlaylist
    ? [entry.url, entry.webpage_url, entry.original_url]
    : [entry.webpage_url, entry.original_url, entry.url];
  const direct = candidates.find((c) => c && /^https?:\/\//.test(c));
  if (direct) return direct;
  if (entry.id && provider.id === 'youtube') return `https://www.youtube.com/watch?v=${entry.id}`;
  return null;
}

/**
 * The identity yt-dlp already assigns to the item. Falling back to the URL is worse — the
 * same video has several — but it is better than treating everything as new.
 */
/**
 * The bare id inside a URL — `youtube:aaa` and `https://youtu.be/aaa?t=42` both reduce to
 * `aaa`. Used only to recognise tracks imported before source ids were recorded, which have
 * a `sourceUrl` and nothing else to match on.
 */
function bareIdOf(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const v = url.searchParams.get('v');
    if (v) return v;
    const segments = url.pathname.split('/').filter(Boolean);
    return segments.length > 0 ? segments[segments.length - 1] : null;
  } catch {
    return null;
  }
}

/**
 * Everything in the catalog that an import could be a repeat of, under every key it might be
 * recognised by: the recorded source id, and — for older entries — the id inside its URL.
 */
export async function knownSources(): Promise<Map<string, CatalogEntry>> {
  const index = new Map<string, CatalogEntry>();
  for (const entry of await readManifest()) {
    if (entry.sourceId) {
      index.set(entry.sourceId, entry);
      const bare = entry.sourceId.slice(entry.sourceId.indexOf(':') + 1);
      if (bare) index.set(bare, entry);
    }
    if (entry.sourceUrl) {
      const bare = bareIdOf(entry.sourceUrl);
      // Never overwrite a precise match with a loose one.
      if (bare && !index.has(bare)) index.set(bare, entry);
    }
  }
  return index;
}

/** Looks an item up by its exact identity first, then by the bare id. */
function findKnown(index: Map<string, CatalogEntry>, sourceId: string): CatalogEntry | undefined {
  return index.get(sourceId) ?? index.get(sourceId.slice(sourceId.indexOf(':') + 1));
}

export function sourceIdOf(raw: YtdlpEntry, url: string): string {
  const extractor = (raw.extractor ?? raw.ie_key ?? raw.extractor_key ?? '').trim().toLowerCase();
  if (raw.id) return `${extractor || 'web'}:${raw.id}`;
  return `url:${url}`;
}

function toEntry(raw: YtdlpEntry, provider: Provider, inPlaylist: boolean): ProbeEntry | null {
  const url = entryUrl(raw, provider, inPlaylist);
  if (!url) return null;
  return {
    url,
    sourceId: sourceIdOf(raw, url),
    title: raw.title?.trim() || 'Sem título',
    uploader: (raw.artist ?? raw.uploader ?? raw.channel ?? '').trim(),
    durationMs: Math.round((raw.duration ?? 0) * 1000),
    thumbnail: raw.thumbnail ?? null,
    duplicateOf: null,
  };
}

export async function probeUrl(rawUrl: string): Promise<ProbeResult> {
  const detected = detectProvider(rawUrl);
  if (!detected) {
    throw Object.assign(new Error('endereço inválido — cole uma URL http(s) completa'), { status: 400 });
  }
  requireTools(await toolStatus());

  const { provider, url } = detected;
  const collection = provider.isCollection(url);

  const { code, stdout, stderr } = await run(YTDLP, [
    '--dump-single-json',
    '--no-warnings',
    '--ignore-config',
    collection ? '--flat-playlist' : '--no-playlist',
    collection ? '--yes-playlist' : '--no-playlist',
    url.toString(),
  ]);

  if (code !== 0) {
    const reason = stderr.trim().split('\n').filter(Boolean).pop() ?? `yt-dlp saiu com código ${code}`;
    throw Object.assign(new Error(reason), { status: 502 });
  }

  let parsed: YtdlpEntry;
  try {
    parsed = JSON.parse(stdout) as YtdlpEntry;
  } catch {
    throw Object.assign(new Error('não entendi a resposta do yt-dlp'), { status: 502 });
  }

  const isPlaylist = Array.isArray(parsed.entries) && parsed.entries.length > 0;
  const raw = isPlaylist ? parsed.entries! : [parsed];
  const entries = raw
    .map((e) => toEntry(e, provider, isPlaylist))
    .filter((e): e is ProbeEntry => e !== null);
  if (entries.length === 0) {
    throw Object.assign(new Error('nada encontrado neste endereço'), { status: 404 });
  }

  const known = await knownSources();
  for (const entry of entries) entry.duplicateOf = findKnown(known, entry.sourceId)?.title ?? null;

  return {
    provider: { id: provider.id, name: provider.name, notes: provider.notes },
    kind: entries.length > 1 ? 'collection' : 'track',
    title: parsed.playlist_title ?? parsed.title ?? 'Importação',
    uploader: (parsed.uploader ?? parsed.channel ?? '').trim(),
    suggestedLicense: provider.defaultLicense ?? '',
    entries,
  };
}

// ------------------------------------------------------------------ jobs

export interface ImportItemInput {
  url: string;
  sourceId?: string;
  title?: string;
  artist?: string;
  album?: string;
  license?: string;
}

export type ImportItemStatus =
  | 'pendente' | 'baixando' | 'ok' | 'erro' | 'cancelada' | 'duplicada';

export interface ImportItem {
  url: string;
  title: string;
  status: ImportItemStatus;
  detail?: string;
  trackId?: string;
}

export interface ImportJob {
  id: string;
  createdAt: number;
  finishedAt: number | null;
  cancelled: boolean;
  items: ImportItem[];
}

const jobs = new Map<string, ImportJob>();
const running = new Map<string, ChildProcess>();

/** Keeps finished jobs around long enough for the UI to show the result, then forgets them. */
function sweep(): void {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [id, job] of jobs) {
    if (job.finishedAt !== null && job.finishedAt < cutoff) jobs.delete(id);
  }
}

export function getJob(id: string): ImportJob | null {
  return jobs.get(id) ?? null;
}

export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || job.finishedAt !== null) return false;
  job.cancelled = true;
  running.get(id)?.kill('SIGTERM');
  return true;
}

/** Removes every file a staging prefix produced, whatever extension it ended up with. */
async function discardStaging(base: string): Promise<void> {
  const prefix = basename(base);
  try {
    const files = await readdir(CATALOG_DIR);
    await Promise.all(
      files.filter((f) => f.startsWith(prefix)).map((f) => rm(join(CATALOG_DIR, f), { force: true })),
    );
  } catch {
    // The directory is gone or unreadable; there is nothing to clean up either way.
  }
}

/** Raised when the item is already in the catalog, so the loop can label it as such. */
class DuplicateError extends Error {}

/** Downloads one URL as mp3 and hands the finished file to the catalog. */
async function importOne(item: ImportItemInput, jobId: string): Promise<CatalogEntry> {
  // Checked here rather than only at probe time: a long playlist may take an hour, and the
  // catalog can grow underneath it — including from an earlier item of this very job.
  if (item.sourceId) {
    const existing = findKnown(await knownSources(), item.sourceId);
    if (existing) throw new DuplicateError(`já no catálogo como “${existing.title}”`);
  }

  // yt-dlp appends the real extension, so the target is named without one.
  const base = stagingPath('').replace(/\.$/, '');
  const output = `${base}.%(ext)s`;
  const produced = `${base}.mp3`;

  try {
    const { code, stderr } = await run(YTDLP, [
      '--no-warnings',
      '--ignore-config',
      '--no-playlist',
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      ...(ffmpegDir ? ['--ffmpeg-location', ffmpegDir] : []),
      '--output', output,
      item.url,
    ], (child) => running.set(jobId, child));

    if (code !== 0) {
      const reason = stderr.trim().split('\n').filter(Boolean).pop() ?? `yt-dlp saiu com código ${code}`;
      throw new Error(reason);
    }
    if (!existsSync(produced)) {
      throw new Error('o download terminou mas nenhum mp3 foi produzido');
    }

    const meta: TrackMeta = {
      name: `${item.title ?? 'importada'}.mp3`,
      title: item.title,
      artist: item.artist,
      album: item.album,
      license: item.license,
      sourceUrl: item.url,
      sourceId: item.sourceId,
    };
    return await publishCatalogFile(produced, '.mp3', meta);
  } catch (err) {
    // Not just the mp3: a download that dies in post-processing leaves the raw .webm/.m4a
    // behind. Those are hidden from the manifest but very much on disk, so sweep the whole
    // staging prefix rather than the one name we hoped for.
    await discardStaging(base);
    throw err;
  } finally {
    running.delete(jobId);
  }
}

export async function startImport(inputs: ImportItemInput[]): Promise<ImportJob> {
  requireTools(await toolStatus());
  if (inputs.length === 0) {
    throw Object.assign(new Error('nenhuma faixa selecionada'), { status: 400 });
  }
  sweep();

  const job: ImportJob = {
    id: randomUUID(),
    createdAt: Date.now(),
    finishedAt: null,
    cancelled: false,
    items: inputs.map((i) => ({ url: i.url, title: i.title ?? i.url, status: 'pendente' })),
  };
  jobs.set(job.id, job);

  // Sequential on purpose: a playlist of fifty would otherwise open fifty connections to the
  // same host, which is both rude and a fast way to get rate-limited.
  void (async () => {
    for (let i = 0; i < inputs.length; i++) {
      if (job.cancelled) {
        job.items[i].status = 'cancelada';
        continue;
      }
      job.items[i].status = 'baixando';
      try {
        const entry = await importOne(inputs[i], job.id);
        job.items[i].status = 'ok';
        job.items[i].trackId = entry.id;
        job.items[i].title = entry.title;
      } catch (err) {
        job.items[i].status = err instanceof DuplicateError
          ? 'duplicada'
          : job.cancelled ? 'cancelada' : 'erro';
        job.items[i].detail = (err as Error).message;
      }
    }
    job.finishedAt = Date.now();
  })();

  return job;
}
