import { colors as shared } from '@nebula/theme';

export const C = {
  ...shared,
  /** Slightly lifted surfaces read better on a phone held at arm's length. */
  card: 'rgba(255,255,255,0.05)',
  cardHover: 'rgba(255,255,255,0.09)',
  hairline: 'rgba(255,255,255,0.07)',
};

export const R = { sm: 8, md: 12, lg: 18, xl: 26, pill: 999 };

export const F = {
  title: { fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.8, color: C.text },
  section: { fontSize: 19, fontWeight: '700' as const, letterSpacing: -0.3, color: C.text },
  body: { fontSize: 14, color: C.text },
  muted: { fontSize: 12.5, color: C.textMuted },
  faint: { fontSize: 11.5, color: C.textFaint },
};
