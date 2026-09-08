import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDuration } from '@nebula/protocol';
import { imageToBlob } from '@nebula/browser';
import {
  admin, coverSrc, type AdminTrack, type Overview, streamUrl, getToken, setToken,
} from './api.ts';
import { ImportPanel } from './ImportPanel.tsx';

/** Same deterministic palette the players use, so covers match across every surface. */
const PALETTES: Array<[string, string]> = [
  ['#A855F7', '#EC4899'], ['#7C3AED', '#2DD4BF'], ['#F472B6', '#8B5CF6'],
  ['#6366F1', '#A855F7'], ['#DB2777', '#7C3AED'], ['#8B5CF6', '#38BDF8'],
  ['#C026D3', '#F59E0B'], ['#4C1D95', '#EC4899'], ['#9333EA', '#22D3EE'],
  ['#E879F9', '#6D28D9'],
];
function paletteFor(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTES[h % PALETTES.length];
}
const gradient = (seed: string) => {
  const [a, b] = paletteFor(seed);
  return `linear-gradient(140deg, ${a}, ${b})`;
};

const formatSize = (bytes: number) =>
  bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

function totalLabel(ms: number): string {
  const min = Math.round(ms / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

interface Editing { id: string; title: string; artist: string; album: string }
interface Upload { name: string; status: 'enviando' | 'ok' | 'erro'; detail?: string }

/**
 * A file chosen but not published yet. Dropping a whole album and only then discovering the
 * metadata was wrong means fixing a dozen rows one by one, so nothing is sent until the
 * listener confirms this list.
 */
interface Draft { file: File; title: string; artist: string; album: string }

/** "Artista - Título.mp3" is the near-universal convention; anything else becomes the title. */
function describe(fileName: string): { title: string; artist: string } {
  const stem = fileName.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const split = stem.match(/^(.{1,60}?)\s+[-–—]\s+(.+)$/);
  if (split) return { artist: split[1].trim(), title: split[2].trim() };
  return { artist: '', title: stem || fileName };
}

export default function App() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirm, setConfirm] = useState<AdminTrack | null>(null);
  const [albumEdit, setAlbumEdit] = useState<{ from: string; album: string; artist: string } | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [draftCover, setDraftCover] = useState<{ blob: Blob; preview: string } | null>(null);
  const [albumCoverBusy, setAlbumCoverBusy] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState(getToken());
  const [meta, setMeta] = useState({ artist: '', album: '' });
  const [tab, setTab] = useState<'catalog' | 'import'>('catalog');

  const fileInput = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (!audioRef.current && typeof Audio !== 'undefined') audioRef.current = new Audio();

  const notify = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    setToast({ text, kind });
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 3200);
  }, []);

  const load = useCallback(async () => {
    try {
      setData(await admin.overview());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.tracks;
    return data.tracks.filter((t) =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      t.album.toLowerCase().includes(q));
  }, [data, query]);

  // ---------------------------------------------------------------- actions

  /** Opens the confirmation dialog. Nothing reaches the catalog until it is accepted. */
  const stageFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    setDrafts(files.map((file) => {
      const guess = describe(file.name);
      return {
        file,
        title: guess.title,
        artist: meta.artist.trim() || guess.artist,
        album: meta.album.trim(),
      };
    }));
    setDraftCover(null);
  }, [meta]);

  const publishDrafts = useCallback(async (confirmed: Draft[]) => {
    setDrafts(null);
    setUploads(confirmed.map((d) => ({ name: d.file.name, status: 'enviando' as const })));

    const albums = new Set<string>();
    for (const draft of confirmed) {
      try {
        await admin.upload(draft.file, {
          title: draft.title.trim() || undefined,
          artist: draft.artist.trim() || undefined,
          album: draft.album.trim() || undefined,
        });
        if (draft.album.trim()) albums.add(draft.album.trim());
        setUploads((prev) => prev.map((u) => (u.name === draft.file.name ? { ...u, status: 'ok' } : u)));
      } catch (err) {
        setUploads((prev) => prev.map((u) => (
          u.name === draft.file.name ? { ...u, status: 'erro', detail: (err as Error).message } : u)));
      }
    }

    // The cover is per album, so it is applied once the tracks exist under that name.
    if (draftCover) {
      for (const album of albums) {
        try {
          await admin.setAlbumCover(album, draftCover.blob);
        } catch (err) {
          notify(`Imagem de “${album}”: ${(err as Error).message}`, 'error');
        }
      }
      URL.revokeObjectURL(draftCover.preview);
      setDraftCover(null);
    }

    await load();
    notify('Envio concluído');
    setTimeout(() => setUploads([]), 4000);
  }, [draftCover, load, notify]);

  const pickAlbumCover = useCallback((album: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setAlbumCoverBusy(album);
      try {
        await admin.setAlbumCover(album, await imageToBlob(file));
        await load();
        notify(`Imagem de “${album}” atualizada`);
      } catch (err) {
        notify((err as Error).message, 'error');
      } finally {
        setAlbumCoverBusy(null);
      }
    };
    input.click();
  }, [load, notify]);

  const clearAlbumCover = useCallback(async (album: string) => {
    setAlbumCoverBusy(album);
    try {
      await admin.setAlbumCover(album, null);
      await load();
      notify(`Imagem de “${album}” removida`);
    } catch (err) {
      notify((err as Error).message, 'error');
    } finally {
      setAlbumCoverBusy(null);
    }
  }, [load, notify]);

  const saveEdit = useCallback(async () => {
    if (!editing) return;
    try {
      await admin.update(editing.id, {
        title: editing.title, artist: editing.artist, album: editing.album,
      });
      setEditing(null);
      await load();
      notify('Faixa atualizada');
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  }, [editing, load, notify]);

  const doDelete = useCallback(async () => {
    if (!confirm) return;
    try {
      await admin.remove(confirm.id);
      setConfirm(null);
      await load();
      notify('Faixa removida do catálogo');
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  }, [confirm, load, notify]);

  const togglePreview = useCallback((track: AdminTrack) => {
    const el = audioRef.current;
    if (!el) return;
    if (preview === track.id) {
      el.pause();
      setPreview(null);
      return;
    }
    el.src = streamUrl(track.id);
    el.play().then(() => setPreview(track.id)).catch(() => notify('Não foi possível tocar o arquivo', 'error'));
    el.onended = () => setPreview(null);
  }, [preview, notify]);

  // ---------------------------------------------------------------- render

  if (error && !data) {
    return (
      <div className="shell">
        <div className="panel">
          <div className="panel-body empty">
            <h3>Não consegui falar com o servidor</h3>
            <p>{error}</p>
            <p style={{ marginTop: 12 }}>
              Confira se o servidor Nebula está no ar e se o token de administração está correto.
            </p>
            <div style={{ maxWidth: 320, margin: '18px auto 0' }}>
              <input
                className="field"
                placeholder="Token de administração"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
              />
              <button
                className="btn btn-primary"
                style={{ marginTop: 10, width: '100%' }}
                onClick={() => { setToken(tokenInput); void load(); }}
              >
                Tentar de novo
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="header">
        <div className="mark">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.6" />
          </svg>
        </div>
        <div className="title-block">
          <h1>Nebula · Backoffice</h1>
          <p>Curadoria do catálogo. As playlists são de cada ouvinte e não aparecem aqui.</p>
        </div>
        <div className="spacer" />
        <div className="conn">
          <span className={`dot ${data ? '' : 'off'}`} />
          {data ? 'Conectado' : 'Sem conexão'}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load}>Atualizar</button>
      </header>

      {data && (
        <>
          <div className="stats">
            <div className="stat">
              <div className="stat-label">Faixas no catálogo</div>
              <div className="stat-value accent">{data.totals.tracks}</div>
              <div className="stat-hint">{totalLabel(data.totals.durationMs)} de música</div>
            </div>
            <div className="stat">
              <div className="stat-label">Álbuns</div>
              <div className="stat-value">{data.albums.length}</div>
              <div className="stat-hint">agrupados por metadado</div>
            </div>
            <div className="stat">
              <div className="stat-label">Tamanho em disco</div>
              <div className="stat-value">{formatSize(data.totals.sizeBytes)}</div>
              <div className="stat-hint">áudio do catálogo</div>
            </div>
            <div className="stat">
              <div className="stat-label">Playlists dos ouvintes</div>
              <div className="stat-value">{data.totals.playlists}</div>
              <div className="stat-hint">somente leitura aqui</div>
            </div>
          </div>

          <div className="tabs">
            <button className={`tab ${tab === 'catalog' ? 'on' : ''}`} onClick={() => setTab('catalog')}>
              Catálogo
            </button>
            <button className={`tab ${tab === 'import' ? 'on' : ''}`} onClick={() => setTab('import')}>
              Importar da web
            </button>
          </div>

          {tab === 'import' && <ImportPanel onImported={load} onToast={notify} />}

          {/* ---------------------------------------------------- upload */}

          <section className="panel" hidden={tab !== 'catalog'}>
            <div className="panel-head">
              <div>
                <h2>Inserir músicas</h2>
                <p>Os arquivos vão para <code>{data.catalogDir}</code> e ficam disponíveis em todas as plataformas.</p>
              </div>
            </div>
            <div className="panel-body">
              <div
                className={`drop ${dragOver ? 'over' : ''}`}
                onClick={() => fileInput.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  stageFiles(Array.from(e.dataTransfer.files));
                }}
              >
                <h3>Arraste arquivos de áudio aqui</h3>
                <p>ou clique para escolher · mp3, m4a, aac, wav, flac, ogg, opus</p>
                <p>Nada é publicado antes de você conferir as informações.</p>
              </div>

              <div className="meta-grid">
                <div>
                  <label className="label" htmlFor="up-artist">Artista (opcional)</label>
                  <input
                    id="up-artist" className="field" placeholder="Aplicado a todos os arquivos"
                    value={meta.artist} onChange={(e) => setMeta({ ...meta, artist: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="up-album">Álbum (opcional)</label>
                  <input
                    id="up-album" className="field" placeholder="Aplicado a todos os arquivos"
                    value={meta.album} onChange={(e) => setMeta({ ...meta, album: e.target.value })}
                  />
                </div>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 9 }}>
                Servem de ponto de partida no diálogo de conferência — dá para ajustar arquivo
                por arquivo antes de publicar.
              </p>

              <input
                ref={fileInput} type="file" multiple hidden
                accept="audio/*,.mp3,.m4a,.flac,.wav,.ogg,.opus,.aac"
                onChange={(e) => { stageFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}
              />

              {uploads.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  {uploads.map((u) => (
                    <div key={u.name} className="progress-row">
                      <span className="truncate" style={{ flex: 1 }}>{u.name}</span>
                      <span className={`tag ${u.status === 'erro' ? 'warn' : u.status === 'ok' ? '' : 'muted'}`}>
                        {u.status === 'ok' ? 'enviado' : u.status === 'erro' ? (u.detail ?? 'erro') : 'enviando...'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* ---------------------------------------------------- albums */}

          {tab === 'catalog' && data.albums.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Álbuns</h2>
                  <p>Renomeie um álbum inteiro de uma vez.</p>
                </div>
              </div>
              <div className="panel-body">
                <div className="album-grid">
                  {data.albums.map((album) => (
                    <div key={album.name} className="album-card">
                      <div className="album-art" style={{ background: gradient(album.name) }}>
                        {album.coverUrl && (
                          <img className="album-art-img" src={coverSrc(album.coverUrl) ?? ''} alt="" />
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="cell-title truncate">{album.name}</div>
                        <div className="cell-sub truncate">
                          {album.artist} · {album.count} {album.count === 1 ? 'faixa' : 'faixas'}
                        </div>
                      </div>
                      <button
                        className="icon-btn"
                        title={album.coverUrl ? 'Trocar imagem do álbum' : 'Definir imagem do álbum'}
                        aria-label={`Imagem de ${album.name}`}
                        disabled={albumCoverBusy === album.name}
                        onClick={() => pickAlbumCover(album.name)}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="4.5" width="18" height="15" rx="2.4" />
                          <circle cx="8.5" cy="10" r="1.6" />
                          <path d="m4 17 4.8-4.6a1.6 1.6 0 0 1 2.2 0L16 17" />
                        </svg>
                      </button>
                      {album.coverUrl && (
                        <button
                          className="icon-btn"
                          title="Remover imagem do álbum"
                          aria-label={`Remover imagem de ${album.name}`}
                          disabled={albumCoverBusy === album.name}
                          onClick={() => void clearAlbumCover(album.name)}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                            <path d="m6 6 12 12" /><path d="M18 6 6 18" />
                          </svg>
                        </button>
                      )}
                      <button
                        className="icon-btn"
                        title="Renomear álbum"
                        aria-label={`Renomear ${album.name}`}
                        onClick={() => setAlbumEdit({ from: album.name, album: album.name, artist: album.artist })}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                          <path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 17z" /><path d="M14.5 6.5 17.5 9.5" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* ---------------------------------------------------- table */}

          <section className="panel" hidden={tab !== 'catalog'}>
            <div className="panel-head">
              <div>
                <h2>Faixas do catálogo</h2>
                <p>Clique no lápis para corrigir metadados, ou no play para ouvir antes de publicar.</p>
              </div>
            </div>

            <div className="toolbar">
              <div className="search">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" strokeLinecap="round" />
                </svg>
                <input
                  placeholder="Filtrar por título, artista ou álbum"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                {filtered.length} de {data.tracks.length}
              </span>
            </div>

            {filtered.length === 0 ? (
              <div className="empty">
                <h3>{data.tracks.length === 0 ? 'Catálogo vazio' : 'Nada encontrado'}</h3>
                <p>
                  {data.tracks.length === 0
                    ? 'Envie arquivos no bloco acima para começar a montar o catálogo.'
                    : 'Ajuste o filtro para ver outras faixas.'}
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 44 }} />
                      <th>Faixa</th>
                      <th style={{ width: 190 }}>Álbum</th>
                      <th style={{ width: 90 }}>Duração</th>
                      <th style={{ width: 90 }}>Arquivo</th>
                      <th style={{ width: 110 }}>Playlists</th>
                      <th style={{ width: 100 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((track) => {
                      const isEditing = editing?.id === track.id;
                      return (
                        <tr key={track.id} className={isEditing ? 'editing' : ''}>
                          <td>
                            <button
                              className={`icon-btn ${preview === track.id ? 'on' : ''}`}
                              onClick={() => togglePreview(track)}
                              title={preview === track.id ? 'Parar' : 'Ouvir'}
                              aria-label={preview === track.id ? 'Parar prévia' : `Ouvir ${track.title}`}
                            >
                              {preview === track.id ? (
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                                  <rect x="7" y="5" width="3.6" height="14" rx="1.1" />
                                  <rect x="13.4" y="5" width="3.6" height="14" rx="1.1" />
                                </svg>
                              ) : (
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M8 5.2v13.6a.6.6 0 0 0 .92.5l10.5-6.8a.6.6 0 0 0 0-1L8.92 4.7a.6.6 0 0 0-.92.5z" />
                                </svg>
                              )}
                            </button>
                          </td>

                          <td>
                            <div className="cell-main">
                              <div className="cell-art" style={{ background: gradient(track.album || track.id) }} />
                              {isEditing ? (
                                <div style={{ flex: 1, display: 'grid', gap: 6 }}>
                                  <input
                                    className="edit-input" autoFocus value={editing.title}
                                    onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                                    onKeyDown={(e) => { if (e.key === 'Enter') void saveEdit(); if (e.key === 'Escape') setEditing(null); }}
                                  />
                                  <input
                                    className="edit-input" value={editing.artist}
                                    onChange={(e) => setEditing({ ...editing, artist: e.target.value })}
                                    onKeyDown={(e) => { if (e.key === 'Enter') void saveEdit(); if (e.key === 'Escape') setEditing(null); }}
                                  />
                                </div>
                              ) : (
                                <div style={{ minWidth: 0 }}>
                                  <div className="cell-title truncate">{track.title}</div>
                                  <div className="cell-sub truncate">{track.artist}</div>
                                </div>
                              )}
                            </div>
                          </td>

                          <td>
                            {isEditing ? (
                              <input
                                className="edit-input" value={editing.album}
                                onChange={(e) => setEditing({ ...editing, album: e.target.value })}
                                onKeyDown={(e) => { if (e.key === 'Enter') void saveEdit(); if (e.key === 'Escape') setEditing(null); }}
                              />
                            ) : (
                              <span className="truncate" style={{ display: 'block' }}>{track.album}</span>
                            )}
                          </td>

                          <td className="mono">{formatDuration(track.durationMs)}</td>
                          <td className="mono">{formatSize(track.sizeBytes)}</td>
                          <td>
                            {track.inPlaylists > 0 ? (
                              <span className="tag warn">em {track.inPlaylists}</span>
                            ) : (
                              <span className="tag muted">nenhuma</span>
                            )}
                          </td>

                          <td>
                            <div className="row-actions">
                              {isEditing ? (
                                <>
                                  <button className="icon-btn" onClick={saveEdit} title="Salvar" aria-label="Salvar">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="m4.5 12.5 5 5 10-11" />
                                    </svg>
                                  </button>
                                  <button className="icon-btn" onClick={() => setEditing(null)} title="Cancelar" aria-label="Cancelar">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                      <path d="m6 6 12 12" /><path d="M18 6 6 18" />
                                    </svg>
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    className="icon-btn"
                                    onClick={() => setEditing({ id: track.id, title: track.title, artist: track.artist, album: track.album })}
                                    title="Editar" aria-label={`Editar ${track.title}`}
                                  >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 17z" /><path d="M14.5 6.5 17.5 9.5" />
                                    </svg>
                                  </button>
                                  <button
                                    className="icon-btn danger"
                                    onClick={() => setConfirm(track)}
                                    title="Remover" aria-label={`Remover ${track.title}`}
                                  >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M4 6.5h16" />
                                      <path d="M9.5 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
                                      <path d="M6.5 6.5 7.4 20a1.3 1.3 0 0 0 1.3 1.2h6.6a1.3 1.3 0 0 0 1.3-1.2l.9-13.5" />
                                    </svg>
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {/* ---------------------------------------------------- overlays */}

      {drafts && (
        <div className="backdrop">
          <div className="modal modal-wide" role="dialog" aria-modal="true">
            <div className="modal-head">
              <h2>{drafts.length === 1 ? 'Conferir a faixa' : `Conferir ${drafts.length} faixas`}</h2>
              <button className="icon-btn" onClick={() => setDrafts(null)} aria-label="Fechar">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="m6 6 12 12" /><path d="M18 6 6 18" />
                </svg>
              </button>
            </div>
            <p>
              Nada foi publicado ainda. Ajuste o que estiver errado e confirme — a imagem, se
              escolhida, é aplicada ao álbum de cada faixa.
            </p>

            <div className="draft-bulk">
              <label className="cover-slot" title="Imagem do álbum">
                {draftCover
                  ? <img src={draftCover.preview} alt="" />
                  : <span>Imagem do álbum</span>}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    try {
                      const blob = await imageToBlob(file);
                      if (draftCover) URL.revokeObjectURL(draftCover.preview);
                      setDraftCover({ blob, preview: URL.createObjectURL(blob) });
                    } catch (err) {
                      notify((err as Error).message, 'error');
                    }
                  }}
                />
              </label>
              <div className="draft-bulk-fields">
                <input
                  className="field"
                  placeholder="Artista para todas"
                  onChange={(e) => {
                    const artist = e.target.value;
                    setDrafts((prev) => prev && prev.map((d) => ({ ...d, artist })));
                  }}
                />
                <input
                  className="field"
                  placeholder="Álbum para todas"
                  onChange={(e) => {
                    const album = e.target.value;
                    setDrafts((prev) => prev && prev.map((d) => ({ ...d, album })));
                  }}
                />
              </div>
            </div>

            <div className="draft-list">
              {drafts.map((draft, i) => (
                <div className="draft" key={`${draft.file.name}-${i}`}>
                  <div className="draft-fields">
                    <input
                      className="field"
                      placeholder="Título"
                      value={draft.title}
                      onChange={(e) => setDrafts((prev) =>
                        prev && prev.map((d, j) => (j === i ? { ...d, title: e.target.value } : d)))}
                    />
                    <div className="draft-pair">
                      <input
                        className="field"
                        placeholder="Artista"
                        value={draft.artist}
                        onChange={(e) => setDrafts((prev) =>
                          prev && prev.map((d, j) => (j === i ? { ...d, artist: e.target.value } : d)))}
                      />
                      <input
                        className="field"
                        placeholder="Álbum"
                        value={draft.album}
                        onChange={(e) => setDrafts((prev) =>
                          prev && prev.map((d, j) => (j === i ? { ...d, album: e.target.value } : d)))}
                      />
                    </div>
                    <div className="draft-file truncate">{draft.file.name}</div>
                  </div>
                  <button
                    className="icon-btn"
                    title="Não publicar este"
                    aria-label={`Descartar ${draft.file.name}`}
                    onClick={() => setDrafts((prev) => {
                      const next = (prev ?? []).filter((_, j) => j !== i);
                      return next.length > 0 ? next : null;
                    })}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <path d="m6 6 12 12" /><path d="M18 6 6 18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>

            <div className="modal-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setDrafts(null)}>Cancelar</button>
              <button className="btn btn-primary btn-sm" onClick={() => void publishDrafts(drafts)}>
                {drafts.length === 1 ? 'Publicar' : `Publicar ${drafts.length}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* No backdrop close on any of these: they hold typed-in values or a destructive choice. */}
      {confirm && (
        <div className="backdrop">
          <div className="modal" role="dialog" aria-modal="true">
            <h2>Remover “{confirm.title}”?</h2>
            <p>
              O arquivo <code>{confirm.file}</code> será apagado do disco e a faixa sai do catálogo em
              todas as plataformas.
              {confirm.inPlaylists > 0 && (
                <>
                  {' '}Ela está em <strong>{confirm.inPlaylists}</strong>{' '}
                  {confirm.inPlaylists === 1 ? 'playlist de ouvinte' : 'playlists de ouvintes'} e será
                  retirada delas — as playlists em si não são apagadas.
                </>
              )}
            </p>
            <div className="modal-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(null)}>Cancelar</button>
              <button className="btn btn-danger btn-sm" onClick={doDelete}>Remover do catálogo</button>
            </div>
          </div>
        </div>
      )}

      {albumEdit && (
        <div className="backdrop">
          <div className="modal" role="dialog" aria-modal="true">
            <h2>Renomear álbum</h2>
            <p>A mudança vale para todas as faixas de “{albumEdit.from}”.</p>
            <label className="label" htmlFor="al-name">Álbum</label>
            <input
              id="al-name" className="field" autoFocus value={albumEdit.album}
              onChange={(e) => setAlbumEdit({ ...albumEdit, album: e.target.value })}
            />
            <div style={{ height: 12 }} />
            <label className="label" htmlFor="al-artist">Artista</label>
            <input
              id="al-artist" className="field" value={albumEdit.artist}
              onChange={(e) => setAlbumEdit({ ...albumEdit, artist: e.target.value })}
            />
            <div className="modal-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setAlbumEdit(null)}>Cancelar</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  try {
                    const r = await admin.renameAlbum(albumEdit.from, {
                      album: albumEdit.album, artist: albumEdit.artist,
                    });
                    setAlbumEdit(null);
                    await load();
                    notify(`${r.changed} ${r.changed === 1 ? 'faixa atualizada' : 'faixas atualizadas'}`);
                  } catch (err) {
                    notify((err as Error).message, 'error');
                  }
                }}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.kind === 'error' ? 'error' : ''}`}>{toast.text}</div>}
    </div>
  );
}
