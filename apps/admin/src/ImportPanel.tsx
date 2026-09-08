import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDuration } from '@nebula/protocol';
import { admin, type ImportJob, type ProbeResult, type ToolStatus } from './api.ts';

/**
 * Importing audio from a URL into the catalog.
 *
 * The heavy lifting happens on the server (yt-dlp + ffmpeg); this panel only decides *what*
 * to fetch. A playlist URL becomes a checklist, because pasting one and getting eighty tracks
 * you did not ask for is worse than pasting eighty URLs.
 */

interface Props {
  onImported: () => void;
  onToast: (text: string, kind?: 'ok' | 'error') => void;
}

const isRunning = (job: ImportJob | null) => job !== null && job.finishedAt === null;

export function ImportPanel({ onImported, onToast }: Props) {
  const [tools, setTools] = useState<ToolStatus | null>(null);
  const [url, setUrl] = useState('');
  const [probing, setProbing] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [bulk, setBulk] = useState({ artist: '', album: '', license: '' });
  const [job, setJob] = useState<ImportJob | null>(null);
  const importedRef = useRef(0);

  useEffect(() => { void admin.importTools().then(setTools).catch(() => setTools(null)); }, []);

  const recheck = useCallback(async () => {
    setTools(await admin.importTools(true).catch(() => null));
  }, []);

  // ---------------------------------------------------------------- probing

  const probe = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed || probing) return;
    setProbing(true);
    setResult(null);
    try {
      const found = await admin.probe(trimmed);
      setResult(found);
      // A playlist starts fully selected, one click away from either extreme — except what
      // is already in the catalog, which would only be downloaded to be thrown away.
      setChosen(new Set(found.entries.filter((e) => !e.duplicateOf).map((e) => e.url)));
      setFilter('');
      setBulk((prev) => ({
        artist: prev.artist || found.uploader,
        album: prev.album || (found.kind === 'collection' ? found.title : ''),
        license: prev.license || found.suggestedLicense,
      }));
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setProbing(false);
    }
  }, [url, probing, onToast]);

  /** The filter narrows what is shown, never what is selected: ticking boxes, typing a new
   *  search and ticking more has to add up, not start over. */
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!result) return [];
    if (!q) return result.entries;
    return result.entries.filter((e) =>
      e.title.toLowerCase().includes(q) || e.uploader.toLowerCase().includes(q));
  }, [result, filter]);

  const toggle = (entryUrl: string) => {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(entryUrl)) next.delete(entryUrl); else next.add(entryUrl);
      return next;
    });
  };

  // ---------------------------------------------------------------- downloading

  const start = useCallback(async () => {
    if (!result || chosen.size === 0) return;
    const items = result.entries
      .filter((e) => chosen.has(e.url))
      .map((e) => ({
        url: e.url,
        sourceId: e.sourceId,
        title: e.title,
        artist: bulk.artist.trim() || e.uploader,
        album: bulk.album.trim(),
        license: bulk.license.trim(),
      }));
    try {
      importedRef.current = 0;
      setJob(await admin.startImport(items));
    } catch (err) {
      onToast((err as Error).message, 'error');
    }
  }, [result, chosen, bulk, onToast]);

  // Poll while a job runs. Refreshing the overview on every completed item keeps the catalog
  // table in step with a long playlist instead of jumping at the end.
  useEffect(() => {
    if (!isRunning(job) || !job) return;
    const id = job.id;
    const timer = setInterval(async () => {
      try {
        const fresh = await admin.importJob(id);
        setJob(fresh);
        const done = fresh.items.filter((i) => i.status === 'ok').length;
        if (done !== importedRef.current) {
          importedRef.current = done;
          onImported();
        }
        if (fresh.finishedAt !== null) {
          const failed = fresh.items.filter((i) => i.status === 'erro').length;
          const repeated = fresh.items.filter((i) => i.status === 'duplicada').length;
          const parts = [`${done} ${done === 1 ? 'faixa importada' : 'faixas importadas'}`];
          if (repeated > 0) parts.push(`${repeated} já no catálogo`);
          if (failed > 0) parts.push(`${failed} com erro`);
          onToast(parts.join(' · '), failed === 0 ? 'ok' : 'error');
        }
      } catch {
        // The job expires half an hour after it ends; a 404 here just means we polled late.
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [job, onImported, onToast]);

  /** The job only while it is still going, so the buttons below can use it without a null check. */
  const active = job && job.finishedAt === null ? job : null;
  const running = active !== null;
  const statusOf = (entryUrl: string) => job?.items.find((i) => i.url === entryUrl);
  const duplicates = result?.entries.filter((e) => e.duplicateOf).length ?? 0;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Importar da web</h2>
          <p>
            Cole o endereço de uma faixa ou de uma playlist. O áudio é convertido para mp3 e
            entra no catálogo. Use apenas com material que você tem direito de distribuir.
          </p>
        </div>
      </div>

      <div className="panel-body">
        {tools && !tools.ready && (
          <div className="notice warn">
            <strong>Faltam ferramentas no servidor.</strong>
            <p>{tools.hint}</p>
            <p className="mono">
              yt-dlp: {tools.ytdlp.found ? tools.ytdlp.version : 'não encontrado'} ·{' '}
              ffmpeg: {tools.ffmpeg.found ? tools.ffmpeg.version : 'não encontrado'}
            </p>
            <button className="btn btn-ghost btn-sm" onClick={() => void recheck()}>
              Verificar de novo
            </button>
          </div>
        )}

        <div className="url-row">
          <input
            className="field"
            placeholder="https://..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void probe(); }}
            disabled={running}
          />
          <button
            className="btn btn-primary"
            onClick={() => void probe()}
            disabled={probing || running || url.trim().length === 0 || tools?.ready === false}
          >
            {probing ? 'Analisando...' : 'Analisar'}
          </button>
        </div>

        {result && (
          <>
            <div className="provider-line">
              <span className="tag">{result.provider.name}</span>
              <span className="cell-sub">{result.provider.notes}</span>
            </div>

            <div className="draft-bulk-fields" style={{ marginBottom: 14 }}>
              <div className="meta-grid">
                <div>
                  <label className="label" htmlFor="imp-artist">Artista</label>
                  <input
                    id="imp-artist" className="field" placeholder="Vazio usa o canal de origem"
                    value={bulk.artist} onChange={(e) => setBulk({ ...bulk, artist: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="imp-album">Álbum</label>
                  <input
                    id="imp-album" className="field"
                    value={bulk.album} onChange={(e) => setBulk({ ...bulk, album: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="imp-license">Licença</label>
                <input
                  id="imp-license" className="field"
                  placeholder="ex.: CC BY 4.0, domínio público, uso autorizado"
                  value={bulk.license} onChange={(e) => setBulk({ ...bulk, license: e.target.value })}
                />
              </div>
            </div>

            <div className="toolbar" style={{ padding: 0, marginBottom: 10 }}>
              <strong style={{ fontSize: 13.5 }}>
                {result.title}
                {result.kind === 'collection' && (
                  <span className="cell-sub">
                    {' · '}{result.entries.length} itens
                    {duplicates > 0 && ` · ${duplicates} já no catálogo`}
                    {filter.trim() && ` · ${visible.length} no filtro`}
                  </span>
                )}
              </strong>
              <div className="spacer" />
              {result.kind === 'collection' && !running && (
                <>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setChosen(new Set(visible.filter((e) => !e.duplicateOf).map((e) => e.url)))}
                    title="Ignora as que já estão no catálogo"
                  >
                    Marcar {filter.trim() ? 'as filtradas' : 'todas'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setChosen(new Set())}>
                    Desmarcar
                  </button>
                </>
              )}
            </div>

            {result.kind === 'collection' && result.entries.length > 6 && (
              <div className="search" style={{ marginBottom: 10 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" strokeLinecap="round" />
                </svg>
                <input
                  placeholder="Filtrar por título ou canal"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
            )}

            <div className="draft-list">
              {visible.length === 0 && (
                <p className="cell-sub" style={{ padding: '10px 2px' }}>
                  Nada corresponde a “{filter.trim()}”.
                </p>
              )}
              {visible.map((entry) => {
                const state = statusOf(entry.url);
                return (
                  <label
                    key={entry.url}
                    className={`import-row ${entry.duplicateOf ? 'dupe' : ''}`}
                    title={entry.duplicateOf ? `Já no catálogo como “${entry.duplicateOf}”` : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={chosen.has(entry.url)}
                      disabled={running}
                      onChange={() => toggle(entry.url)}
                    />
                    {entry.thumbnail
                      ? <img className="import-thumb" src={entry.thumbnail} alt="" loading="lazy" />
                      : <div className="import-thumb" />}
                    <div style={{ minWidth: 0 }}>
                      <div className="cell-title truncate">{entry.title}</div>
                      <div className="cell-sub truncate">
                        {entry.uploader || '—'}
                        {entry.durationMs > 0 && ` · ${formatDuration(entry.durationMs)}`}
                      </div>
                    </div>
                    {state ? (
                      <span
                        className={`tag ${state.status === 'erro' ? 'warn' : state.status === 'ok' ? '' : 'muted'}`}
                        title={state.detail}
                      >
                        {state.status}
                      </span>
                    ) : entry.duplicateOf ? (
                      <span className="tag muted">no catálogo</span>
                    ) : null}
                  </label>
                );
              })}
            </div>

            {job?.items.some((i) => i.status === 'erro') && (
              <div className="notice warn" style={{ marginTop: 14 }}>
                {job.items.filter((i) => i.status === 'erro').map((i) => (
                  <p key={i.url} className="truncate">{i.title}: {i.detail}</p>
                ))}
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: 16 }}>
              {running ? (
                <button className="btn btn-danger" onClick={() => void admin.cancelImport(active.id)}>
                  Cancelar
                </button>
              ) : (
                <button className="btn btn-ghost" onClick={() => { setResult(null); setJob(null); }}>
                  Limpar
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={() => void start()}
                disabled={running || chosen.size === 0}
              >
                {active
                  ? `Baixando ${active.items.filter((i) => i.status !== 'pendente').length}/${active.items.length}...`
                  : `Baixar ${chosen.size} selecionada${chosen.size === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
