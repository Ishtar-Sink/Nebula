/**
 * End-to-end check of the web importer.
 *
 * yt-dlp and ffmpeg are the operator's responsibility, and asking a test suite to hit YouTube
 * would make it slow, flaky and dependent on someone else's copyright decisions. So this spawns
 * a throwaway server pointed at stub executables (the same NEBULA_YTDLP / NEBULA_FFMPEG hooks
 * the operator uses to relocate the real ones) and exercises the whole path: detection, probe,
 * selection, download, conversion and publication into the catalog.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

const root = mkdtempSync(join(tmpdir(), 'nebula-import-'));
const bin = join(root, 'bin');
const catalog = join(root, 'catalog');
const data = join(root, 'data');
const { mkdirSync } = await import('node:fs');
for (const dir of [bin, catalog, data]) mkdirSync(dir, { recursive: true });
writeFileSync(join(catalog, 'catalog.json'), '[]');

/**
 * A real, if silent, MPEG-1 Layer III file: 40 frames of 128 kbps / 44.1 kHz.
 * It has to be a genuine mp3 rather than a renamed wav, because the server measures the
 * duration of whatever the downloader produced — and measuring it is part of what's under test.
 */
function tinyMp3() {
  // 144 * 128000 / 44100 = 417 bytes per frame; each frame carries 1152 samples (~26.12 ms).
  const frame = Buffer.alloc(417);
  frame[0] = 0xff;        // sync
  frame[1] = 0xfb;        // sync + MPEG-1, Layer III, no CRC
  frame[2] = 0x90;        // 128 kbps, 44.1 kHz, no padding
  frame[3] = 0x00;        // stereo, no emphasis
  return Buffer.concat(Array.from({ length: 40 }, () => frame));
}
writeFileSync(join(root, 'sample.bin'), tinyMp3());

// ------------------------------------------------------------------ stub tools

const ytdlp = join(bin, 'yt-dlp');
writeFileSync(ytdlp, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('9999.01.01'); process.exit(0); }

const url = args[args.length - 1];
if (args.includes('--dump-single-json')) {
  if (url.includes('list=')) {
    console.log(JSON.stringify({
      _type: 'playlist', playlist_title: 'Coletânea de Teste', uploader: 'Canal Teste',
      entries: [
        { id: 'aaa', extractor: 'youtube', title: 'Primeira', uploader: 'Canal Teste', duration: 61 },
        { id: 'bbb', extractor: 'youtube', title: 'Segunda', uploader: 'Canal Teste', duration: 62 },
        { id: 'ccc', extractor: 'youtube', title: 'Terceira', uploader: 'Canal Teste', duration: 63 },
      ],
    }));
  } else {
    console.log(JSON.stringify({
      id: 'zzz', extractor: 'youtube', webpage_url: url, title: 'Faixa Solta',
      uploader: 'Canal Teste', duration: 64,
    }));
  }
  process.exit(0);
}

// Download: honour --output, and fail on the URL the test uses to check error reporting.
if (url.includes('quebrada')) {
  // Like a real post-processing failure: the raw download is already on disk when it dies.
  const raw = args[args.indexOf('--output') + 1].replace('%(ext)s', 'webm');
  require('node:fs').writeFileSync(raw, 'download cru');
  console.error('ERROR: Postprocessing: ffmpeg not found');
  process.exit(1);
}
const out = args[args.indexOf('--output') + 1].replace('%(ext)s', 'mp3');
require('node:fs').copyFileSync(${JSON.stringify(join(root, 'sample.bin'))}, out);
process.exit(0);
`);
chmodSync(ytdlp, 0o755);

const ffmpeg = join(bin, 'ffmpeg');
writeFileSync(ffmpeg, '#!/bin/sh\necho "ffmpeg version 9.9-stub"\nexit 0\n');
chmodSync(ffmpeg, 0o755);

// ------------------------------------------------------------------ server

const PORT = 4177;
const API = `http://127.0.0.1:${PORT}`;
const server = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', 'src/index.ts'],
  {
    cwd: join(process.cwd(), 'apps', 'server'),
    env: {
      ...process.env,
      NEBULA_PORT: String(PORT),
      NEBULA_HOST: '127.0.0.1',
      NEBULA_DATA_DIR: data,
      NEBULA_CATALOG_DIR: catalog,
      NEBULA_YTDLP: ytdlp,
      NEBULA_FFMPEG: ffmpeg,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
const serverLog = [];
server.stdout.on('data', (d) => serverLog.push(d.toString()));
server.stderr.on('data', (d) => serverLog.push(d.toString()));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (path, body) =>
  (await fetch(`${API}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })).json();

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await fetch(`${API}/api/tracks`)).ok; } catch { await sleep(250); }
  }
  if (!up) throw new Error(`servidor não subiu:\n${serverLog.join('')}`);

  console.log('\n# ferramentas');
  const tools = await (await fetch(`${API}/api/admin/import/tools`)).json();
  check('detecta as duas ferramentas', tools.ready === true);
  check('lê a versão do yt-dlp', tools.ytdlp.version === '9999.01.01', tools.ytdlp.version);
  check('lê a versão do ffmpeg', tools.ffmpeg.version === '9.9-stub', tools.ffmpeg.version);

  console.log('\n# provedores');
  const { providers } = await (await fetch(`${API}/api/admin/import/providers`)).json();
  check('registro publicado', providers.length >= 5, `${providers.length} provedores`);
  check('o genérico é o último', providers[providers.length - 1].id === 'generic');

  console.log('\n# sondagem');
  const bad = await post('/api/admin/import/probe', { url: 'ftp://exemplo.com/a.mp3' });
  check('recusa protocolo que não é http', Boolean(bad.error));

  const single = await post('/api/admin/import/probe', { url: 'https://youtu.be/zzz' });
  check('detecta o YouTube pela URL curta', single.provider.id === 'youtube');
  check('faixa única vem como "track"', single.kind === 'track', single.kind);
  check('uma entrada', single.entries.length === 1);
  check('duração convertida para ms', single.entries[0].durationMs === 64000);
  check('identidade de origem montada', single.entries[0].sourceId === 'youtube:zzz', single.entries[0].sourceId);
  check('nada marcado como duplicado ainda', single.entries[0].duplicateOf === null);

  const list = await post('/api/admin/import/probe', {
    url: 'https://www.youtube.com/playlist?list=PL123',
  });
  check('playlist vem como "collection"', list.kind === 'collection', list.kind);
  check('traz as três entradas', list.entries.length === 3);
  check('título da coletânea', list.title === 'Coletânea de Teste');
  check(
    'reconstrói a URL de itens sem link',
    list.entries[0].url === 'https://www.youtube.com/watch?v=aaa',
    list.entries[0].url,
  );

  console.log('\n# baixar só o que foi selecionado');
  const chosen = [list.entries[0], list.entries[2]].map((e) => ({
    url: e.url, sourceId: e.sourceId, title: e.title,
    artist: 'Artista Importado', album: 'Álbum Importado', license: 'CC BY 4.0',
  }));
  let job = await post('/api/admin/import', { items: chosen });
  check('trabalho aceito', typeof job.id === 'string', job.id);
  check('só as selecionadas entraram', job.items.length === 2);

  for (let i = 0; i < 80 && job.finishedAt === null; i++) {
    await sleep(150);
    job = await (await fetch(`${API}/api/admin/import/${job.id}`)).json();
  }
  check('trabalho terminou', job.finishedAt !== null);
  check('as duas concluíram', job.items.every((i) => i.status === 'ok'), JSON.stringify(job.items.map((i) => i.status)));
  check('cada item recebeu o id da faixa', job.items.every((i) => typeof i.trackId === 'string'));

  console.log('\n# entrou no catálogo');
  const overview = await (await fetch(`${API}/api/admin/overview`)).json();
  check('duas faixas publicadas', overview.tracks.length === 2, `${overview.tracks.length}`);
  const first = overview.tracks.find((t) => t.title === 'Primeira');
  check('a faixa "Primeira" existe', Boolean(first));
  check('artista aplicado em lote', first?.artist === 'Artista Importado');
  check('álbum aplicado em lote', first?.album === 'Álbum Importado');
  check('licença registrada', first?.license === 'CC BY 4.0', first?.license);
  check('URL de origem registrada', first?.sourceUrl === 'https://www.youtube.com/watch?v=aaa', first?.sourceUrl);
  check('arquivo mp3 no disco', existsSync(join(catalog, first?.file ?? 'x')), first?.file);
  check('duração medida do arquivo', first?.durationMs > 900 && first?.durationMs < 1100, `${first?.durationMs}ms`);
  check('a terceira também entrou', overview.tracks.some((t) => t.title === 'Terceira'));
  check('a segunda ficou de fora', !overview.tracks.some((t) => t.title === 'Segunda'));

  const manifest = JSON.parse(readFileSync(join(catalog, 'catalog.json'), 'utf8'));
  check('manifesto persistido com atribuição', manifest.every((e) => e.license === 'CC BY 4.0'));
  check('identidade de origem gravada', manifest.every((e) => e.sourceId?.startsWith('youtube:')));

  console.log('\n# não baixa duas vezes a mesma coisa');
  const again = await post('/api/admin/import/probe', {
    url: 'https://www.youtube.com/playlist?list=PL123',
  });
  const marked = again.entries.filter((e) => e.duplicateOf);
  check('a sondagem marca as já importadas', marked.length === 2, `${marked.length} de 3`);
  check('e diz com que título estão lá', marked.some((e) => e.duplicateOf === 'Primeira'));
  check('a que falta continua livre',
    again.entries.find((e) => e.title === 'Segunda').duplicateOf === null);

  // Same video, different URL: the id is what has to catch it, not the address.
  let repeat = await post('/api/admin/import', {
    items: [{ url: 'https://youtu.be/aaa?t=42', sourceId: 'youtube:aaa', title: 'Primeira' }],
  });
  for (let i = 0; i < 80 && repeat.finishedAt === null; i++) {
    await sleep(150);
    repeat = await (await fetch(`${API}/api/admin/import/${repeat.id}`)).json();
  }
  check('recusa a repetida mesmo com outra URL', repeat.items[0].status === 'duplicada', repeat.items[0].status);
  check('e explica onde ela já está', /Primeira/.test(repeat.items[0].detail ?? ''), repeat.items[0].detail);
  const stillTwo = await (await fetch(`${API}/api/admin/overview`)).json();
  check('o catálogo não cresceu', stillTwo.tracks.length === 2, `${stillTwo.tracks.length}`);

  console.log('\n# falha em um item não derruba o restante');
  let mixed = await post('/api/admin/import', {
    items: [
      { url: 'https://www.youtube.com/watch?v=quebrada', title: 'Quebrada' },
      { url: 'https://www.youtube.com/watch?v=ddd', title: 'Boa' },
    ],
  });
  for (let i = 0; i < 80 && mixed.finishedAt === null; i++) {
    await sleep(150);
    mixed = await (await fetch(`${API}/api/admin/import/${mixed.id}`)).json();
  }
  check('a que falhou está marcada como erro', mixed.items[0].status === 'erro', mixed.items[0].status);
  check('o motivo da falha foi guardado', Boolean(mixed.items[0].detail), mixed.items[0].detail);
  check('a seguinte foi baixada assim mesmo', mixed.items[1].status === 'ok', mixed.items[1].status);

  const after = await (await fetch(`${API}/api/admin/overview`)).json();
  check('nada sobrou de staging no catálogo', after.tracks.length === 3, `${after.tracks.length} faixas`);
  const { readdirSync } = await import('node:fs');
  const leftovers = readdirSync(catalog).filter((f) => f.startsWith('.upload-'));
  check('nenhum arquivo temporário ficou para trás — nem o download cru da que falhou',
    leftovers.length === 0, leftovers.join(', ') || 'nenhum');

  console.log('\n# lista vazia');
  const empty = await post('/api/admin/import', { items: [] });
  check('recusa importação sem itens', Boolean(empty.error), empty.error);
} finally {
  server.kill('SIGTERM');
}

console.log(failures === 0
  ? '\nTODOS OS TESTES DE IMPORTAÇÃO PASSARAM\n'
  : `\n${failures} TESTE(S) DE IMPORTAÇÃO FALHARAM\n`);
process.exit(failures === 0 ? 0 : 1);
