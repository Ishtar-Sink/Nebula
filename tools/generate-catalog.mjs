/**
 * Generates the Nebula demo catalog: original instrumental tracks synthesized from scratch.
 *
 * Nothing here is sampled or copied — every track is built from oscillators, noise and
 * envelopes, so the catalog ships freely with the repo and is genuinely playable.
 *
 * Output: media/catalog/*.mp3 (falls back to .wav when ffmpeg is unavailable) plus a
 * catalog.json manifest the server reads at boot.
 */
import { mkdirSync, writeFileSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.NEBULA_CATALOG_DIR ?? join(ROOT, 'media', 'catalog');
// Smoke-test escape hatch: render only the first N tracks.
const LIMIT = Number(process.env.NEBULA_SEED_LIMIT ?? Infinity);
const SR = 44100;

// ------------------------------------------------------------------ dsp helpers

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Exponential-ish ADSR. Returns gain at time t (seconds) for a note of length `dur`. */
function adsr(t, dur, a, d, s, r) {
  if (t < 0) return 0;
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < dur) return s;
  const rt = t - dur;
  return rt < r ? s * (1 - rt / r) : 0;
}

const saw = (p) => 2 * (p - Math.floor(p + 0.5));
const square = (p, pw = 0.5) => (p % 1 < pw ? 1 : -1);
const tri = (p) => 2 * Math.abs(saw(p)) - 1;
const sine = (p) => Math.sin(2 * Math.PI * p);

/** One-pole lowpass; `cut` in Hz. Stateful across a buffer via the `st` object. */
function lp(st, x, cut) {
  const dt = 1 / SR;
  const rc = 1 / (2 * Math.PI * Math.max(20, cut));
  const a = dt / (rc + dt);
  st.y = (st.y ?? 0) + a * (x - (st.y ?? 0));
  return st.y;
}

function hp(st, x, cut) {
  const y = x - lp(st, x, cut);
  return y;
}

class Buf {
  constructor(seconds) {
    this.n = Math.ceil(seconds * SR);
    this.l = new Float32Array(this.n);
    this.r = new Float32Array(this.n);
  }
  add(i, l, r) {
    if (i < 0 || i >= this.n) return;
    this.l[i] += l;
    this.r[i] += r;
  }
}

// ------------------------------------------------------------------ instruments

function kick(buf, at, gain = 1) {
  const dur = 0.42;
  const n = Math.floor(dur * SR);
  const start = Math.floor(at * SR);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 45 + 115 * Math.exp(-t * 38);
    phase += f / SR;
    const env = Math.exp(-t * 7.5);
    const click = i < 60 ? (Math.random() * 2 - 1) * 0.25 * (1 - i / 60) : 0;
    const v = (sine(phase) * env + click) * 0.9 * gain;
    buf.add(start + i, v, v);
  }
}

function snare(buf, at, gain = 1) {
  const dur = 0.24;
  const n = Math.floor(dur * SR);
  const start = Math.floor(at * SR);
  const st = {};
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 20);
    phase += 190 / SR;
    const noise = hp(st, Math.random() * 2 - 1, 1200);
    const v = (noise * 0.7 + sine(phase) * 0.3) * env * 0.55 * gain;
    buf.add(start + i, v * 0.95, v);
  }
}

function hat(buf, at, open = false, gain = 1) {
  const dur = open ? 0.22 : 0.055;
  const n = Math.floor(dur * SR);
  const start = Math.floor(at * SR);
  const st = {};
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.exp(-t * (open ? 14 : 60));
    const v = hp(st, Math.random() * 2 - 1, 6500) * env * 0.22 * gain;
    buf.add(start + i, v * 0.8, v);
  }
}

function bass(buf, at, note, dur, gain = 1) {
  const n = Math.floor((dur + 0.12) * SR);
  const start = Math.floor(at * SR);
  const f = midi(note);
  const st = {};
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    phase += f / SR;
    const env = adsr(t, dur, 0.006, 0.09, 0.72, 0.1);
    if (env <= 0) continue;
    const cut = 190 + 900 * Math.exp(-t * 6);
    const raw = saw(phase) * 0.6 + square(phase, 0.5) * 0.25 + sine(phase * 0.5) * 0.3;
    const v = lp(st, raw, cut) * env * 0.42 * gain;
    buf.add(start + i, v, v);
  }
}

/** Detuned supersaw pad — the main source of the "wide" feel. */
function pad(buf, at, notes, dur, gain = 1) {
  const n = Math.floor((dur + 0.9) * SR);
  const start = Math.floor(at * SR);
  const voices = [];
  for (const note of notes) {
    for (const det of [-7, -2.5, 0, 2.5, 7]) {
      voices.push({ f: midi(note) * Math.pow(2, det / 1200), phase: Math.random(), pan: det / 14 });
    }
  }
  const stL = {}, stR = {};
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = adsr(t, dur, 0.55, 0.6, 0.62, 0.8);
    if (env <= 0) continue;
    let l = 0, r = 0;
    for (const v of voices) {
      v.phase += v.f / SR;
      const s = saw(v.phase);
      l += s * (0.5 - v.pan * 0.5);
      r += s * (0.5 + v.pan * 0.5);
    }
    const k = 1 / voices.length;
    const cut = 700 + 1500 * (0.5 + 0.5 * Math.sin(t * 0.6));
    buf.add(start + i, lp(stL, l * k, cut) * env * 0.85 * gain, lp(stR, r * k, cut) * env * 0.85 * gain);
  }
}

function lead(buf, at, note, dur, gain = 1, wave = 'tri') {
  const n = Math.floor((dur + 0.5) * SR);
  const start = Math.floor(at * SR);
  const f = midi(note);
  const st = {};
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = adsr(t, dur, 0.02, 0.18, 0.65, 0.42);
    if (env <= 0) continue;
    const vib = 1 + 0.004 * Math.sin(2 * Math.PI * 5.2 * t) * Math.min(1, t * 3);
    phase += (f * vib) / SR;
    const raw = wave === 'tri' ? tri(phase) : wave === 'sq' ? square(phase, 0.42) * 0.7 : saw(phase) * 0.8;
    const v = lp(st, raw, 2600) * env * 0.3 * gain;
    buf.add(start + i, v * 0.92, v);
  }
}

function pluck(buf, at, note, dur, gain = 1) {
  const n = Math.floor((dur + 0.3) * SR);
  const start = Math.floor(at * SR);
  const f = midi(note);
  const st = {};
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 6) * (t < 0.004 ? t / 0.004 : 1);
    if (env < 0.0005) break;
    phase += f / SR;
    const v = lp(st, saw(phase) * 0.5 + sine(phase) * 0.5, 900 + 3500 * Math.exp(-t * 12)) * env * 0.26 * gain;
    buf.add(start + i, v * 0.9, v);
  }
}

// ------------------------------------------------------------------ post

/** Cheap stereo feedback delay — gives every track a sense of space. */
function delay(buf, timeSec, feedback, mix) {
  const d = Math.floor(timeSec * SR);
  const d2 = Math.floor(timeSec * 1.5 * SR);
  for (let i = 0; i < buf.n; i++) {
    if (i >= d) buf.l[i] += buf.l[i - d] * feedback * mix;
    if (i >= d2) buf.r[i] += buf.r[i - d2] * feedback * mix;
  }
}

/** Multi-tap smear standing in for a reverb tail. */
function reverb(buf, amount) {
  const taps = [0.0297, 0.0371, 0.0411, 0.0437, 0.0631, 0.0857];
  const l = Float32Array.from(buf.l);
  const r = Float32Array.from(buf.r);
  for (let ti = 0; ti < taps.length; ti++) {
    const d = Math.floor(taps[ti] * SR);
    const g = amount * (0.55 / (ti + 1));
    for (let i = d; i < buf.n; i++) {
      buf.l[i] += r[i - d] * g;
      buf.r[i] += l[i - d] * g * 0.92;
    }
  }
}

function normalize(buf, target = 0.89) {
  let peak = 0;
  for (let i = 0; i < buf.n; i++) {
    peak = Math.max(peak, Math.abs(buf.l[i]), Math.abs(buf.r[i]));
  }
  if (peak === 0) return;
  const g = target / peak;
  for (let i = 0; i < buf.n; i++) {
    // tanh soft-clip keeps transients musical instead of letting them square off
    buf.l[i] = Math.tanh(buf.l[i] * g * 1.45) * 0.93;
    buf.r[i] = Math.tanh(buf.r[i] * g * 1.45) * 0.93;
  }
}

function fade(buf, inSec, outSec) {
  const fi = Math.floor(inSec * SR);
  const fo = Math.floor(outSec * SR);
  for (let i = 0; i < fi; i++) {
    const g = i / fi;
    buf.l[i] *= g; buf.r[i] *= g;
  }
  for (let i = 0; i < fo; i++) {
    const idx = buf.n - 1 - i;
    const g = i / fo;
    buf.l[idx] *= g; buf.r[idx] *= g;
  }
}

function toWav(buf) {
  const frames = buf.n;
  const data = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i++) {
    data.writeInt16LE(Math.round(clamp(buf.l[i], -1, 1) * 32767), i * 4);
    data.writeInt16LE(Math.round(clamp(buf.r[i], -1, 1) * 32767), i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// ------------------------------------------------------------------ composition

const CHORDS = {
  min:  [0, 3, 7],
  maj:  [0, 4, 7],
  min7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  sus4: [0, 5, 7],
};

function voice(root, type, octave = 0) {
  return CHORDS[type].map((iv) => root + iv + octave * 12);
}

/**
 * Renders one track. `spec` describes tempo, progression, which layers play in which
 * section, and the melodic character — everything that makes the four albums distinct.
 */
function render(spec) {
  const beat = 60 / spec.bpm;
  const bar = beat * 4;
  const totalBars = spec.sections.reduce((n, s) => n + s.bars, 0);
  const buf = new Buf(totalBars * bar + 3);

  let barIndex = 0;
  for (const section of spec.sections) {
    for (let b = 0; b < section.bars; b++, barIndex++) {
      const t0 = barIndex * bar;
      const chord = spec.progression[barIndex % spec.progression.length];
      const notes = voice(chord.root, chord.type, 0);

      if (section.pad) pad(buf, t0, notes.map((n) => n + 12), bar * 0.98, section.pad);

      if (section.drums) {
        for (const p of spec.kickPattern) kick(buf, t0 + p * beat, section.drums);
        for (const p of spec.snarePattern) snare(buf, t0 + p * beat, section.drums);
        for (let h = 0; h < 8; h++) {
          if (spec.hatSkip && h % spec.hatSkip === spec.hatSkip - 1) continue;
          hat(buf, t0 + h * beat * 0.5, h % 4 === 3 && spec.openHats, section.drums * (h % 2 ? 0.7 : 1));
        }
      }

      if (section.bass) {
        for (const [pos, len, deg] of spec.bassPattern) {
          bass(buf, t0 + pos * beat, chord.root - 24 + (deg ?? 0), len * beat, section.bass);
        }
      }

      if (section.arp) {
        const arpNotes = [...notes, notes[0] + 12, notes[1] + 12];
        for (let s = 0; s < 8; s++) {
          const n = arpNotes[(s + barIndex) % arpNotes.length] + 12;
          pluck(buf, t0 + s * beat * 0.5, n, beat * 0.45, section.arp);
        }
      }

      if (section.lead) {
        const line = spec.melody[barIndex % spec.melody.length];
        for (const [pos, len, deg] of line) {
          lead(buf, t0 + pos * beat, chord.root + 12 + deg, len * beat, section.lead, spec.leadWave);
        }
      }
    }
  }

  delay(buf, beat * 0.75, 0.32, spec.delayMix ?? 0.5);
  reverb(buf, spec.reverb ?? 0.16);
  normalize(buf);
  fade(buf, 0.05, Math.min(2.4, bar));
  return { buf, durationMs: Math.round((buf.n / SR) * 1000) };
}

// ------------------------------------------------------------------ the albums

// Degrees are relative to the bar's chord root, so melodies stay in key automatically.
const MEL_A = [
  [[0, 1, 0], [1, 0.5, 7], [1.5, 0.5, 5], [2, 1, 3], [3, 1, 0]],
  [[0, 1.5, 7], [1.5, 0.5, 5], [2, 2, 3]],
  [[0, 0.5, 12], [0.5, 0.5, 10], [1, 1, 7], [2, 1, 5], [3, 1, 3]],
  [[0, 2, 5], [2, 1, 3], [3, 1, 0]],
];
const MEL_B = [
  [[0, 2, 3], [2, 1, 7], [3, 1, 5]],
  [[0, 1, 0], [1, 1, 3], [2, 2, 7]],
  [[0, 0.5, 7], [0.5, 1.5, 10], [2, 1, 12], [3, 1, 7]],
  [[0, 3, 5], [3, 1, 3]],
];
const MEL_C = [
  [[0, 4, 0]],
  [[0, 2, 7], [2, 2, 5]],
  [[0, 4, 3]],
  [[0, 2, 10], [2, 2, 7]],
];

const P = {
  aeolian: (r) => [
    { root: r, type: 'min7' }, { root: r + 8, type: 'maj7' },
    { root: r + 3, type: 'maj7' }, { root: r + 10, type: 'maj' },
  ],
  dorian: (r) => [
    { root: r, type: 'min7' }, { root: r + 5, type: 'maj' },
    { root: r, type: 'min7' }, { root: r + 7, type: 'min7' },
  ],
  cinematic: (r) => [
    { root: r, type: 'min' }, { root: r, type: 'min7' },
    { root: r + 8, type: 'sus4' }, { root: r + 8, type: 'maj' },
  ],
  house: (r) => [
    { root: r, type: 'min7' }, { root: r + 5, type: 'min7' },
    { root: r + 8, type: 'maj7' }, { root: r + 3, type: 'maj7' },
  ],
};

const FULL = { pad: 0.85, drums: 1, bass: 1, arp: 0.8, lead: 0.9 };
const GROOVE = { pad: 0.7, drums: 1, bass: 1, arp: 0.7 };
const INTRO = { pad: 1.0, arp: 0.8, bass: 0.4 };
const BREAK = { pad: 1.05, bass: 0.8, lead: 0.85 };
const OUTRO = { pad: 0.9, arp: 0.6, bass: 0.6 };

const ALBUMS = [
  {
    album: 'Violeta Profunda',
    artist: 'Aurora Lume',
    base: { bpm: 104, kickPattern: [0, 2], snarePattern: [1, 3], hatSkip: 0, openHats: true,
            bassPattern: [[0, 0.9, 0], [1.5, 0.4, 0], [2, 0.9, 7], [3.5, 0.4, 0]],
            leadWave: 'tri', reverb: 0.2, delayMix: 0.55 },
    tracks: [
      { title: 'Primeira Luz', root: 57, prog: 'aeolian', melody: MEL_A,
        sections: [{ ...INTRO, bars: 4 }, { ...GROOVE, bars: 8 }, { ...FULL, bars: 12 }, { ...BREAK, bars: 4 }, { ...FULL, bars: 8 }, { ...OUTRO, bars: 4 }] },
      { title: 'Anoitecer em Roxo', root: 52, prog: 'cinematic', melody: MEL_C,
        sections: [{ ...INTRO, bars: 6 }, { ...GROOVE, bars: 8 }, { ...FULL, bars: 12 }, { ...OUTRO, bars: 6 }] },
      { title: 'Constelação Interna', root: 59, prog: 'dorian', melody: MEL_B,
        sections: [{ ...INTRO, bars: 4 }, { ...FULL, bars: 16 }, { ...BREAK, bars: 4 }, { ...FULL, bars: 8 }, { ...OUTRO, bars: 4 }] },
    ],
  },
  {
    album: 'Cidade de Neon',
    artist: 'Kaito Ríos',
    base: { bpm: 86, kickPattern: [0, 2.5], snarePattern: [1, 3], hatSkip: 3, openHats: false,
            bassPattern: [[0, 1.4, 0], [2, 0.8, 3], [3, 0.9, 7]],
            leadWave: 'tri', reverb: 0.26, delayMix: 0.62 },
    tracks: [
      { title: 'Chuva na Avenida', root: 55, prog: 'dorian', melody: MEL_C,
        sections: [{ ...INTRO, bars: 4 }, { ...GROOVE, bars: 8 }, { ...FULL, bars: 12 }, { ...OUTRO, bars: 4 }] },
      { title: 'Café às Três da Manhã', root: 50, prog: 'aeolian', melody: MEL_A,
        sections: [{ ...INTRO, bars: 4 }, { ...FULL, bars: 16 }, { ...BREAK, bars: 4 }, { ...OUTRO, bars: 4 }] },
      { title: 'Vitrine Molhada', root: 62, prog: 'house', melody: MEL_B,
        sections: [{ ...INTRO, bars: 4 }, { ...GROOVE, bars: 8 }, { ...FULL, bars: 12 }, { ...OUTRO, bars: 4 }] },
    ],
  },
  {
    album: 'Órbita Baixa',
    artist: 'Nébula 7',
    base: { bpm: 72, kickPattern: [0], snarePattern: [2], hatSkip: 2, openHats: true,
            bassPattern: [[0, 2, 0], [2, 1.8, 7]],
            leadWave: 'saw', reverb: 0.38, delayMix: 0.7 },
    tracks: [
      { title: 'Silêncio Entre Estrelas', root: 45, prog: 'cinematic', melody: MEL_C,
        sections: [{ ...INTRO, bars: 6 }, { pad: 0.95, bass: 0.8, arp: 0.5, bars: 8 }, { ...FULL, bars: 10 }, { ...OUTRO, bars: 6 }] },
      { title: 'Deriva', root: 48, prog: 'aeolian', melody: MEL_C,
        sections: [{ ...INTRO, bars: 6 }, { ...BREAK, bars: 6 }, { ...FULL, bars: 12 }, { ...OUTRO, bars: 6 }] },
      { title: 'Reentrada', root: 53, prog: 'dorian', melody: MEL_B,
        sections: [{ ...INTRO, bars: 4 }, { ...GROOVE, bars: 8 }, { ...FULL, bars: 12 }, { ...OUTRO, bars: 6 }] },
    ],
  },
  {
    album: 'Fogo Frio',
    artist: 'Marés Elétricas',
    base: { bpm: 122, kickPattern: [0, 1, 2, 3], snarePattern: [1, 3], hatSkip: 0, openHats: true,
            bassPattern: [[0.5, 0.4, 0], [1.5, 0.4, 0], [2.5, 0.4, 7], [3.5, 0.4, 0]],
            leadWave: 'sq', reverb: 0.14, delayMix: 0.45 },
    tracks: [
      { title: 'Pulso', root: 57, prog: 'house', melody: MEL_B,
        sections: [{ ...INTRO, bars: 4 }, { ...GROOVE, bars: 8 }, { ...FULL, bars: 16 }, { ...OUTRO, bars: 4 }] },
      { title: 'Corrente Alternada', root: 50, prog: 'dorian', melody: MEL_A,
        sections: [{ ...INTRO, bars: 4 }, { ...GROOVE, bars: 8 }, { ...FULL, bars: 12 }, { ...BREAK, bars: 4 }, { ...FULL, bars: 8 }, { ...OUTRO, bars: 4 }] },
      { title: 'Amanhecer Sintético', root: 60, prog: 'aeolian', melody: MEL_A,
        sections: [{ ...INTRO, bars: 4 }, { ...FULL, bars: 16 }, { ...OUTRO, bars: 6 }] },
    ],
  },
];

// ------------------------------------------------------------------ main

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
if (!hasFfmpeg) {
  console.warn('[seed] ffmpeg não encontrado — gerando .wav (arquivos maiores, mas tocam igual).');
}

mkdirSync(OUT, { recursive: true });
const manifest = [];
const started = Date.now();

outer:
for (const album of ALBUMS) {
  for (let i = 0; i < album.tracks.length; i++) {
    if (manifest.length >= LIMIT) break outer;
    const t = album.tracks[i];
    const slug = `${album.album} ${t.title}`
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const ext = hasFfmpeg ? '.mp3' : '.wav';
    const file = `${slug}${ext}`;
    const outPath = join(OUT, file);

    process.stdout.write(`  ${album.artist} — ${t.title} ... `);
    const { buf, durationMs } = render({
      ...album.base,
      progression: P[t.prog](t.root),
      melody: t.melody,
      sections: t.sections,
    });

    const wav = toWav(buf);
    if (hasFfmpeg) {
      const tmp = join(OUT, `${slug}.tmp.wav`);
      writeFileSync(tmp, wav);
      const r = spawnSync('ffmpeg', [
        '-y', '-loglevel', 'error', '-i', tmp,
        '-codec:a', 'libmp3lame', '-b:a', '192k',
        '-metadata', `title=${t.title}`,
        '-metadata', `artist=${album.artist}`,
        '-metadata', `album=${album.album}`,
        '-metadata', `track=${i + 1}`,
        outPath,
      ], { stdio: 'inherit' });
      unlinkSync(tmp);
      if (r.status !== 0) throw new Error(`ffmpeg falhou em ${file}`);
    } else {
      writeFileSync(outPath, wav);
    }

    const kb = Math.round(statSync(outPath).size / 1024);
    console.log(`${(durationMs / 1000).toFixed(0)}s, ${kb} KB`);

    manifest.push({
      id: `cat:${slug}`,
      title: t.title,
      artist: album.artist,
      album: album.album,
      durationMs,
      file,
    });
  }
}

writeFileSync(join(OUT, 'catalog.json'), JSON.stringify(manifest, null, 2));
console.log(`\n[seed] ${manifest.length} faixas em ${OUT} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
