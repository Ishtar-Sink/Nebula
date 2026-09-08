/**
 * Where the importer can fetch audio from.
 *
 * The registry exists so the feature is not tied to one platform: yt-dlp supports hundreds of
 * sites, and the ones worth naming here are those whose catalogues are meant to be downloaded
 * — public domain, Creative Commons or artist-authorised. A generic entry catches the rest.
 *
 * Adding a provider is adding one object to the list below.
 */

export interface Provider {
  id: string;
  name: string;
  /** Shown in the UI so the operator knows what the licensing situation usually is. */
  notes: string;
  /** Hostnames (without `www.`) this provider claims. Empty means "anything". */
  hosts: string[];
  /** True when the URL points at several tracks rather than one. */
  isCollection(url: URL): boolean;
  /** Suggested license text for tracks imported from here; the operator can override it. */
  defaultLicense?: string;
}

const strip = (host: string) => host.replace(/^www\./, '').toLowerCase();

export const PROVIDERS: Provider[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    notes: 'Confira a licença do vídeo. A Biblioteca de Áudio e os vídeos marcados como Creative Commons são os seguros.',
    hosts: ['youtube.com', 'youtu.be', 'music.youtube.com', 'm.youtube.com'],
    isCollection: (url) =>
      url.pathname.startsWith('/playlist') ||
      url.pathname.startsWith('/@') ||
      url.searchParams.has('list'),
  },
  {
    id: 'archive',
    name: 'Internet Archive',
    notes: 'Acervo público: domínio público e Creative Commons, com download autorizado.',
    hosts: ['archive.org'],
    // An item page holds every file of that item, so it behaves like a collection.
    isCollection: (url) => url.pathname.startsWith('/details/') || url.pathname.startsWith('/download/'),
    defaultLicense: 'Internet Archive — ver a licença do item',
  },
  {
    id: 'freemusicarchive',
    name: 'Free Music Archive',
    notes: 'Curadoria de faixas Creative Commons. A maioria exige atribuição ao autor.',
    hosts: ['freemusicarchive.org'],
    isCollection: (url) => url.pathname.includes('/album/') || url.pathname.includes('/genre/'),
    defaultLicense: 'Creative Commons — conferir a exigência de atribuição',
  },
  {
    id: 'bandcamp',
    name: 'Bandcamp',
    notes: 'Funciona no que o artista liberou para download (gratuito ou "pague quanto quiser").',
    hosts: ['bandcamp.com'],
    isCollection: (url) => url.pathname.startsWith('/album') || url.pathname === '/music',
  },
  {
    id: 'soundcloud',
    name: 'SoundCloud',
    notes: 'Há bastante material Creative Commons; confira a licença de cada faixa.',
    hosts: ['soundcloud.com', 'm.soundcloud.com'],
    isCollection: (url) => url.pathname.includes('/sets/') || url.pathname.endsWith('/tracks'),
  },
  {
    // Last in the list on purpose: it matches anything the named ones did not.
    id: 'generic',
    name: 'Outro site',
    notes: 'Qualquer endereço que o yt-dlp reconheça. A responsabilidade pela licença é de quem importa.',
    hosts: [],
    isCollection: () => false,
  },
];

export function detectProvider(rawUrl: string): { provider: Provider; url: URL } | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = strip(url.hostname);
  const named = PROVIDERS.find(
    (p) => p.hosts.some((h) => host === h || host.endsWith(`.${h}`)),
  );
  return { provider: named ?? PROVIDERS[PROVIDERS.length - 1], url };
}

/** What the backoffice lists, without the matcher functions. */
export const providerCatalog = () =>
  PROVIDERS.map(({ id, name, notes, hosts }) => ({ id, name, notes, hosts }));
