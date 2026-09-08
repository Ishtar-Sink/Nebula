/** Nebula design tokens — single source of truth for web, mobile and (mirrored) desktop. */

export const colors = {
  // Deep violet-black canvas. Darker than Spotify's grey so the purple accents glow.
  bg: '#0A0713',
  bgElevated: '#120C22',
  surface: '#1A1130',
  surfaceHover: '#241740',
  surfaceMuted: '#150F28',
  border: '#2E1F52',

  primary: '#A855F7',
  primaryBright: '#C084FC',
  primaryDeep: '#7C3AED',
  accent: '#EC4899',
  accentSoft: '#F472B6',

  text: '#F6F2FF',
  textMuted: '#A99CC8',
  textFaint: '#6E6190',

  success: '#34D399',
  danger: '#FB7185',
} as const;

export const gradients = {
  brand: ['#A855F7', '#EC4899'] as const,
  deep: ['#7C3AED', '#A855F7'] as const,
  night: ['#1A1130', '#0A0713'] as const,
};

/** Cover-art palettes. Tracks/playlists store an index-free pair so every client renders identically. */
export const artPalettes: Array<[string, string]> = [
  ['#A855F7', '#EC4899'],
  ['#7C3AED', '#2DD4BF'],
  ['#F472B6', '#8B5CF6'],
  ['#6366F1', '#A855F7'],
  ['#DB2777', '#7C3AED'],
  ['#8B5CF6', '#38BDF8'],
  ['#C026D3', '#F59E0B'],
  ['#4C1D95', '#EC4899'],
  ['#9333EA', '#22D3EE'],
  ['#E879F9', '#6D28D9'],
];

/** Deterministic palette pick so a given id always gets the same cover. */
export function paletteFor(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return artPalettes[h % artPalettes.length];
}

export const radii = { sm: 8, md: 12, lg: 18, xl: 26, pill: 999 };
export const space = (n: number) => n * 4;
