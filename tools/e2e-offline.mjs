/**
 * Tests the offline library and its playlists — the part that never touches the server.
 *
 *   node tools/e2e-offline.mjs
 *
 * Runs the real apps/web/src/offline/store.ts against an in-memory IndexedDB, because the
 * interesting behaviour is here: what happens to a playlist when its file is deleted, whether
 * duplicates survive, and whether an older library still opens after the storage split.
 */

import { installMemoryIndexedDB, resetMemoryIndexedDB, seedLegacyDatabase } from './idb-memory.mjs';

// ------------------------------------------------------------------ browser stand-ins

installMemoryIndexedDB();

globalThis.URL.createObjectURL ??= () => `blob:fake/${Math.random().toString(36).slice(2)}`;
globalThis.URL.revokeObjectURL ??= () => {};

/** The store reads durations from the decoder; here the file itself carries the answer. */
globalThis.Audio = class {
  constructor() { this.duration = 0; this.preload = ''; this.onloadedmetadata = null; this.onerror = null; }
  set src(_value) {
    queueMicrotask(() => {
      this.duration = globalThis.__nextDurationSec ?? 0;
      this.onloadedmetadata?.();
    });
  }
  removeAttribute() {}
};

function fakeFile(name, bytes, durationSec) {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' });
  // Blob is not a File in Node; the store only reads .name and .size.
  return Object.assign(blob, { name, __durationSec: durationSec });
}

// ------------------------------------------------------------------ harness

let passed = 0;
let failed = 0;

function ok(label, condition, detail) {
  if (condition) { passed++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`); }
  else { failed++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}
const section = (title) => console.log(`\n# ${title}`);

/** Stages and confirms one file, the way the dialog does. */
async function add(store, name, bytes, durationSec, extra = {}) {
  globalThis.__nextDurationSec = durationSec;
  const draft = await store.draftFromFile(fakeFile(name, bytes, durationSec));
  const [track] = await store.addOfflineDrafts([{ ...draft, ...extra }]);
  return track;
}

// ------------------------------------------------------------------ tests

const store = await import('../apps/web/src/offline/store.ts');

section('biblioteca de arquivos');

const rain = await add(store, 'Chuva - Noturno.mp3', 1024, 90);
const solo = await add(store, 'gravacao_sem_artista.mp3', 2048, 30);

ok('nome no formato "Artista - Título" é reconhecido',
  rain.artist === 'Chuva' && rain.title === 'Noturno', `${rain.artist} / ${rain.title}`);
ok('nome solto vira o título',
  solo.artist === 'Arquivo local' && solo.title === 'gravacao sem artista', solo.title);
ok('duração vem do decodificador', rain.durationMs === 90_000, `${rain.durationMs}ms`);
ok('faixa é marcada como local', rain.source === 'local' && solo.source === 'local');

let tracks = await store.listOfflineTracks();
ok('as duas faixas estão na biblioteca', tracks.length === 2, `${tracks.length}`);
ok('tamanho somado sem carregar o áudio', await store.offlineLibrarySize() === 3072);

const url = await store.offlineTrackUrl(rain.id);
ok('o arquivo é recuperável para tocar', typeof url === 'string' && url.startsWith('blob:'));
ok('faixa inexistente não devolve URL', await store.offlineTrackUrl('local:nada') === null);

section('conferência antes de guardar');

globalThis.__nextDurationSec = 12;
const staged = await store.draftFromFile(fakeFile('Banda - Faixa.mp3', 64, 12));
ok('o rascunho já traz o palpite do nome',
  staged.artist === 'Banda' && staged.title === 'Faixa', `${staged.artist} / ${staged.title}`);
ok('o rascunho traz a duração lida', staged.durationMs === 12_000, `${staged.durationMs}ms`);
ok('rascunho não guarda nada sozinho', (await store.listOfflineTracks()).length === 2);

const edited = await store.addOfflineDrafts([
  { ...staged, title: 'Outro nome', artist: 'Outro artista', album: 'Disco X', coverUrl: 'data:image/jpeg;base64,AA' },
]);
ok('as correções do diálogo são o que fica',
  edited[0].title === 'Outro nome' && edited[0].artist === 'Outro artista', edited[0].title);
ok('álbum digitado é respeitado', edited[0].album === 'Disco X', edited[0].album);
ok('capa escolhida é guardada', edited[0].coverUrl === 'data:image/jpeg;base64,AA');
await store.removeOfflineTrack(edited[0].id);

section('corrigir os dados de uma faixa');

const fixed = await store.updateOfflineTrack(solo.id, { title: 'Ensaio', artist: 'Eu mesmo' });
ok('título corrigido', fixed.title === 'Ensaio', fixed.title);
ok('artista corrigido', fixed.artist === 'Eu mesmo', fixed.artist);
ok('álbum intacto quando não é enviado', fixed.album === 'Meus arquivos', fixed.album);

const blank = await store.updateOfflineTrack(solo.id, { title: '   ' });
ok('campo em branco não apaga o valor anterior', blank.title === 'Ensaio', blank.title);

const withCover = await store.updateOfflineTrack(solo.id, { coverUrl: 'data:image/jpeg;base64,BB' });
ok('capa pode ser trocada depois', withCover.coverUrl === 'data:image/jpeg;base64,BB');
ok('editar só a capa não mexe no título', withCover.title === 'Ensaio');
const noCover = await store.updateOfflineTrack(solo.id, { coverUrl: null });
ok('capa pode ser removida', noCover.coverUrl === null);
const kept = await store.updateOfflineTrack(solo.id, { title: 'Ensaio 2' });
ok('não enviar a capa mantém o que havia', kept.coverUrl === null);

tracks = await store.listOfflineTracks();
ok('a correção persiste na biblioteca',
  tracks.find((t) => t.id === solo.id).title === 'Ensaio 2');
ok('a duração não é afetada pela edição',
  tracks.find((t) => t.id === solo.id).durationMs === 30_000);

let missing = null;
try { await store.updateOfflineTrack('local:nada', { title: 'x' }); } catch (err) { missing = err; }
ok('editar faixa inexistente falha explicitamente', missing !== null, missing?.message);

section('playlists offline');

const pl = await store.createOfflinePlaylist('Para dormir');
ok('playlist criada', pl.name === 'Para dormir' && pl.trackCount === 0);
ok('id marca a origem offline', pl.id.startsWith('offpl:'), pl.id);

await store.addTrackToOfflinePlaylist(pl.id, rain.id);
await store.addTrackToOfflinePlaylist(pl.id, solo.id);
await store.addTrackToOfflinePlaylist(pl.id, rain.id); // de novo, de propósito

let detail = await store.getOfflinePlaylist(pl.id);
ok('duplicata é preservada', detail.tracks.length === 3, `${detail.tracks.length} faixas`);
ok('duração somada inclui a repetição', detail.durationMs === 210_000, `${detail.durationMs}ms`);
ok('ordem de inserção mantida',
  detail.tracks[0].id === rain.id && detail.tracks[1].id === solo.id);

await store.reorderOfflinePlaylist(pl.id, [solo.id, rain.id]);
detail = await store.getOfflinePlaylist(pl.id);
ok('reordenação aplicada', detail.tracks[0].id === solo.id, detail.tracks[0].title);

await store.removeTrackFromOfflinePlaylist(pl.id, solo.id);
detail = await store.getOfflinePlaylist(pl.id);
ok('remoção tira só uma ocorrência', detail.tracks.length === 1 && detail.tracks[0].id === rain.id);
ok('a playlist mostra o nome corrigido, não o do arquivo',
  (await store.getOfflinePlaylist(pl.id)).tracks.every((t) => t.title !== 'gravacao sem artista'));

await store.renameOfflinePlaylist(pl.id, 'Sono profundo');
ok('renomeada', (await store.getOfflinePlaylist(pl.id)).name === 'Sono profundo');

await store.setOfflinePlaylistCover(pl.id, 'data:image/jpeg;base64,CC');
ok('playlist aceita uma imagem',
  (await store.getOfflinePlaylist(pl.id)).coverUrl === 'data:image/jpeg;base64,CC');
ok('a imagem aparece na listagem',
  (await store.listOfflinePlaylists())[0].coverUrl === 'data:image/jpeg;base64,CC');
await store.setOfflinePlaylistCover(pl.id, null);
ok('imagem da playlist pode ser removida',
  (await store.getOfflinePlaylist(pl.id)).coverUrl === null);

const listed = await store.listOfflinePlaylists();
ok('aparece na listagem', listed.length === 1 && listed[0].trackCount === 1);
ok('capa é determinística',
  listed[0].colorA === pl.colorA && listed[0].colorB === pl.colorB);

section('apagar um arquivo limpa as playlists');

await store.addTrackToOfflinePlaylist(pl.id, solo.id);
ok('duas faixas antes de apagar', (await store.getOfflinePlaylist(pl.id)).tracks.length === 2);

await store.removeOfflineTrack(solo.id);
detail = await store.getOfflinePlaylist(pl.id);
ok('a faixa apagada saiu da playlist', detail.tracks.length === 1, `${detail.tracks.length}`);
ok('a playlist continua existindo', detail.name === 'Sono profundo');
ok('o áudio foi apagado junto', await store.offlineTrackUrl(solo.id) === null);
ok('a outra faixa continua tocável', (await store.offlineTrackUrl(rain.id)) !== null);

await store.deleteOfflinePlaylist(pl.id);
ok('playlist excluída', (await store.listOfflinePlaylists()).length === 0);
ok('excluir a playlist não apaga as faixas', (await store.listOfflineTracks()).length === 1);

section('esvaziar a biblioteca');

const pl2 = await store.createOfflinePlaylist('Restos');
await store.addTrackToOfflinePlaylist(pl2.id, rain.id);
await store.clearOfflineLibrary();
ok('nenhuma faixa sobrou', (await store.listOfflineTracks()).length === 0);
ok('tamanho zerado', await store.offlineLibrarySize() === 0);
ok('a playlist ficou vazia, não excluída',
  (await store.getOfflinePlaylist(pl2.id)).tracks.length === 0);

// ------------------------------------------------------------------ migration

section('biblioteca antiga (v1) continua abrindo');

resetMemoryIndexedDB();
seedLegacyDatabase('nebula-offline', [
  {
    id: 'local:antiga',
    track: {
      id: 'local:antiga', title: 'Guardada antes', artist: 'Alguém', album: 'Meus arquivos',
      durationMs: 42_000, source: 'local', colorA: '#A855F7', colorB: '#EC4899',
    },
    blob: new Blob([new Uint8Array(777)], { type: 'audio/mpeg' }),
    fileName: 'guardada.mp3',
    addedAt: 1,
  },
]);

// Fresh module instance, so it opens the seeded database instead of reusing the cached one.
const migrated = await import(`../apps/web/src/offline/store.ts?v1=${Date.now()}`);
const after = await migrated.listOfflineTracks();
ok('a faixa antiga sobreviveu', after.length === 1 && after[0].title === 'Guardada antes');
ok('o áudio migrou para o novo lugar', (await migrated.offlineTrackUrl('local:antiga')) !== null);
ok('o tamanho foi recuperado do blob', await migrated.offlineLibrarySize() === 777);

// ------------------------------------------------------------------ result

console.log(`\n${failed === 0 ? 'TODOS OS TESTES OFFLINE PASSARAM' : `${failed} FALHA(S)`} — ${passed} asserções\n`);
process.exit(failed === 0 ? 0 : 1);
