import http from 'node:http';
import { WebSocketServer } from 'ws';
import type { Platform } from '@nebula/protocol';
import { extname } from 'node:path';
import { PORT, HOST, CATALOG_DIR, IMAGE_EXT_BY_MIME } from './config.ts';
import {
  listTracks, searchTracks, getTrack, getTrackFile,
  listPlaylists, createPlaylist, getPlaylist, updatePlaylist, deletePlaylist,
  addTrackToPlaylist, removeTrackFromPlaylist, reorderPlaylist,
  setPlaylistCover, setAlbumCover,
} from './db.ts';
import { saveCover, discardCover, coverPath } from './covers.ts';
import { initLibrary } from './library.ts';
import { streamFile } from './stream.ts';
import { hub } from './hub.ts';
import {
  catalogOverview, addCatalogTrack, updateCatalogTrack, deleteCatalogTrack, renameAlbum,
} from './admin.ts';
import { toolStatus, probeUrl, startImport, getJob, cancelJob, type ImportItemInput } from './import.ts';
import { providerCatalog } from './providers.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD',
  'Access-Control-Allow-Headers': 'Content-Type,X-Admin-Token',
};

/**
 * Optional shared secret for the backoffice. Unset on a home LAN it stays open, which is
 * the practical default here; set NEBULA_ADMIN_TOKEN to require it.
 */
const ADMIN_TOKEN = process.env.NEBULA_ADMIN_TOKEN ?? '';

function adminAllowed(req: http.IncomingMessage, url: URL): boolean {
  if (!ADMIN_TOKEN) return true;
  const header = req.headers['x-admin-token'];
  const provided = Array.isArray(header) ? header[0] : header ?? url.searchParams.get('token');
  return provided === ADMIN_TOKEN;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

async function readJson<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > 1_000_000) throw new Error('corpo grande demais');
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  try {
    // ---------------------------------------------------------------- health
    if (path === '/api/health') {
      return json(res, 200, {
        ok: true,
        tracks: listTracks().length,
        playlists: listPlaylists().length,
        devices: hub.getDevices().length,
        uptimeSec: Math.round(process.uptime()),
      });
    }

    // ---------------------------------------------------------------- tracks
    if (path === '/api/tracks' && method === 'GET') {
      const q = url.searchParams.get('q');
      if (q && q.trim()) return json(res, 200, searchTracks(q.trim()));
      const source = url.searchParams.get('source');
      return json(res, 200, listTracks(source ?? undefined));
    }

    // ---------------------------------------------------------------- playback snapshot
    if (path === '/api/state' && method === 'GET') {
      return json(res, 200, { state: hub.getState(), devices: hub.getDevices() });
    }

    // ---------------------------------------------------------------- playlists
    if (path === '/api/playlists' && method === 'GET') {
      return json(res, 200, listPlaylists());
    }

    if (path === '/api/playlists' && method === 'POST') {
      const body = await readJson<{ name?: string; description?: string }>(req);
      const name = (body.name ?? '').trim();
      if (!name) return json(res, 400, { error: 'nome é obrigatório' });
      const playlist = createPlaylist(name, (body.description ?? '').trim());
      hub.notifyLibraryChanged('playlist-created');
      return json(res, 201, playlist);
    }

    const plMatch = /^\/api\/playlists\/([^/]+)$/.exec(path);
    if (plMatch) {
      const id = decodeURIComponent(plMatch[1]);
      if (method === 'GET') {
        const pl = getPlaylist(id);
        return pl ? json(res, 200, pl) : json(res, 404, { error: 'playlist não encontrada' });
      }
      if (method === 'PATCH') {
        const body = await readJson<{ name?: string; description?: string }>(req);
        const pl = updatePlaylist(id, body);
        if (!pl) return json(res, 404, { error: 'playlist não encontrada' });
        hub.notifyLibraryChanged('playlist-updated');
        return json(res, 200, pl);
      }
      if (method === 'DELETE') {
        const gone = deletePlaylist(id);
        if (!gone) return json(res, 404, { error: 'playlist não encontrada' });
        await discardCover(gone.cover);
        hub.notifyLibraryChanged('playlist-deleted');
        return json(res, 204, null);
      }
    }

    const plTracks = /^\/api\/playlists\/([^/]+)\/tracks$/.exec(path);
    if (plTracks && method === 'POST') {
      const id = decodeURIComponent(plTracks[1]);
      const body = await readJson<{ trackId?: string; trackIds?: string[] }>(req);
      const ids = body.trackIds ?? (body.trackId ? [body.trackId] : []);
      if (ids.length === 0) return json(res, 400, { error: 'trackId é obrigatório' });
      let added = 0;
      for (const trackId of ids) if (addTrackToPlaylist(id, trackId)) added++;
      if (added === 0) return json(res, 404, { error: 'playlist ou faixa não encontrada' });
      hub.notifyLibraryChanged('playlist-tracks');
      return json(res, 200, getPlaylist(id));
    }

    const plTrack = /^\/api\/playlists\/([^/]+)\/tracks\/([^/]+)$/.exec(path);
    if (plTrack && method === 'DELETE') {
      const id = decodeURIComponent(plTrack[1]);
      const trackId = decodeURIComponent(plTrack[2]);
      if (!removeTrackFromPlaylist(id, trackId)) return json(res, 404, { error: 'faixa não está na playlist' });
      hub.notifyLibraryChanged('playlist-tracks');
      return json(res, 200, getPlaylist(id));
    }

    const plOrder = /^\/api\/playlists\/([^/]+)\/order$/.exec(path);
    if (plOrder && method === 'PUT') {
      const id = decodeURIComponent(plOrder[1]);
      const body = await readJson<{ trackIds?: string[] }>(req);
      if (!Array.isArray(body.trackIds)) return json(res, 400, { error: 'trackIds é obrigatório' });
      if (!reorderPlaylist(id, body.trackIds)) return json(res, 404, { error: 'playlist vazia ou inexistente' });
      hub.notifyLibraryChanged('playlist-reordered');
      return json(res, 200, getPlaylist(id));
    }

    // ---------------------------------------------------------------- covers
    const plCover = /^\/api\/playlists\/([^/]+)\/cover$/.exec(path);
    if (plCover) {
      const id = decodeURIComponent(plCover[1]);
      if (method === 'PUT') {
        const file = await saveCover(req, req.headers['content-type']);
        const result = setPlaylistCover(id, file);
        if (!result) {
          await discardCover(file);
          return json(res, 404, { error: 'playlist não encontrada' });
        }
        await discardCover(result.previous);
        hub.notifyLibraryChanged('playlist-cover');
        return json(res, 200, getPlaylist(id));
      }
      if (method === 'DELETE') {
        const result = setPlaylistCover(id, null);
        if (!result) return json(res, 404, { error: 'playlist não encontrada' });
        await discardCover(result.previous);
        hub.notifyLibraryChanged('playlist-cover');
        return json(res, 200, getPlaylist(id));
      }
    }

    // ---------------------------------------------------------------- backoffice
    if (path.startsWith('/api/admin/')) {
      if (!adminAllowed(req, url)) return json(res, 401, { error: 'token de administração inválido' });

      if (path === '/api/admin/overview' && method === 'GET') {
        return json(res, 200, {
          ...(await catalogOverview()),
          catalogDir: CATALOG_DIR,
          protected: ADMIN_TOKEN.length > 0,
        });
      }

      if (path === '/api/admin/catalog' && method === 'POST') {
        const name = url.searchParams.get('name');
        if (!name) return json(res, 400, { error: 'parâmetro "name" é obrigatório' });
        const entry = await addCatalogTrack(req, {
          name,
          title: url.searchParams.get('title') ?? undefined,
          artist: url.searchParams.get('artist') ?? undefined,
          album: url.searchParams.get('album') ?? undefined,
          license: url.searchParams.get('license') ?? undefined,
          sourceUrl: url.searchParams.get('sourceUrl') ?? undefined,
        });
        return json(res, 201, entry);
      }

      // ------------------------------------------------------- import from the web
      if (path === '/api/admin/import/tools' && method === 'GET') {
        return json(res, 200, await toolStatus(url.searchParams.get('refresh') === '1'));
      }

      if (path === '/api/admin/import/providers' && method === 'GET') {
        return json(res, 200, { providers: providerCatalog() });
      }

      if (path === '/api/admin/import/probe' && method === 'POST') {
        const body = await readJson<{ url?: string }>(req);
        if (!body.url) return json(res, 400, { error: 'informe uma URL' });
        return json(res, 200, await probeUrl(body.url));
      }

      if (path === '/api/admin/import' && method === 'POST') {
        const body = await readJson<{ items?: ImportItemInput[] }>(req);
        const items = (body.items ?? []).filter((i) => typeof i?.url === 'string' && i.url.length > 0);
        return json(res, 202, await startImport(items));
      }

      const importJob = /^\/api\/admin\/import\/([0-9a-f-]{36})$/.exec(path);
      if (importJob) {
        const jobId = importJob[1];
        if (method === 'DELETE') {
          return json(res, 200, { cancelled: cancelJob(jobId) });
        }
        const job = getJob(jobId);
        if (!job) return json(res, 404, { error: 'trabalho não encontrado ou já expirado' });
        return json(res, 200, job);
      }

      if (path === '/api/admin/albums' && method === 'PATCH') {
        const body = await readJson<{ from?: string; album?: string; artist?: string }>(req);
        if (!body.from) return json(res, 400, { error: '"from" é obrigatório' });
        const changed = await renameAlbum(body.from, body);
        return json(res, 200, { changed });
      }

      if (path === '/api/admin/albums/cover' && (method === 'PUT' || method === 'DELETE')) {
        const album = url.searchParams.get('album');
        if (!album) return json(res, 400, { error: 'parâmetro "album" é obrigatório' });

        if (method === 'DELETE') {
          const cleared = setAlbumCover(album, null);
          if (cleared.changed === 0) return json(res, 404, { error: 'álbum não encontrado' });
          for (const old of cleared.previous) await discardCover(old);
          hub.notifyLibraryChanged('album-cover');
          return json(res, 200, { changed: cleared.changed });
        }

        const file = await saveCover(req, req.headers['content-type']);
        const applied = setAlbumCover(album, file);
        if (applied.changed === 0) {
          await discardCover(file);
          return json(res, 404, { error: 'álbum não encontrado' });
        }
        for (const old of applied.previous) await discardCover(old);
        hub.notifyLibraryChanged('album-cover');
        return json(res, 200, { changed: applied.changed });
      }

      const adminTrack = /^\/api\/admin\/catalog\/(.+)$/.exec(path);
      if (adminTrack) {
        const id = decodeURIComponent(adminTrack[1]);
        if (method === 'PATCH') {
          const body = await readJson<
            { title?: string; artist?: string; album?: string; license?: string; sourceUrl?: string }
          >(req);
          return json(res, 200, await updateCatalogTrack(id, body));
        }
        if (method === 'DELETE') {
          await deleteCatalogTrack(id, url.searchParams.get('keepFile') === '1');
          return json(res, 204, null);
        }
      }

      return json(res, 404, { error: `rota de admin não encontrada: ${method} ${path}` });
    }

    // ---------------------------------------------------------------- images
    const coverMatch = /^\/cover\/([^/]+)$/.exec(path);
    if (coverMatch && (method === 'GET' || method === 'HEAD')) {
      const file = coverPath(decodeURIComponent(coverMatch[1]));
      if (!file) return json(res, 404, { error: 'imagem não encontrada' });
      const mime = Object.entries(IMAGE_EXT_BY_MIME)
        .find(([, ext]) => ext === extname(file).toLowerCase())?.[0] ?? 'application/octet-stream';
      return streamFile(req, res, file, mime);
    }

    // ---------------------------------------------------------------- audio
    const streamMatch = /^\/stream\/([^/]+)$/.exec(path);
    if (streamMatch && (method === 'GET' || method === 'HEAD')) {
      const trackId = decodeURIComponent(streamMatch[1]);
      const file = getTrackFile(trackId);
      if (!file) return json(res, 404, { error: 'faixa não encontrada' });
      return streamFile(req, res, file.path, file.mime);
    }

    const trackMatch = /^\/api\/tracks\/([^/]+)$/.exec(path);
    if (trackMatch && method === 'GET') {
      const track = getTrack(decodeURIComponent(trackMatch[1]));
      return track ? json(res, 200, track) : json(res, 404, { error: 'faixa não encontrada' });
    }

    return json(res, 404, { error: `rota não encontrada: ${method} ${path}` });
  } catch (err) {
    // Handlers signal expected failures by tagging the error with an HTTP status;
    // anything untagged is a genuine bug and deserves the 500 plus a stack in the log.
    const status = (err as { status?: number }).status ?? 500;
    if (status >= 500) console.error('[http]', method, path, err);
    return json(res, status, { error: (err as Error).message });
  }
});

// -------------------------------------------------------------------- websocket

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/ws', 'http://localhost');
  const id = url.searchParams.get('deviceId');
  const name = url.searchParams.get('name') ?? 'Dispositivo';
  const platform = (url.searchParams.get('platform') ?? 'web') as Platform;

  if (!id) {
    ws.close(4001, 'deviceId é obrigatório');
    return;
  }

  hub.register(ws, { id, name, platform });

  let alive = true;
  ws.on('pong', () => { alive = true; });
  // Half-open TCP connections (laptop lid closed, phone off wifi) never fire 'close'.
  // Without this heartbeat a dead device would keep holding the "active" crown forever.
  const heartbeat = setInterval(() => {
    if (!alive) { ws.terminate(); return; }
    alive = false;
    try { ws.ping(); } catch { /* closing */ }
  }, 15000);

  ws.on('message', (data) => hub.handleMessage(id, data.toString()));
  ws.on('close', () => { clearInterval(heartbeat); hub.unregister(id); });
  ws.on('error', () => { clearInterval(heartbeat); hub.unregister(id); });
});

// -------------------------------------------------------------------- boot

await initLibrary();

server.listen(PORT, HOST, () => {
  console.log(`\n  Nebula server`);
  console.log(`  http://localhost:${PORT}  ·  ws://localhost:${PORT}/ws`);
  console.log(`  catálogo: ${CATALOG_DIR}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log('\n[server] encerrando...');
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
