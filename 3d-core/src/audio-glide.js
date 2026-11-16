/* ============================================================
   DIPWING — src/audio-glide.js  ·  "Glidmotivet" glide-v1 pack (original synthesis)
   Pure WebAudio synthesis — no samples, no copied material. Every voice is built from
   oscillators / periodic waves / a seeded noise buffer, so the SAME code renders live
   (AudioContext) and offline (OfflineAudioContext: music loops + the spectral test).
   Signature motif: D–A–G–E (scale degrees 0,7,5,2 from D5 = 587.33 Hz).
   Phone-speaker rule: every cue and music layer keeps substantial energy in 600–4000 Hz
   (asserted by tests/suites/24-audio-spectral.mjs). Bass lines are doubled with
   harmonics so they still read on a small speaker.
   No game logic here — AudioFX (src/game/10-store-econ-audio.js) owns buses/state.
   ============================================================ */
(function () {
"use strict";
const ROOT = 587.33;                       // D5
const MOTIF = [0, 7, 5, 2];                // D A G E
const hz = (semi, base) => (base || ROOT) * Math.pow(2, semi / 12);
const SCALES = {
  pentaMaj: [0, 2, 4, 7, 9], pentaMin: [0, 3, 5, 7, 10], major: [0, 2, 4, 5, 7, 9, 11],
  mixo: [0, 2, 4, 5, 7, 9, 10], dorian: [0, 2, 3, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10], phryg: [0, 1, 3, 5, 7, 8, 10]
};
function deg(scale, d) { const n = scale.length; const o = Math.floor(d / n); return scale[((d % n) + n) % n] + 12 * o; }

/* ---------- per-context caches ---------- */
const _waves = new WeakMap(), _noise = new WeakMap();
function pwave(ctx, parts) {
  let m = _waves.get(ctx); if (!m) { m = new Map(); _waves.set(ctx, m); }
  const k = parts.join(","); let w = m.get(k);
  if (!w) {
    const re = new Float32Array(parts.length + 1), im = new Float32Array(parts.length + 1);
    for (let i = 0; i < parts.length; i++) im[i + 1] = parts[i];
    w = ctx.createPeriodicWave(re, im); m.set(k, w);
  }
  return w;
}
function noiseBuf(ctx) {
  let b = _noise.get(ctx); if (b) return b;
  const n = Math.floor(ctx.sampleRate * 1.0); b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0); let s = 0x9e3779b9 >>> 0;
  for (let i = 0; i < n; i++) { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; d[i] = (s / 4294967296) * 2 - 1; }
  _noise.set(ctx, b); return b;
}

/* ---------- primitive voices ---------- */
/* tone: one pitched voice. o = {f, dur, g, a(attack), parts|type, slide, lp, lpEnd, hp, det(cents unison), vib, sus(0..1 hold level), rel} */
function tone(ctx, out, t, o) {
  const dur = Math.max(0.02, o.dur || 0.2), a = Math.max(0.002, o.a || 0.005), g0 = Math.max(0.0002, o.g || 0.2);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(g0, t + a);
  if (o.sus != null) { // held note: decay to sustain, release at end
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, g0 * o.sus), t + a + Math.min(0.3, dur * 0.4));
    g.gain.setValueAtTime(Math.max(0.0002, g0 * o.sus), t + Math.max(a + 0.01, dur - (o.rel || 0.12)));
  }
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let head = g;
  if (o.lp) {
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.Q.value = o.q || 0.7;
    f.frequency.setValueAtTime(o.lp, t);
    if (o.lpEnd) f.frequency.exponentialRampToValueAtTime(o.lpEnd, t + dur);
    g.connect(f); head = f;
  }
  if (o.hp) { const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = o.hp; f.Q.value = 0.6; head.connect(f); head = f; }
  head.connect(out);
  const dets = o.det ? [-o.det, o.det] : [0];
  for (const dc of dets) {
    const osc = ctx.createOscillator();
    if (o.parts) osc.setPeriodicWave(pwave(ctx, o.parts)); else osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.f, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slide), t + (o.slideT || dur));
    if (dc) osc.detune.value = dc;
    if (o.vib) {
      const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = o.vib[0]; lg.gain.value = o.f * o.vib[1];
      l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + dur + 0.05);
    }
    if (dets.length > 1) { const sg = ctx.createGain(); sg.gain.value = 0.6; osc.connect(sg); sg.connect(g); } else osc.connect(g);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  return t + dur;
}
/* noise burst through a band/high/low-pass. o = {dur, g, a, bp, q, type, sweep, hp} */
function noise(ctx, out, t, o) {
  const dur = Math.max(0.01, o.dur || 0.1), a = Math.max(0.001, o.a || 0.003);
  const src = ctx.createBufferSource(); src.buffer = noiseBuf(ctx); src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = o.type || "bandpass"; f.Q.value = o.q || 0.9;
  f.frequency.setValueAtTime(o.bp || 1500, t);
  if (o.sweep) f.frequency.exponentialRampToValueAtTime(o.sweep, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.g || 0.1), t + a);
  if (o.sus) g.gain.setValueAtTime(Math.max(0.0002, (o.g || 0.1) * o.sus), t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(out);
  src.start(t, (o.off || 0) % 0.9); src.stop(t + dur + 0.05);
  return t + dur;
}
/* inharmonic bell: partial ratios with individual decays */
function bell(ctx, out, t, o) {
  const P = o.ratios || [1, 2.0, 2.76, 4.07, 5.4], A = o.amps || [1, 0.45, 0.5, 0.25, 0.18];
  let end = t;
  for (let i = 0; i < P.length; i++) end = Math.max(end, tone(ctx, out, t, { f: o.f * P[i], dur: (o.dur || 1) / (1 + i * 0.55), g: (o.g || 0.15) * A[i], a: 0.002 }));
  return end;
}

/* ---------- instruments (mid-rich timbres; f is the played pitch) ---------- */
const INST = {
  kalimba: (c, o, t, f, d, g) => { tone(c, o, t, { f, dur: Math.max(0.5, d * 1.4), g, a: 0.003, parts: [1, 0.35, 0.18, 0.08] }); return tone(c, o, t, { f: f * 5.4, dur: 0.06, g: g * 0.25, a: 0.001 }); },
  marimba: (c, o, t, f, d, g) => { tone(c, o, t, { f, dur: 0.42, g, a: 0.002, parts: [1, 0, 0, 0.5, 0, 0, 0, 0, 0, 0.18] }); return noise(c, o, t, { dur: 0.02, g: g * 0.25, bp: f * 3, q: 3 }); },
  flute: (c, o, t, f, d, g) => { noise(c, o, t, { dur: d, g: g * 0.12, bp: f * 2, q: 6, a: 0.05, sus: 0.6 }); return tone(c, o, t, { f, dur: d, g, a: 0.06, parts: [1, 0.25, 0.12, 0.05], sus: 0.8, vib: [5, 0.004] }); },
  horn: (c, o, t, f, d, g) => tone(c, o, t, { f, dur: d, g, a: 0.05, parts: [1, 0.8, 0.6, 0.4, 0.28, 0.18, 0.1], lp: 2600, sus: 0.75 }),
  steelpan: (c, o, t, f, d, g) => { tone(c, o, t, { f, dur: 0.6, g, a: 0.003, parts: [1, 0.55, 0.0, 0.35, 0, 0.12] }); return tone(c, o, t, { f: f * 2.98, dur: 0.18, g: g * 0.3, a: 0.002 }); },
  pluck: (c, o, t, f, d, g) => tone(c, o, t, { f, dur: Math.max(0.35, d), g, a: 0.003, parts: [1, 0.6, 0.42, 0.3, 0.22, 0.16, 0.11, 0.08], lp: 4200, lpEnd: 900 }),
  synth: (c, o, t, f, d, g) => tone(c, o, t, { f, dur: Math.max(0.12, d * 0.9), g, a: 0.004, type: "square", lp: 3600, lpEnd: 1400, det: 7 }),
  saw: (c, o, t, f, d, g) => tone(c, o, t, { f, dur: Math.max(0.12, d * 0.95), g, a: 0.006, type: "sawtooth", lp: 3000, lpEnd: 1200, det: 9 }),
  bells: (c, o, t, f, d, g) => bell(c, o, t, { f, dur: 1.6, g }),
  glass: (c, o, t, f, d, g) => bell(c, o, t, { f, dur: 1.1, g, ratios: [1, 2.32, 4.25, 6.63], amps: [1, 0.4, 0.22, 0.1] }),
  fm: (c, o, t, f, d, g) => { tone(c, o, t, { f, dur: Math.max(0.3, d), g, a: 0.01, parts: [1, 0.2, 0.55, 0.1, 0.3], det: 12 }); return tone(c, o, t, { f: f * 2, dur: 0.12, g: g * 0.25, a: 0.002, type: "triangle" }); },
  harp: (c, o, t, f, d, g) => tone(c, o, t, { f, dur: 1.3, g, a: 0.003, parts: [1, 0.5, 0.3, 0.16, 0.08, 0.04] }),
  lead: (c, o, t, f, d, g) => tone(c, o, t, { f, dur: d, g, a: 0.01, type: "triangle", sus: 0.7, vib: [5.5, 0.005], parts: [1, 0.3, 0.2, 0.12, 0.06] }),
  // bass voices: fundamental + strong 2nd–5th harmonics so a phone speaker still conveys the line
  bass: (c, o, t, f, d, g) => tone(c, o, t, { f, dur: Math.max(0.15, d * 0.9), g, a: 0.006, parts: [0.25, 0.6, 1, 0.9, 0.6, 0.4, 0.25], lp: 3000, sus: 0.6 }),
  bassSaw: (c, o, t, f, d, g) => tone(c, o, t, { f, dur: Math.max(0.1, d * 0.8), g, a: 0.004, parts: [0.3, 0.7, 1, 0.8, 0.6, 0.45, 0.3, 0.2], lp: 2600, lpEnd: 1000, q: 2 }),
  pad: (c, o, t, f, d, g) => tone(c, o, t, { f, dur: d, g, a: Math.min(0.6, d * 0.25), parts: [0.7, 0.8, 0.5, 0.35, 0.2, 0.1], det: 8, lp: 3200, sus: 0.85, rel: 0.5 }),
  darkPad: (c, o, t, f, d, g) => tone(c, o, t, { f, dur: d, g, a: Math.min(0.8, d * 0.3), parts: [0.5, 0.8, 0.7, 0.5, 0.4, 0.3, 0.2], det: 11, lp: 2200, sus: 0.85, rel: 0.6 }),
  // percussion (all centred in the speaker band)
  tick: (c, o, t, f, d, g) => tone(c, o, t, { f: 1760, dur: 0.04, g: g * 0.6, a: 0.001, type: "triangle" }),
  shaker: (c, o, t, f, d, g) => noise(c, o, t, { dur: 0.05, g, bp: 3200, q: 1.2 }),
  hat: (c, o, t, f, d, g) => noise(c, o, t, { dur: 0.035, g, bp: 3600, q: 1.5 }),
  snare: (c, o, t, f, d, g) => { tone(c, o, t, { f: 330, dur: 0.08, g: g * 0.5, a: 0.001, type: "triangle", slide: 220 }); return noise(c, o, t, { dur: 0.16, g, bp: 1900, q: 0.8 }); },
  clap: (c, o, t, f, d, g) => { for (let i = 0; i < 3; i++) noise(c, o, t + i * 0.011, { dur: 0.04, g: g * 0.7, bp: 1400, q: 1.3 }); return noise(c, o, t + 0.033, { dur: 0.14, g, bp: 1300, q: 1.0 }); },
  tom: (c, o, t, f, d, g) => tone(c, o, t, { f: 260, dur: 0.18, g, a: 0.002, slide: 170, parts: [1, 0.6, 0.4, 0.25] }),
  kick: (c, o, t, f, d, g) => { tone(c, o, t, { f: 160, dur: 0.12, g: g * 0.45, a: 0.002, slide: 70, parts: [1, 0.5, 0.3] }); return noise(c, o, t, { dur: 0.02, g: g * 0.8, bp: 1500, q: 1 }); },
  wood: (c, o, t, f, d, g) => tone(c, o, t, { f: 1250, dur: 0.05, g, a: 0.001, parts: [1, 0, 0.4] })
};

/* ---------- themes (one distinct character each) ----------
   prog: chord roots (semitones from D) per 2-bar cycle; 4 cycles = one seamless loop.
   base layer = pad + bass + motif lead; drive layer = ostinato + percussion. */
const THEMES = {
  menu:     { sv: "Huvudmeny", en: "Main menu", mood: "warm, inbjudande", bpm: 84, scale: "pentaMaj", prog: [0, -5, -3, -7], lead: "kalimba", arp: "harp", bass: "bass", pad: "pad", style: "arp8", dens: 0.55, perc: ["shaker"], bassStyle: "pedal", motif: [0, 2] },
  "meadow-classic":   { sv: "Sommaräng", en: "Summer meadow", mood: "ljus, kalimba", bpm: 96, scale: "pentaMaj", prog: [0, 5, -3, 7], lead: "kalimba", arp: "kalimba", bass: "bass", pad: "pad", style: "sparse", dens: 0.5, perc: ["shaker"], bassStyle: "pedal", motif: [0, 2] },
  "forest-deep":      { sv: "Djup skog", en: "Deep forest", mood: "träig, marimba", bpm: 94, scale: "dorian", prog: [0, -2, -4, -2], lead: "flute", arp: "marimba", bass: "bass", pad: "pad", style: "arp8", dens: 0.7, perc: ["wood"], bassStyle: "syncop", motif: [0, 3] },
  "valley-highlands": { sv: "Högdal", en: "Highland valley", mood: "vid, horn", bpm: 96, scale: "mixo", prog: [0, -2, 5, 0], lead: "horn", arp: "harp", bass: "bass", pad: "pad", style: "arp8", dens: 0.6, perc: ["tom"], bassStyle: "pedal", motif: [0, 2] },
  "tropic-classic":   { sv: "Tropik", en: "Tropics", mood: "studsig", bpm: 100, scale: "pentaMaj", prog: [0, 5, 7, 5], lead: "steelpan", arp: "marimba", bass: "bass", pad: "pad", style: "syncop", dens: 0.6, perc: ["shaker", "wood"], bassStyle: "syncop", motif: [0, 2] },
  "lagoon-paradise":  { sv: "Lagun", en: "Lagoon", mood: "steelpan, gungande", bpm: 100, scale: "major", prog: [0, 7, -3, 5], lead: "steelpan", arp: "steelpan", bass: "bass", pad: "pad", style: "syncop", dens: 0.65, perc: ["shaker"], bassStyle: "syncop", motif: [0, 2] },
  "sunset-classic":   { sv: "Solnedgång", en: "Sunset", mood: "gyllene pluck", bpm: 98, scale: "mixo", prog: [0, -2, -5, -7], lead: "lead", arp: "pluck", bass: "bass", pad: "pad", style: "arp8", dens: 0.75, perc: ["shaker"], bassStyle: "pedal", motif: [0, 2] },
  "city-neon":        { sv: "Neonstad", en: "Neon city", mood: "synthwave", bpm: 104, scale: "pentaMin", prog: [0, -4, -7, -2], lead: "synth", arp: "synth", bass: "bassSaw", pad: "darkPad", style: "arp16", dens: 1, perc: ["hat", "clap"], bassStyle: "pulse8", motif: [0, 2] },
  "winter-classic":   { sv: "Vinter", en: "Winter", mood: "klockor", bpm: 92, scale: "pentaMaj", prog: [0, -5, -3, -5], lead: "bells", arp: "glass", bass: "bass", pad: "pad", style: "sparse", dens: 0.45, perc: ["tick"], bassStyle: "pedal", motif: [0, 2] },
  "glacier-aurora":   { sv: "Glaciär", en: "Glacier", mood: "kristallklockor", bpm: 92, scale: "lydian", prog: [0, 2, -5, -1], lead: "glass", arp: "bells", bass: "bass", pad: "pad", style: "sparse", dens: 0.5, perc: ["tick"], bassStyle: "pedal", motif: [0, 2] },
  rimewake:           { sv: "Rimewake", en: "Rimewake", mood: "mörk dorisk", bpm: 90, scale: "dorian", prog: [0, -2, -5, -4], lead: "horn", arp: "glass", bass: "bass", pad: "darkPad", style: "arp8", dens: 0.55, perc: ["tom", "tick"], bassStyle: "pedal", motif: [0, 2] },
  "magic-classic":    { sv: "Magi", en: "Magic", mood: "glittrig", bpm: 96, scale: "lydian", prog: [0, 2, 4, 2], lead: "harp", arp: "glass", bass: "bass", pad: "pad", style: "arp8", dens: 0.6, perc: ["shaker"], bassStyle: "pedal", motif: [0, 2] },
  "space-deep":       { sv: "Rymd", en: "Deep space", mood: "FM-arpeggio", bpm: 94, scale: "minor", prog: [0, -4, -2, -7], lead: "fm", arp: "fm", bass: "bassSaw", pad: "darkPad", style: "arp16", dens: 0.8, perc: ["tick", "hat"], bassStyle: "pedal", motif: [0, 2] },
  "arcane-nebula":    { sv: "Nebulosa", en: "Nebula", mood: "lydisk harpa", bpm: 94, scale: "lydian", prog: [0, 2, -1, 2], lead: "harp", arp: "harp", bass: "bass", pad: "pad", style: "arp8", dens: 0.85, perc: ["shaker"], bassStyle: "pedal", motif: [0, 2] },
  endless:  { sv: "Endless", en: "Endless", mood: "drivande", bpm: 112, scale: "mixo", prog: [0, -2, 5, -5], lead: "lead", arp: "pluck", bass: "bassSaw", pad: "pad", style: "arp16", dens: 1, perc: ["hat", "snare", "kick"], bassStyle: "pulse8", motif: [0, 1, 2, 3] },
  boss:     { sv: "Bosskamp (förhandsvisning)", en: "Boss fight (preview)", mood: "moll, hotfull", bpm: 128, scale: "phryg", prog: [0, 1, -2, 1], lead: "saw", arp: "saw", bass: "bassSaw", pad: "darkPad", style: "boss", dens: 1, perc: ["kick", "snare", "hat"], bassStyle: "pulse8", motif: [0, 2], preview: true }
};
const THEME_ORDER = ["menu", "meadow-classic", "forest-deep", "valley-highlands", "lagoon-paradise", "sunset-classic", "city-neon", "glacier-aurora", "rimewake", "space-deep", "arcane-nebula", "endless", "boss", "tropic-classic", "winter-classic", "magic-classic"];
const GROUP_FALLBACK = { meadow: "meadow-classic", tropic: "lagoon-paradise", sunset: "sunset-classic", winter: "glacier-aurora", magic: "arcane-nebula" };
function themeForEnv(envId) {
  if (envId && THEMES[envId]) return envId;
  const g = String(envId || "").split("-")[0];
  return GROUP_FALLBACK[g] || "meadow-classic";
}
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function strSeed(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

const CYCLES = 4, STEPS = 16;               // 16 eighth-notes per cycle (2 bars of 4/4)
function themeLen(id) { const th = THEMES[id]; return CYCLES * STEPS * (30 / th.bpm); }

/* schedules one layer of a theme into `out` starting at t0 (all events start inside [t0, t0+len)) */
function scheduleTheme(ctx, out, id, layer, t0) {
  const th = THEMES[id]; if (!th) throw new Error("theme " + id);
  const sc = SCALES[th.scale], e8 = 30 / th.bpm, rnd = mulberry(strSeed(id + ":" + layer));
  const I = (n) => INST[n];
  for (let cy = 0; cy < CYCLES; cy++) {
    const r = th.prog[cy % th.prog.length], rn = ((r + 7) % 12 + 12) % 12 - 7, tc = t0 + cy * STEPS * e8;
    const third = sc.indexOf(3) >= 0 && sc.indexOf(4) < 0 ? 3 : 4;
    if (layer === "base") {
      // pad chord (root, third/fifth) around D4–A5 — mid band
      const padF = [hz(rn - 12), hz(rn - 5), hz(rn + third)];
      padF.forEach((f, i) => I(th.pad)(ctx, out, tc, f, STEPS * e8 + 0.02, i ? 0.045 : 0.03));
      // bass (D3–D4 fundamentals; harmonics carry it on phones)
      const bf = hz(rn - 24);
      const pat = th.bassStyle === "pulse8" ? [0, 2, 4, 6, 8, 10, 12, 14] : th.bassStyle === "syncop" ? [0, 3, 6, 8, 11, 14] : [0, 8];
      for (const s of pat) I(th.bass)(ctx, out, tc + s * e8, (th.bassStyle === "pulse8" && s % 4 === 2) ? bf * 2 : bf, (th.bassStyle === "pedal" ? 8 : 2) * e8, th.bassStyle === "pulse8" ? 0.1 : th.bassStyle === "pedal" ? 0.085 : 0.11);
      // signature motif on selected cycles (lead instrument), answer phrase otherwise
      if (th.motif.indexOf(cy) >= 0) {
        MOTIF.forEach((m, i) => I(th.lead)(ctx, out, tc + i * 2 * e8, hz(m), 2 * e8 * 0.95, 0.14));
        I(th.lead)(ctx, out, tc + 8 * e8, hz(MOTIF[3] - 3 + (id === "boss" ? -1 : 0)), 3 * e8, 0.09);
      } else {
        for (let k = 0; k < 3; k++) { const d = Math.floor(rnd() * 5); I(th.lead)(ctx, out, tc + (2 + k * 4) * e8, hz(rn + deg(sc, d)), 3 * e8, 0.08); }
      }
    } else { // drive
      const chord = [0, third, 7, 12].map(x => x + rn);
      for (let s = 0; s < STEPS; s++) {
        const ts = tc + s * e8;
        if (th.style === "sparse") {
          if (s % 2 === 0 && rnd() < th.dens) I(th.arp)(ctx, out, ts, hz(chord[Math.floor(rnd() * 4)] + (rnd() < 0.3 ? 12 : 0)), e8 * 2, 0.08);
        } else if (th.style === "syncop") {
          if ([0, 3, 6, 8, 10, 11, 14].indexOf(s) >= 0 || rnd() < th.dens * 0.2) I(th.arp)(ctx, out, ts, hz(chord[(s * 3) % 4] + (s % 8 === 6 ? 12 : 0)), e8, 0.08);
        } else if (th.style === "arp8") {
          if (rnd() < th.dens || s % 4 === 0) { const up = [0, 1, 2, 3, 2, 1, 0, 2]; I(th.arp)(ctx, out, ts, hz(chord[up[s % 8]]), e8, 0.07); }
        } else { // arp16 / boss: two sixteenths per step
          for (let h = 0; h < 2; h++) {
            const idx = (s * 2 + h) % 8, seq = th.style === "boss" ? [0, 0, 3, 0, 1, 0, 2, 1] : [0, 1, 2, 3, 2, 1, 2, 3];
            const semi = th.style === "boss" ? [0, 1, 7, 12][seq[idx]] + rn : chord[seq[idx]];
            if (rnd() < th.dens || h === 0) I(th.arp)(ctx, out, ts + h * e8 / 2, hz(semi), e8 / 2, th.style === "boss" ? 0.06 : 0.055);
          }
          if (th.style === "boss" && (s === 0 || s === 6 || s === 12)) for (const x of [0, 3, 6]) I("saw")(ctx, out, ts, hz(rn + x), e8 * 1.2, 0.045); // stabs (minor + tritone)
        }
        // percussion
        for (const p of th.perc) {
          let hit = false, g = 0.06;
          if (p === "shaker") { hit = true; g = s % 2 ? 0.035 : 0.05; }
          else if (p === "hat") { hit = true; g = s % 2 ? 0.05 : 0.035; }
          else if (p === "tick") { hit = s % 4 === 2; g = 0.05; }
          else if (p === "wood") { hit = s % 8 === 3 || s % 8 === 6; g = 0.07; }
          else if (p === "tom") { hit = s === 14 || s === 15 || (s === 7 && cy % 2); g = 0.12; }
          else if (p === "clap" || p === "snare") { hit = s % 8 === 4; g = 0.12; }
          else if (p === "kick") { hit = s % 4 === 0; g = 0.2; }
          if (hit) I(p)(ctx, out, ts, 0, e8, g);
          if (p === "hat" && th.style !== "sparse") I("hat")(ctx, out, ts + e8 / 2, 0, e8, 0.025);
        }
      }
    }
  }
  return t0 + themeLen(id);
}

/* renders one layer to a seamless loop (tail folded into the start), RMS-normalised */
const LAYER_RMS = { base: 0.11, drive: 0.085 };
async function renderTheme(id, layer, sr, mkBuffer) {
  sr = sr || 32000;
  const len = themeLen(id), tail = 2.2, N = Math.round(len * sr), T = Math.round((len + tail) * sr);
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const oc = new OAC(1, T, sr);
  const bus = oc.createGain(); bus.connect(oc.destination);
  scheduleTheme(oc, bus, id, layer, 0);
  const rb = await oc.startRendering();
  const src = rb.getChannelData(0), out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = src[i];
  for (let i = N; i < T; i++) out[i - N] += src[i];
  let ss = 0, pk = 0; for (let i = 0; i < N; i++) { ss += out[i] * out[i]; const a = Math.abs(out[i]); if (a > pk) pk = a; }
  const rms = Math.sqrt(ss / N) || 1e-9; let k = LAYER_RMS[layer] / rms; if (pk * k > 0.85) k = 0.85 / pk;
  for (let i = 0; i < N; i++) out[i] *= k;
  const buf = mkBuffer ? mkBuffer(1, N, sr) : new AudioBuffer({ length: N, sampleRate: sr, numberOfChannels: 1 });
  buf.copyToChannel(out, 0);
  return buf;
}

/* ---------- SFX cues ----------
   play(name)(ctx, out, t, opts) → end time. Gains are pre-mixed so peaks stay < ~0.5. */
const PASS_SCALE = [0, 2, 4, 7, 9, 12, 14];
const CUES = {
  flap: (c, o, t) => { noise(c, o, t, { dur: 0.045, g: 0.13, bp: 1650, q: 0.85, sweep: 2300 }); return tone(c, o, t, { f: 740, dur: 0.05, g: 0.06, a: 0.002, type: "triangle", slide: 880 }); },
  score: (c, o, t, op) => { const n = ((op && op.n) | 0) % PASS_SCALE.length; const f = hz(PASS_SCALE[n]); tone(c, o, t, { f, dur: 0.16, g: 0.13, a: 0.003, parts: [1, 0.4, 0.2] }); return tone(c, o, t + 0.045, { f: f * 1.5, dur: 0.14, g: 0.07, a: 0.003 }); },
  feather: (c, o, t) => { tone(c, o, t, { f: 1568, dur: 0.09, g: 0.07, a: 0.002 }); return tone(c, o, t + 0.05, { f: 2093, dur: 0.12, g: 0.06, a: 0.002 }); },
  near: (c, o, t) => { noise(c, o, t, { dur: 0.09, g: 0.07, bp: 1850, q: 1.4, sweep: 2600 }); return tone(c, o, t, { f: 1760, dur: 0.11, g: 0.07, a: 0.002, slide: 1480, type: "triangle" }); },
  hit: (c, o, t) => { tone(c, o, t, { f: 185, dur: 0.3, g: 0.13, a: 0.002, slide: 110, parts: [0.25, 0.5, 0.8, 1, 0.8, 0.6, 0.4] }); noise(c, o, t, { dur: 0.16, g: 0.22, bp: 1300, q: 0.7, sweep: 650 }); return noise(c, o, t, { dur: 0.05, g: 0.14, bp: 2600, q: 1 }); },
  fall: (c, o, t) => { tone(c, o, t, { f: 880, dur: 0.42, g: 0.1, a: 0.004, slide: 330, parts: [1, 0.45, 0.25] }); return noise(c, o, t + 0.3, { dur: 0.14, g: 0.12, bp: 900, q: 0.8 }); },
  click: (c, o, t) => tone(c, o, t, { f: 1046, dur: 0.05, g: 0.08, a: 0.001, type: "triangle", slide: 880 }),
  clickDeny: (c, o, t) => { tone(c, o, t, { f: 830, dur: 0.08, g: 0.08, a: 0.002, parts: [1, 0.7, 0.5, 0.3] }); return tone(c, o, t + 0.09, { f: 698, dur: 0.11, g: 0.08, a: 0.002, parts: [1, 0.7, 0.5, 0.3] }); },
  swoosh: (c, o, t) => noise(c, o, t, { dur: 0.18, g: 0.08, bp: 700, q: 1.1, sweep: 2600, a: 0.04 }),
  chirp: (c, o, t) => { tone(c, o, t, { f: 2200, dur: 0.07, g: 0.06, a: 0.002, slide: 2900 }); return tone(c, o, t + 0.09, { f: 2400, dur: 0.08, g: 0.05, a: 0.002, slide: 3100 }); },
  countdown: (c, o, t, op) => { const n = (op && op.n) | 0; const f = n <= 0 ? hz(12) : hz(MOTIF[Math.max(0, 3 - n)]); return tone(c, o, t, { f, dur: n <= 0 ? 0.28 : 0.12, g: 0.11, a: 0.003, parts: [1, 0.35, 0.15] }); },
  levelStart: (c, o, t) => { tone(c, o, t, { f: hz(0), dur: 0.12, g: 0.09, a: 0.003, parts: [1, 0.4, 0.2] }); return tone(c, o, t + 0.09, { f: hz(7), dur: 0.2, g: 0.09, a: 0.003, parts: [1, 0.4, 0.2] }); },
  warnRock: (c, o, t) => { tone(c, o, t, { f: 784, dur: 0.1, g: 0.08, a: 0.003, parts: [1, 0.6, 0.4] }); return tone(c, o, t + 0.12, { f: 587, dur: 0.14, g: 0.08, a: 0.003, parts: [1, 0.6, 0.4] }); },
  warnLaser: (c, o, t) => tone(c, o, t, { f: 1320, dur: 0.16, g: 0.05, a: 0.004, type: "square", lp: 3200, vib: [28, 0.03] }),
  warnSaw: (c, o, t) => tone(c, o, t, { f: 980, dur: 0.22, g: 0.05, a: 0.01, type: "sawtooth", lp: 2600, slide: 1240 }),
  wind: (c, o, t, op) => noise(c, o, t, { dur: op && op.soft ? 0.35 : 0.5, g: op && op.soft ? 0.05 : 0.08, bp: 900, q: 0.9, sweep: 1500, a: 0.12 }),
  // stingers (one at a time; ducks music)
  fanfare: (c, o, t) => { [0, 4, 7, 12].forEach((s, i) => INST.pluck(c, o, t + i * 0.09, hz(s), 0.3, 0.1)); return INST.kalimba(c, o, t + 0.36, hz(12), 0.5, 0.1) + 0.5; },
  levelUp: (c, o, t) => { [0, 7, 12].forEach((s, i) => INST.kalimba(c, o, t + i * 0.08, hz(s), 0.3, 0.09)); return t + 0.8; },
  medal: (c, o, t) => { bell(c, o, t, { f: hz(12), dur: 1.0, g: 0.1 }); return bell(c, o, t + 0.12, { f: hz(19), dur: 0.9, g: 0.07 }); },
  record: (c, o, t) => { MOTIF.forEach((m, i) => INST.kalimba(c, o, t + i * 0.1, hz(m), 0.25, 0.1)); return bell(c, o, t + 0.42, { f: hz(12), dur: 1.0, g: 0.08 }); },
  milestone: (c, o, t) => { INST.pluck(c, o, t, hz(7), 0.2, 0.1); return INST.pluck(c, o, t + 0.1, hz(12), 0.3, 0.1) + 0.2; },
  worldComplete: (c, o, t) => { MOTIF.forEach((m, i) => INST.horn(c, o, t + i * 0.18, hz(m), 0.3, 0.08)); [0, 4, 7].forEach(s => INST.pad(c, o, t + 0.72, hz(s), 1.4, 0.04)); return bell(c, o, t + 0.72, { f: hz(12), dur: 1.4, g: 0.08 }); },
  unlock: (c, o, t) => { [0, 4, 7, 11, 14].forEach((s, i) => INST.glass(c, o, t + i * 0.07, hz(s), 0.4, 0.06)); return t + 1.2; },
  dailyStart: (c, o, t) => { INST.kalimba(c, o, t, hz(0), 0.2, 0.09); return INST.kalimba(c, o, t + 0.12, hz(9), 0.3, 0.09) + 0.3; },
  victory: (c, o, t) => { [0, 7, 5, 2, 4, 12].forEach((m, i) => INST.lead(c, o, t + i * 0.15, hz(m), i === 5 ? 0.7 : 0.16, 0.1)); [0, 4, 7].forEach(s => INST.pad(c, o, t + 0.75, hz(s), 1.2, 0.04)); return t + 2.0; },
  gameOver: (c, o, t) => { [7, 5, 3, 2].forEach((m, i) => INST.lead(c, o, t + i * 0.22, hz(m), i === 3 ? 0.9 : 0.22, 0.1)); [0, 3, 7].forEach(s => INST.pad(c, o, t + 0.66, hz(s), 1.3, 0.035)); return t + 2.0; },
  motif: (c, o, t) => { MOTIF.forEach((m, i) => INST.kalimba(c, o, t + i * 0.16, hz(m), 0.3, 0.1)); return t + 1.1; },
  // boss preview (sound test only — no boss gameplay exists yet)
  bossAttack: (c, o, t) => { tone(c, o, t, { f: 660, dur: 0.45, g: 0.1, a: 0.01, parts: [0.4, 0.8, 1, 0.7, 0.5, 0.3], slide: 330, lp: 3000, det: 14 }); return noise(c, o, t, { dur: 0.4, g: 0.09, bp: 1200, q: 0.8, sweep: 650 }); },
  bossProjectile: (c, o, t) => { tone(c, o, t, { f: 1500, dur: 0.3, g: 0.07, a: 0.004, slide: 700, type: "triangle" }); return noise(c, o, t, { dur: 0.25, g: 0.04, bp: 2500, q: 2, sweep: 1200 }); },
  bossHit: (c, o, t) => { bell(c, o, t, { f: 620, dur: 0.5, g: 0.1, ratios: [1, 2.66, 3.5, 5.1], amps: [1, 0.6, 0.4, 0.25] }); return noise(c, o, t, { dur: 0.08, g: 0.14, bp: 1600, q: 0.9 }); },
  bossDefeat: (c, o, t) => { tone(c, o, t, { f: 300, dur: 0.7, g: 0.1, slide: 110, parts: [0.3, 0.6, 1, 0.8, 0.5, 0.3] }); noise(c, o, t, { dur: 0.6, g: 0.12, bp: 1300, q: 0.7, sweep: 500 }); MOTIF.forEach((m, i) => INST.horn(c, o, t + 0.7 + i * 0.16, hz(m), 0.3, 0.08)); return t + 2.0; }
};
const CUE_INFO = {
  flap: { sv: "Flax", cat: "spel" }, score: { sv: "Passage (+1)", cat: "spel" }, feather: { sv: "Fjäder", cat: "spel" },
  near: { sv: "Nära ögat", cat: "spel" }, hit: { sv: "Krock", cat: "spel" }, fall: { sv: "Fall", cat: "spel" },
  countdown: { sv: "Nedräkning 3-2-1-kör", cat: "spel" }, levelStart: { sv: "Start", cat: "spel" },
  warnRock: { sv: "Varning: sten", cat: "varning" }, warnLaser: { sv: "Varning: laser", cat: "varning" }, warnSaw: { sv: "Varning: såg", cat: "varning" },
  wind: { sv: "Vindtunnel", cat: "spel" }, click: { sv: "Knapp", cat: "meny" }, clickDeny: { sv: "Nekad knapp", cat: "meny" },
  swoosh: { sv: "Menyövergång", cat: "meny" }, chirp: { sv: "Fågelkvitter", cat: "meny" },
  fanfare: { sv: "Nivå klar", cat: "stinger", stinger: 2 }, levelUp: { sv: "Nivå upp", cat: "stinger", stinger: 1 },
  medal: { sv: "Medalj", cat: "stinger", stinger: 7 }, record: { sv: "Nytt rekord", cat: "stinger", stinger: 7 },
  milestone: { sv: "Milstolpe (Endless)", cat: "stinger", stinger: 1 }, worldComplete: { sv: "Värld klar", cat: "stinger", stinger: 7 },
  unlock: { sv: "Upplåst", cat: "stinger", stinger: 3 }, dailyStart: { sv: "Dagens flygning", cat: "stinger", stinger: 1 },
  victory: { sv: "Seger-musik", cat: "stinger", stinger: 6 }, gameOver: { sv: "Game over-musik", cat: "stinger", stinger: 6 },
  motif: { sv: "Glidmotivet", cat: "stinger", stinger: 1 },
  bossAttack: { sv: "Boss: attack (förhandsvisning)", cat: "boss" }, bossProjectile: { sv: "Boss: projektil (förhandsvisning)", cat: "boss" },
  bossHit: { sv: "Boss: träff (förhandsvisning)", cat: "boss" }, bossDefeat: { sv: "Boss: besegrad (förhandsvisning)", cat: "boss", stinger: 6 }
};
async function renderCue(name, opts, sr) {
  sr = sr || 44100;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const oc = new OAC(1, Math.round(sr * 3.2), sr);
  const bus = oc.createGain(); bus.connect(oc.destination);
  CUES[name](oc, bus, 0.01, opts || {});
  return oc.startRendering();
}

window.GlideAudio = Object.freeze({
  VERSION: "glide-v1", ROOT, MOTIF, THEMES, THEME_ORDER, CUES, CUE_INFO, INST,
  themeForEnv, themeLen, scheduleTheme, renderTheme, renderCue,
  play(ctx, out, name, t, opts) { const f = CUES[name]; return f ? f(ctx, out, t, opts || {}) : t; }
});
})();
