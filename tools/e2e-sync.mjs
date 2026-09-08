/**
 * End-to-end check of the remote-control protocol against a running server.
 * Simulates two devices and asserts the behaviour the product promises:
 * control from one device, sound on another, and handoff without losing the position.
 */
import WebSocket from 'ws';

const API = process.env.NEBULA_API ?? 'http://localhost:4000';
const WS = API.replace(/^http/, 'ws') + '/ws';

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

class Device {
  constructor(id, name, platform) {
    this.id = id; this.name = name; this.platform = platform;
    this.state = null; this.devices = []; this.messages = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      const q = new URLSearchParams({ deviceId: this.id, name: this.name, platform: this.platform });
      this.ws = new WebSocket(`${WS}?${q}`);
      this.ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        this.messages.push(msg);
        if (msg.t === 'welcome') { this.state = msg.state; this.devices = msg.devices; resolve(); }
        if (msg.t === 'state') this.state = msg.state;
        if (msg.t === 'devices') this.devices = msg.devices;
      });
      this.ws.on('error', reject);
    });
  }
  cmd(cmd) { this.ws.send(JSON.stringify({ t: 'command', cmd })); }
  progress(positionMs, durationMs, isPlaying = true) {
    this.ws.send(JSON.stringify({ t: 'progress', positionMs, durationMs, isPlaying }));
  }
  close() { this.ws.close(); }
}

const settle = (ms = 160) => new Promise((r) => setTimeout(r, ms));

const tracks = await (await fetch(`${API}/api/tracks`)).json();
if (tracks.length < 2) {
  console.error('Preciso de pelo menos 2 faixas. Rode o seed primeiro.');
  process.exit(1);
}
console.log(`\nCatálogo: ${tracks.length} faixas\n`);

// ---------------------------------------------------------------- devices

const desktop = new Device('test-desktop', 'Desktop de teste', 'desktop');
const phone = new Device('test-phone', 'Celular de teste', 'mobile');
await desktop.connect();
await phone.connect();
await settle();

console.log('# registro');
check('os dois aparelhos aparecem para ambos', desktop.devices.length >= 2 && phone.devices.length >= 2,
  `desktop vê ${desktop.devices.length}, celular vê ${phone.devices.length}`);

// ---------------------------------------------------------------- playback starts on desktop

console.log('\n# desktop começa a tocar');
desktop.cmd({
  type: 'playContext', contextId: 'teste', contextName: 'Teste',
  trackIds: tracks.slice(0, 3).map((t) => t.id), startIndex: 0,
});
await settle();

check('desktop virou o aparelho ativo', desktop.state.activeDeviceId === 'test-desktop');
check('estado diz tocando', desktop.state.isPlaying === true);
check('faixa carregada é a primeira', desktop.state.trackId === tracks[0].id);
check('duração veio do catálogo', desktop.state.durationMs === tracks[0].durationMs,
  `${desktop.state.durationMs}ms`);
check('celular recebeu o mesmo estado', phone.state.rev === desktop.state.rev &&
  phone.state.trackId === desktop.state.trackId);
check('celular sabe que o som sai no desktop', phone.state.activeDeviceId === 'test-desktop');

// ---------------------------------------------------------------- remote control

console.log('\n# celular controla remotamente (som continua no desktop)');
const revBefore = desktop.state.rev;
phone.cmd({ type: 'next' });
await settle();

check('faixa avançou', desktop.state.trackId === tracks[1].id);
check('o som continua no desktop', desktop.state.activeDeviceId === 'test-desktop');
check('rev subiu (desktop precisa reagir)', desktop.state.rev > revBefore);

phone.cmd({ type: 'volume', volume: 0.33 });
await settle();
check('volume mudou pelo celular', Math.abs(desktop.state.volume - 0.33) < 0.001,
  `volume=${desktop.state.volume}`);

phone.cmd({ type: 'pause' });
await settle();
check('pausa pelo celular chega ao desktop', desktop.state.isPlaying === false);

phone.cmd({ type: 'play' });
await settle();
check('play pelo celular retoma', desktop.state.isPlaying === true);
check('play remoto NÃO roubou o áudio', desktop.state.activeDeviceId === 'test-desktop');

// ---------------------------------------------------------------- progress ownership

console.log('\n# quem manda no relógio é só o aparelho ativo');
desktop.progress(42000, tracks[1].durationMs, true);
await settle();
check('progresso do ativo é aceito', desktop.state.positionMs === 42000, `${desktop.state.positionMs}ms`);

const revAfterProgress = desktop.state.rev;
desktop.progress(43000, tracks[1].durationMs, true);
await settle();
check('progresso NÃO bump o rev (sem loop de reconciliação)', desktop.state.rev === revAfterProgress);

phone.progress(999999, 999999, true);
await settle();
check('progresso de aparelho inativo é ignorado', desktop.state.positionMs === 43000,
  `${desktop.state.positionMs}ms`);

// ---------------------------------------------------------------- context switch remotely

console.log('\n# trocar playlist pelo celular, tocando no desktop');
phone.cmd({
  type: 'playContext', contextId: 'outra', contextName: 'Outra seleção',
  trackIds: [tracks[2].id, tracks[0].id], startIndex: 0,
});
await settle();
check('contexto trocou', desktop.state.contextName === 'Outra seleção');
check('faixa é a nova', desktop.state.trackId === tracks[2].id);
check('áudio continua no desktop', desktop.state.activeDeviceId === 'test-desktop');
check('posição reiniciou', desktop.state.positionMs === 0);

// ---------------------------------------------------------------- transfer

console.log('\n# transferir a reprodução para o celular');
desktop.progress(25000, tracks[2].durationMs, true);
await settle();
phone.cmd({ type: 'transfer', deviceId: 'test-phone', play: true });
await settle();

check('celular virou o ativo', phone.state.activeDeviceId === 'test-phone');
check('desktop foi avisado', desktop.state.activeDeviceId === 'test-phone');
check('posição foi preservada na transferência', phone.state.positionMs === 25000,
  `${phone.state.positionMs}ms`);
check('continua tocando', phone.state.isPlaying === true);
check('mesma faixa', phone.state.trackId === tracks[2].id);

phone.progress(26000, tracks[2].durationMs, true);
await settle();
check('agora o celular manda no relógio', phone.state.positionMs === 26000);

desktop.progress(1, 1, true);
await settle();
check('desktop (agora inativo) não mexe mais na posição', phone.state.positionMs === 26000,
  `${phone.state.positionMs}ms`);

// ---------------------------------------------------------------- end of track

console.log('\n# fim de faixa avança sozinho');
phone.cmd({ type: 'trackEnded' });
await settle();
check('avançou para a próxima da fila', phone.state.trackId === tracks[0].id);
check('continua tocando', phone.state.isPlaying === true);

phone.cmd({ type: 'trackEnded' });
await settle();
check('fim da fila com repeat off para a reprodução', phone.state.isPlaying === false);

// Regression: a track parked at its own end had nowhere to resume to, so play looked dead
// while the position bounced between 0 and the duration on every other device.
phone.cmd({ type: 'seek', positionMs: phone.state.durationMs });
await settle();
phone.cmd({ type: 'play' });
await settle();
check('play no fim da faixa rebobina em vez de travar', phone.state.positionMs === 0,
  `${phone.state.positionMs}ms`);
check('e volta a tocar', phone.state.isPlaying === true);
phone.cmd({ type: 'pause' });
await settle();

console.log('\n# repeat de fila');
phone.cmd({ type: 'repeat', repeat: 'context' });
phone.cmd({ type: 'trackEnded' });
await settle();
check('com repeat=context volta ao começo', phone.state.trackId === tracks[2].id && phone.state.isPlaying);

// ---------------------------------------------------------------- shuffle

console.log('\n# aleatório');
phone.cmd({ type: 'repeat', repeat: 'off' });
phone.cmd({
  type: 'playContext', contextId: 'shuf', contextName: 'Shuffle',
  trackIds: tracks.map((t) => t.id), startIndex: 0,
});
await settle();
const orderedQueue = [...phone.state.queue];
phone.cmd({ type: 'shuffle', shuffle: true });
await settle();
check('fila embaralhada mantém o mesmo conjunto',
  phone.state.queue.length === orderedQueue.length &&
  new Set(phone.state.queue).size === new Set(orderedQueue).size);
check('a faixa atual continua tocando após embaralhar', phone.state.trackId === orderedQueue[0]);

phone.cmd({ type: 'shuffle', shuffle: false });
await settle();
check('desligar o aleatório restaura a ordem original',
  JSON.stringify(phone.state.queue) === JSON.stringify(orderedQueue));

// ---------------------------------------------------------------- disconnect

console.log('\n# aparelho ativo cai');
// Counted as a delta: real clients may be connected to the same server while this runs.
const devicesBefore = desktop.devices.length;
phone.close();
await settle(400);
check('a reprodução pausa quando o ativo some', desktop.state.isPlaying === false);
check('o posto de ativo fica livre', desktop.state.activeDeviceId === null);
check('lista de aparelhos encolheu em um', desktop.devices.length === devicesBefore - 1,
  `${devicesBefore} -> ${desktop.devices.length}`);

console.log('\n# desktop reassume');
desktop.cmd({ type: 'play' });
await settle();
check('play em aparelho livre reivindica o áudio', desktop.state.activeDeviceId === 'test-desktop');
check('voltou a tocar', desktop.state.isPlaying === true);

desktop.close();

// ---------------------------------------------------------------- REST

console.log('\n# REST: playlists');
const created = await (await fetch(`${API}/api/playlists`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Teste automatizado' }),
})).json();
check('playlist criada', Boolean(created.id));

await fetch(`${API}/api/playlists/${created.id}/tracks`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ trackId: tracks[0].id }),
});
await fetch(`${API}/api/playlists/${created.id}/tracks`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ trackId: tracks[1].id }),
});
let detail = await (await fetch(`${API}/api/playlists/${created.id}`)).json();
check('duas faixas adicionadas', detail.tracks.length === 2, `${detail.tracks.length}`);
check('duração somada', detail.durationMs === tracks[0].durationMs + tracks[1].durationMs);

detail = await (await fetch(`${API}/api/playlists/${created.id}/order`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ trackIds: [tracks[1].id, tracks[0].id] }),
})).json();
check('reordenação aplicada', detail.tracks[0].id === tracks[1].id);

detail = await (await fetch(`${API}/api/playlists/${created.id}/tracks/${encodeURIComponent(tracks[1].id)}`, {
  method: 'DELETE',
})).json();
check('faixa removida', detail.tracks.length === 1 && detail.tracks[0].id === tracks[0].id);

// A cover is optional art for a playlist; removing it must not leave the file behind.
const pngPixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const withArt = await (await fetch(`${API}/api/playlists/${created.id}/cover`, {
  method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: pngPixel,
})).json();
check('playlist aceita uma imagem', typeof withArt.coverUrl === 'string', withArt.coverUrl);
check('a imagem é servida', (await fetch(`${API}${withArt.coverUrl}`)).status === 200);
const listedArt = await (await fetch(`${API}/api/playlists`)).json();
check('a listagem também traz a capa',
  listedArt.find((p) => p.id === created.id).coverUrl === withArt.coverUrl);

const noArt = await (await fetch(`${API}/api/playlists/${created.id}/cover`, { method: 'DELETE' })).json();
check('imagem removida', noArt.coverUrl === null);
check('o arquivo órfão foi apagado', (await fetch(`${API}${withArt.coverUrl}`)).status === 404);

const delRes = await fetch(`${API}/api/playlists/${created.id}`, { method: 'DELETE' });
check('playlist excluída', delRes.status === 204);
const gone = await fetch(`${API}/api/playlists/${created.id}`);
check('playlist some depois de excluída', gone.status === 404);

// ---------------------------------------------------------------- streaming

console.log('\n# streaming com Range');
const full = await fetch(`${API}/stream/${encodeURIComponent(tracks[0].id)}`, { method: 'HEAD' });
check('HEAD responde 200', full.status === 200);
check('anuncia suporte a range', full.headers.get('accept-ranges') === 'bytes');
const size = Number(full.headers.get('content-length'));
check('tamanho informado', size > 1000, `${size} bytes`);

const partial = await fetch(`${API}/stream/${encodeURIComponent(tracks[0].id)}`, {
  headers: { Range: 'bytes=100-199' },
});
check('range devolve 206', partial.status === 206);
check('Content-Range correto', partial.headers.get('content-range') === `bytes 100-199/${size}`,
  partial.headers.get('content-range') ?? '');
const bytes = new Uint8Array(await partial.arrayBuffer());
check('veio exatamente 100 bytes', bytes.length === 100, `${bytes.length}`);

const suffix = await fetch(`${API}/stream/${encodeURIComponent(tracks[0].id)}`, {
  headers: { Range: 'bytes=-50' },
});
check('range de sufixo funciona', suffix.status === 206 &&
  suffix.headers.get('content-range') === `bytes ${size - 50}-${size - 1}/${size}`);

const bad = await fetch(`${API}/stream/${encodeURIComponent(tracks[0].id)}`, {
  headers: { Range: `bytes=${size + 10}-` },
});
check('range fora do arquivo devolve 416', bad.status === 416, `${bad.status}`);

const missing = await fetch(`${API}/stream/nao-existe`);
check('faixa inexistente devolve 404', missing.status === 404);

console.log(`\n${failures === 0 ? 'TODOS OS TESTES PASSARAM' : `${failures} FALHA(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
