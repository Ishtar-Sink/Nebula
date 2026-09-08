/** End-to-end check of the backoffice catalog API against a running server. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const API = process.env.NEBULA_API ?? 'http://localhost:4000';
const CATALOG = process.env.NEBULA_CATALOG_DIR ?? join(process.cwd(), 'media', 'catalog');

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};
const get = async (p) => (await fetch(`${API}${p}`)).json();

/** A 1-second 440 Hz WAV, built inline so the test needs no fixture file. */
function tinyWav() {
  const sr = 8000, n = sr;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 8000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

console.log('\n# visão geral');
const before = await get('/api/admin/overview');
check('overview responde', Array.isArray(before.tracks), `${before.tracks?.length} faixas`);
check('agrupa por álbum', Array.isArray(before.albums) && before.albums.length > 0);
check('traz totais', typeof before.totals.durationMs === 'number');
check('informa a pasta do catálogo', typeof before.catalogDir === 'string');

console.log('\n# inserir faixa no catálogo');
const params = new URLSearchParams({
  name: 'teste-admin.wav', title: 'Faixa de Teste', artist: 'Artista Teste', album: 'Álbum Teste',
});
const created = await (await fetch(`${API}/api/admin/catalog?${params}`, {
  method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: tinyWav(),
})).json();
check('faixa criada', Boolean(created.id), created.id);
check('metadados aplicados', created.title === 'Faixa de Teste' && created.artist === 'Artista Teste');
check('duração detectada', created.durationMs > 900 && created.durationMs < 1100, `${created.durationMs}ms`);
check('arquivo gravado na pasta do catálogo', existsSync(join(CATALOG, created.file)), created.file);

const inLibrary = await get('/api/tracks');
check('aparece na biblioteca pública', inLibrary.some((t) => t.id === created.id));

const manifest = JSON.parse(readFileSync(join(CATALOG, 'catalog.json'), 'utf8'));
check('registrada no catalog.json', manifest.some((e) => e.id === created.id));

console.log('\n# streaming da faixa recém-inserida');
const head = await fetch(`${API}/stream/${encodeURIComponent(created.id)}`, { method: 'HEAD' });
check('faixa nova é tocável', head.status === 200 && Number(head.headers.get('content-length')) > 1000);

console.log('\n# imagem do álbum');
/** A 1x1 PNG, so the test needs no fixture file. */
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const coverAlbum = encodeURIComponent('Álbum Teste');
const applied = await (await fetch(`${API}/api/admin/albums/cover?album=${coverAlbum}`, {
  method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: tinyPng,
})).json();
check('imagem aplicada ao álbum', applied.changed >= 1, `${applied.changed} faixa(s)`);

const withCover = (await get('/api/tracks')).find((t) => t.id === created.id);
check('a faixa passa a expor a capa', typeof withCover.coverUrl === 'string', withCover.coverUrl);

const coverRes = await fetch(`${API}${withCover.coverUrl}`);
check('a imagem é servida', coverRes.status === 200, coverRes.headers.get('content-type'));
check('veio a imagem inteira', (await coverRes.arrayBuffer()).byteLength === tinyPng.length);

const overviewWithCover = await get('/api/admin/overview');
check('o álbum mostra a capa no backoffice',
  overviewWithCover.albums.find((a) => a.name === 'Álbum Teste')?.coverUrl === withCover.coverUrl);

const badType = await fetch(`${API}/api/admin/albums/cover?album=${coverAlbum}`, {
  method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'nope',
});
check('formato inválido é recusado com 400', badType.status === 400, `${badType.status}`);

const cleared = await (await fetch(`${API}/api/admin/albums/cover?album=${coverAlbum}`, {
  method: 'DELETE',
})).json();
check('imagem removida do álbum', cleared.changed >= 1);
check('o arquivo órfão foi apagado',
  (await fetch(`${API}${withCover.coverUrl}`)).status === 404);
check('a faixa volta a não ter capa',
  (await get('/api/tracks')).find((t) => t.id === created.id).coverUrl === null);

console.log('\n# editar metadados');
const patched = await (await fetch(`${API}/api/admin/catalog/${encodeURIComponent(created.id)}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Título Corrigido', artist: 'Novo Artista' }),
})).json();
check('título atualizado', patched.title === 'Título Corrigido');
check('artista atualizado', patched.artist === 'Novo Artista');
const afterPatch = (await get('/api/tracks')).find((t) => t.id === created.id);
check('mudança reflete na biblioteca', afterPatch.title === 'Título Corrigido');

console.log('\n# faixa removida some das playlists do cliente');
const pl = await (await fetch(`${API}/api/playlists`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Playlist do teste admin' }),
})).json();
await fetch(`${API}/api/playlists/${pl.id}/tracks`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ trackId: created.id }),
});
let detail = await get(`/api/playlists/${pl.id}`);
check('faixa entrou na playlist', detail.tracks.length === 1);

const usage = (await get('/api/admin/overview')).tracks.find((t) => t.id === created.id);
check('backoffice mostra em quantas playlists a faixa está', usage.inPlaylists === 1, `${usage.inPlaylists}`);

console.log('\n# remover do catálogo');
const del = await fetch(`${API}/api/admin/catalog/${encodeURIComponent(created.id)}`, { method: 'DELETE' });
check('remoção responde 204', del.status === 204);
check('arquivo apagado do disco', !existsSync(join(CATALOG, created.file)));
check('sai do catalog.json',
  !JSON.parse(readFileSync(join(CATALOG, 'catalog.json'), 'utf8')).some((e) => e.id === created.id));
check('sai da biblioteca pública', !(await get('/api/tracks')).some((t) => t.id === created.id));

detail = await get(`/api/playlists/${pl.id}`);
check('sai automaticamente da playlist que a usava', detail.tracks.length === 0, `${detail.tracks.length}`);
check('a playlist em si continua existindo', detail.id === pl.id);

const gone = await fetch(`${API}/stream/${encodeURIComponent(created.id)}`);
check('stream da faixa removida devolve 404', gone.status === 404);

await fetch(`${API}/api/playlists/${pl.id}`, { method: 'DELETE' });

console.log('\n# erros esperados');
const badFormat = await fetch(`${API}/api/admin/catalog?name=arquivo.txt`, { method: 'POST', body: 'x' });
check('formato inválido recusado com 400', badFormat.status === 400, `${badFormat.status}`);
const missing = await fetch(`${API}/api/admin/catalog/cat:nao-existe`, { method: 'DELETE' });
check('remover inexistente devolve 404', missing.status === 404, `${missing.status}`);

const after = await get('/api/admin/overview');
check('catálogo voltou ao tamanho original', after.tracks.length === before.tracks.length,
  `${before.tracks.length} -> ${after.tracks.length}`);

console.log(`\n${failures === 0 ? 'TODOS OS TESTES DE ADMIN PASSARAM' : `${failures} FALHA(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
