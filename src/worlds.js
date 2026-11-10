/* ============================================================
   DIPWING — src/worlds.js (World Expansion, steg 1)
   2.5D-miljösystem: flera djupskikt, parallax, dynamiskt ljus,
   levande animationer. Endast visuellt — rör ALDRIG gameplay
   (ingen RNG-förbrukning, ingen fysik, ingen kollision).

   Arkitektur:
   - PREMIUM-miljöer ritas av Worlds.drawBackground/Foreground.
   - Klassiska varianter ("*-classic") ritas av befintlig kod i
     game.js (orörd). isPremium() väljer väg i render().
   - selectEnv(level, worldKey) är ren deterministisk funktion:
     samma nivå ⇒ alltid samma miljö. Fler varianter läggs till
     genom att utöka VARIANTS — ingen omskrivning behövs.
   - Layouter förberäknas en gång per (miljö, nivå, storlek) via
     hash() och cachas (noll allokering per frame, enkel cleanup
     vid världsbyte). Animationer drivs av S.time/S.camX.
   ============================================================ */
(function () {
"use strict";

/* Egna helpers (skript-scope delas inte mellan filer — game.js
   clamp/lerp/hash/TAU är inte synliga här). */
const TAU = Math.PI * 2;
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

/* ---------- register ---------- */
const PREMIUM = { "forest-deep": true, "city-neon": true, "space-deep": true,
  "lagoon-paradise": true, "glacier-aurora": true, "valley-highlands": true, "arcane-nebula": true,
  "rimewake": true /* Identity V1 (C10): second winter for L16–20 */ };

/* Framtida varianter (A–H) läggs till här — väljaren nedan
   behöver bara nya rader, ingen ny logik. */
const VARIANTS = {
  meadow: ["meadow-classic", "forest-deep", "valley-highlands"],
  tropic: ["tropic-classic", "lagoon-paradise"],
  sunset: ["sunset-classic", "city-neon"],
  winter: ["winter-classic", "glacier-aurora", "rimewake"],
  magic: ["magic-classic", "space-deep", "arcane-nebula"]
};

function isPremium(envId) { return !!PREMIUM[envId]; }

/* Showcase-miljö per värld — används för världskartans miniatyrbilder
   (VERKLIG renderad miljökonst, ingen generisk färg). Fylls på i takt
   med att nya premiummiljöer byggs (steg B). null = gradient-fallback. */
const SHOWCASE = { meadow: "forest-deep", tropic: "lagoon-paradise", sunset: "city-neon", winter: "glacier-aurora", magic: "space-deep" };
function showcaseFor(worldKey) { return SHOWCASE[worldKey] || null; }
/* Representativ nivå per värld för miniatyrer (deterministisk). */
function showcaseLevel(worldKey) {
  if (worldKey === "meadow") return 2;
  if (worldKey === "tropic") return 4;
  if (worldKey === "sunset") return 7;
  if (worldKey === "winter") return 12;
  if (worldKey === "magic") return 22;
  return 1;
}

/* Miniatyrbild: renderar en premiummiljös bakgrund offscreen till dataURL.
   Regler: ingen RNG (hash-layoutar), ingen live-state (egen stub-S),
   ingen gameplay-påverkan. Returnerar null vid fel (anroparen faller
   tillbaka på gradient). Cache rensas efteråt så live-layouten inte
   störs (layout-cachen håller ett aktivt set i taget). */
const _thumbs = {};
function thumbnail(envId, level, w, h) {
  if (!isPremium(envId) || typeof document === "undefined") return null;
  const key = envId + "|" + level + "|" + w + "x" + h;
  if (_thumbs[key]) return _thumbs[key];
  try {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const c = cv.getContext("2d");
    if (!c) return null;
    const stub = { envId, prevEnvId: null, envBlend: 1, level,
      time: 12.5, camX: 240, groundH: Math.max(24, Math.round(h * 0.19)) };
    drawBackground(c, stub, w, h);
    for (const k in _cache) if (k.indexOf("|" + level + "|") >= 0) delete _cache[k];
    const url = cv.toDataURL("image/png");
    _thumbs[key] = url;
    return url;
  } catch (e) { return null; }
}

/* Deterministiskt miljöval per nivå (samma nivå ⇒ samma miljö).
   L1 behåller alltid klassisk äng (tutorial orörd). */
function selectEnv(level, worldKey) {
  const v = VARIANTS[worldKey] || ["meadow-classic"];
  if (v.length === 1) return v[0];
  // OBS: klassiska varianter (v[0]) bevaras som kod men används inte längre
  // för tropic/winter/magic — varje nivå har nu premiumtäckning (steg B).
  if (worldKey === "meadow") { if (level <= 1) return v[0]; return v[1 + (level % 2)]; } // L2 skog, L3 dal
  if (worldKey === "tropic") return v[1];   // L4–5 lagun
  if (worldKey === "sunset") return level <= 6 ? v[0] : v[1];
  // C10 Rimewake (Identity V1 only): L11–15 glacier + aurora, L16–20 Rimewake (darker ice, sea-green band,
  // lighthouse, no aurora). Background only — no gameplay, no level/world numbering change.
  if (worldKey === "winter") return (level >= 16 && window.IDENTITY && window.IDENTITY.V1) ? v[2] : v[1];
  if (worldKey === "magic") return level % 2 === 0 ? v[1] : v[2]; // jämn rymd, udda nebula
  return v[level % v.length];
}

/* ---------- hjälpmedel (rena, deterministiska) ---------- */
function h1(i, s) { return hash(i * 12.9898 + (s || 0) * 78.233); }

function wrapX(x, camX, f, w) {
  const span = w + 400;
  let r = (x - camX * f) % span;
  if (r < 0) r += span;
  return r - 200;
}

function rr(c, x, y, wdt, hgt, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + wdt, y, x + wdt, y + hgt, r);
  c.arcTo(x + wdt, y + hgt, x, y + hgt, r);
  c.arcTo(x, y + hgt, x, y, r);
  c.arcTo(x, y, x + wdt, y, r);
  c.closePath();
}

/* mjuk glöd utan shadowBlur (billigt på mobil) */
function glowDot(c, x, y, r, col, coreCol, alpha) {
  c.globalAlpha = alpha * 0.35; c.fillStyle = col;
  c.beginPath(); c.arc(x, y, r * 2.2, 0, TAU); c.fill();
  c.globalAlpha = alpha; c.fillStyle = coreCol || "#fff";
  c.beginPath(); c.arc(x, y, r * 0.8, 0, TAU); c.fill();
  c.globalAlpha = 1;
}

/* ---------- layout-cache (cleanup vid byte) ---------- */
const _cache = {};
function layout(envId, S, w, h) {
  const key = envId + "|" + S.level + "|" + Math.round(w) + "x" + Math.round(h);
  let L = _cache[key];
  if (!L) {
    for (const k in _cache) delete _cache[k]; // ett aktivt set i taget
    const area = w * h;
    const q = area > 500000 ? 0.6 : 1; // adaptiv kvalitet på stora ytor
    L = _builders[envId](S, w, h, q);
    _cache[key] = L;
  }
  return L;
}

/* ---------- gradient-cache (Stage D, enbart prestanda) ----------
   Geometristabila gradienter (himmel/mark/sol/globlinser) cachas per
   avrundad geometri + stopplista. Animerade/objektspecifika gradienter
   (nebulosor, komet, kristallglans, pulserande norrsken-alpha) skapas
   som vanligt varje frame. Samma nyckel ⇒ samma gradient ⇒ identisk bild.
   Cachen rensas aldrig explicit — max 32 poster, äldst åker ut. */
const _gradCache = {};
function _gradGet(kind, key, coords, stops, maker) {
  const k = kind + "|" + key + "|" + coords + "|" + stops.join(";");
  let g = _gradCache[k];
  if (!g) {
    const ks = Object.keys(_gradCache);
    if (ks.length > 32) for (const kk of ks.slice(0, ks.length - 32)) delete _gradCache[kk];
    g = maker();
    _gradCache[k] = g;
  }
  return g;
}
function linGrad(c, key, x0, y0, x1, y1, stops) {
  const r = Math.round(x0) + "," + Math.round(y0) + "," + Math.round(x1) + "," + Math.round(y1);
  return _gradGet("l", key, r, stops, () => {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    for (let i = 0; i < stops.length; i += 2) g.addColorStop(stops[i], stops[i + 1]);
    return g;
  });
}
function radGrad(c, key, x0, y0, r0, x1, y1, r1, stops) {
  const r = Math.round(x0) + "," + Math.round(y0) + "," + Math.round(r0) + "," +
    Math.round(x1) + "," + Math.round(y1) + "," + Math.round(r1);
  return _gradGet("r", key, r, stops, () => {
    const g = c.createRadialGradient(x0, y0, r0, x1, y1, r1);
    for (let i = 0; i < stops.length; i += 2) g.addColorStop(stops[i], stops[i + 1]);
    return g;
  });
}

/* ============================================================
   MILJÖBYGGARE — förberäknade layouter (hash, aldrig RNG)
   ============================================================ */
const _builders = {};

_builders["forest-deep"] = function (S, w, h, q) {
  const L = { back: [], mid: [], cliffs: [], leaves: [], flies: [] };
  const seed = S.level * 131 + 7;
  const n1 = Math.round(9 * q) + 3;
  for (let i = 0; i < n1; i++)
    L.back.push({ x: h1(i, seed) * (w + 400), wdt: 26 + h1(i, seed + 1) * 40,
      hgt: h * (0.35 + h1(i, seed + 2) * 0.3), v: h1(i, seed + 3) });
  const n2 = Math.round(7 * q) + 3;
  for (let i = 0; i < n2; i++)
    L.mid.push({ x: h1(i, seed + 11) * (w + 400), s: 0.8 + h1(i, seed + 12) * 0.7,
      v: h1(i, seed + 13), vines: 2 + Math.floor(h1(i, seed + 14) * 3) });
  for (let i = 0; i < 3; i++)
    L.cliffs.push({ x: h1(i, seed + 21) * (w + 400) + i * (w / 2), wdt: 60 + h1(i, seed + 22) * 30 });
  const nl = Math.round(8 * q) + 3;
  for (let i = 0; i < nl; i++)
    L.leaves.push({ bx: h1(i, seed + 31) * (w + 400), off: h1(i, seed + 32) * 800,
      sp: 26 + h1(i, seed + 33) * 40, ph: h1(i, seed + 34) * TAU,
      s: 2.5 + h1(i, seed + 35) * 2.5, autumn: h1(i, seed + 36) > 0.7 });
  for (let i = 0; i < 3; i++)
    L.flies.push({ cx: h1(i, seed + 41) * w, cy: h * (0.25 + h1(i, seed + 42) * 0.35),
      ax: 40 + h1(i, seed + 43) * 60, ay: 24 + h1(i, seed + 44) * 30,
      sp: 0.5 + h1(i, seed + 45) * 0.5, ph: h1(i, seed + 46) * TAU,
      col: ["#ff9a3c", "#c44f9e", "#fff"][i % 3] });
  return L;
};

/* ---------- LAGUN (lagoon-paradise: tropic L4–5) ----------
   Turkost hav, vulkanö + gröna öar, palmer, strand, vattenfall,
   korall, vågor, fåglar, vajande vegetation. */
_builders["lagoon-paradise"] = function (S, w, h, q) {
  const L = { isles: [], palms: [], waves: [], birds: [], corals: [], blooms: [] };
  const seed = S.level * 131 + 901;
  const ni = Math.round(3 * q) + 2;
  for (let i = 0; i < ni; i++)
    L.isles.push({ x: h1(i, seed) * (w + 400), wdt: 120 + h1(i, seed + 1) * 160,
      kind: h1(i, seed + 2) > 0.72 ? "volcano" : "green", v: h1(i, seed + 3) });
  const np = Math.round(8 * q) + 4;
  for (let i = 0; i < np; i++)
    L.palms.push({ x: h1(i, seed + 11) * (w + 400), s: 0.7 + h1(i, seed + 12) * 0.7,
      lean: (h1(i, seed + 13) - 0.5) * 0.5, ph: h1(i, seed + 14) * TAU });
  for (let i = 0; i < 3; i++)
    L.waves.push({ yf: 0.62 + i * 0.09, amp: 5 + i * 3, sp: 0.9 + i * 0.35, ph: h1(i, seed + 21) * TAU });
  for (let i = 0; i < 3; i++)
    L.birds.push({ bx: h1(i, seed + 31) * (w + 400), by: h * (0.14 + h1(i, seed + 32) * 0.2),
      sp: 14 + h1(i, seed + 33) * 12, ph: h1(i, seed + 34) * TAU });
  const nc = Math.round(7 * q) + 3;
  for (let i = 0; i < nc; i++)
    L.corals.push({ x: h1(i, seed + 41) * (w + 400), s: 0.6 + h1(i, seed + 42) * 1.1,
      col: ["#ff7d9e", "#ff9a5a", "#c44f9e", "#54d1b8"][i % 4], ph: h1(i, seed + 43) * TAU });
  const nb = Math.round(10 * q) + 4;
  for (let i = 0; i < nb; i++)
    L.blooms.push({ bx: h1(i, seed + 51) * (w + 400), off: h1(i, seed + 52) * 600,
      sp: 20 + h1(i, seed + 53) * 30, ph: h1(i, seed + 54) * TAU, s: 2 + h1(i, seed + 55) * 2 });
  return L;
};

/* ---------- GLACIÄR (glacier-aurora: winter L11–20) ----------
   Snöberg, frusen skog, isklippor, glaciär, frusen sjö, snöby,
   norrsken, snöfall, drivande dimma. */
_builders["glacier-aurora"] = function (S, w, h, q) {
  const L = { peaks: [], pines: [], cabins: [], flakes: [], fog: [] };
  const seed = S.level * 131 + 1101;
  const np = Math.round(4 * q) + 3;
  for (let i = 0; i < np; i++)
    L.peaks.push({ x: h1(i, seed) * (w + 400), wdt: 180 + h1(i, seed + 1) * 160,
      hgt: h * (0.3 + h1(i, seed + 2) * 0.3), v: h1(i, seed + 3) });
  const nt = Math.round(9 * q) + 5;
  for (let i = 0; i < nt; i++)
    L.pines.push({ x: h1(i, seed + 11) * (w + 400), s: 0.6 + h1(i, seed + 12) * 0.8,
      v: h1(i, seed + 13) });
  for (let i = 0; i < 3; i++)
    L.cabins.push({ x: h1(i, seed + 21) * (w + 400) + i * (w / 3), wdt: 54 + h1(i, seed + 22) * 20,
      lit: h1(i, seed + 23) });
  const nf = Math.round(40 * q) + 20;
  for (let i = 0; i < nf; i++)
    L.flakes.push({ x: h1(i, seed + 31) * (w + 400), off: h1(i, seed + 32) * h,
      sp: 24 + h1(i, seed + 33) * 46, ph: h1(i, seed + 34) * TAU, s: 1 + h1(i, seed + 35) * 2 });
  for (let i = 0; i < 3; i++)
    L.fog.push({ yf: 0.55 + i * 0.14, wdt: 200 + h1(i, seed + 41) * 160,
      sp: 8 + h1(i, seed + 42) * 10, ph: h1(i, seed + 43) * TAU, a: 0.10 + h1(i, seed + 44) * 0.08 });
  return L;
};

/* ---------- DAL (valley-highlands: meadow L3) ----------
   Bergskedjor, grön dal, flod, vattenfall, klippor, tallar,
   örnar mellan topparna, moln, ängsblommor. */
_builders["valley-highlands"] = function (S, w, h, q) {
  const L = { ridges: [], falls: [], eagles: [], clouds: [], flowers: [] };
  const seed = S.level * 131 + 1301;
  for (let r = 0; r < 3; r++) {
    const arr = [];
    const n = Math.round(5 * q) + 3;
    for (let i = 0; i < n; i++)
      arr.push({ x: h1(i, seed + r * 10) * (w + 400), wdt: 140 + h1(i, seed + r * 10 + 1) * 140,
        hgt: h * (0.22 + r * 0.1 + h1(i, seed + r * 10 + 2) * 0.18) });
    L.ridges.push(arr);
  }
  for (let i = 0; i < 2; i++)
    L.falls.push({ x: h1(i, seed + 51) * (w + 400), wdt: 16 + h1(i, seed + 52) * 12, top: h * (0.3 + h1(i, seed + 53) * 0.15) });
  for (let i = 0; i < 2; i++)
    L.eagles.push({ cx: h1(i, seed + 61) * w, cy: h * (0.2 + h1(i, seed + 62) * 0.25),
      ax: 60 + h1(i, seed + 63) * 60, sp: 0.4 + h1(i, seed + 64) * 0.3, ph: h1(i, seed + 65) * TAU });
  for (let i = 0; i < 4; i++)
    L.clouds.push({ x: h1(i, seed + 71) * (w + 400), y: h * (0.08 + h1(i, seed + 72) * 0.2),
      s: 0.7 + h1(i, seed + 73) * 0.8, v: 8 + h1(i, seed + 74) * 10 });
  const nf = Math.round(10 * q) + 6;
  for (let i = 0; i < nf; i++)
    L.flowers.push({ x: h1(i, seed + 81) * (w + 400), v: h1(i, seed + 82),
      col: ["#ff7d9e", "#ffffff", "#ffd45e"][Math.floor(h1(i, seed + 83) * 3)] });
  return L;
};

/* ---------- NEBULA (arcane-nebula: magic udda 21+) ----------
   Violett nebulosa, svävande kristallöar, stjärnströmmar, komet,
   runringar, magiska irrbloss. Rymden (space-deep) bevaras för jämna nivåer. */
_builders["arcane-nebula"] = function (S, w, h, q) {
  const L = { blobs: [], isles: [], streams: [], wisps: [] };
  const seed = S.level * 131 + 2101;
  const cols = ["122,77,232", "196,79,158", "30,144,255", "255,110,140"];
  for (let i = 0; i < 4; i++)
    L.blobs.push({ xf: 0.15 + (i % 2) * 0.6 + h1(i, seed) * 0.15, yf: 0.25 + Math.floor(i / 2) * 0.4,
      r: 110 + h1(i, seed + 1) * 90, col: cols[i % 4], sp: 0.05 + h1(i, seed + 2) * 0.05, ph: h1(i, seed + 3) * TAU });
  const ni = Math.round(3 * q) + 2;
  for (let i = 0; i < ni; i++)
    L.isles.push({ x: h1(i, seed + 11) * (w + 400), y: h * (0.2 + h1(i, seed + 12) * 0.5),
      s: 0.7 + h1(i, seed + 13) * 0.8, ph: h1(i, seed + 14) * TAU,
      runes: 3 + Math.floor(h1(i, seed + 15) * 3) });
  const ns = Math.round(26 * q) + 10;
  for (let i = 0; i < ns; i++)
    L.streams.push({ x: h1(i, seed + 21) * (w + 400), y: h1(i, seed + 22) * h,
      s: 0.6 + h1(i, seed + 23) * 1.4, ph: h1(i, seed + 24) * TAU });
  for (let i = 0; i < 5; i++)
    L.wisps.push({ cx: h1(i, seed + 31) * w, cy: h * (0.3 + h1(i, seed + 32) * 0.4),
      ax: 30 + h1(i, seed + 33) * 50, sp: 0.6 + h1(i, seed + 34) * 0.6, ph: h1(i, seed + 35) * TAU,
      col: i % 2 ? "#7df9ff" : "#e0aaff" });
  return L;
};

_builders["city-neon"] = function (S, w, h, q) {
  const L = { far: [], back: [], carsA: [], carsB: [], stars: [] };
  const seed = S.level * 131 + 7;
  const gy = h - S.groundH;
  let x = 0, i = 0;
  while (x < w + 400) { // bortre skyline
    const bw = 60 + h1(i, seed) * 70, bh = 90 + h1(i, seed + 1) * 170;
    L.far.push({ x, wdt: bw, hgt: bh, wins: h1(i, seed + 2) });
    x += bw + 8 + h1(i, seed + 3) * 30; i++;
  }
  x = 0; i = 0;
  while (x < w + 400) { // närmre torn med neon
    const bw = 70 + h1(i, seed + 11) * 60, bh = 150 + h1(i, seed + 12) * 200;
    L.back.push({ x, wdt: bw, hgt: bh, neon: h1(i, seed + 13) > 0.45,
      hue: Math.floor(h1(i, seed + 14) * 360), bill: h1(i, seed + 15) > 0.72 });
    x += bw + 26 + h1(i, seed + 16) * 50; i++;
  }
  const nc = Math.round(10 * q) + 4;
  for (let k = 0; k < nc; k++) {
    L.carsA.push({ off: h1(k, seed + 21) * (w + 400), sp: 150 + h1(k, seed + 22) * 90 });
    L.carsB.push({ off: h1(k, seed + 23) * (w + 400), sp: 170 + h1(k, seed + 24) * 110 });
  }
  const ns = Math.round(60 * q) + 20;
  for (let k = 0; k < ns; k++)
    L.stars.push({ x: h1(k, seed + 31) * w, y: h1(k, seed + 32) * h * 0.4,
      s: 0.6 + h1(k, seed + 33) * 1.4, ph: h1(k, seed + 34) * TAU });
  return L;
};

_builders["space-deep"] = function (S, w, h, q) {
  const L = { starsF: [], starsN: [], rocks: [], streaks: [] };
  const seed = S.level * 131 + 7;
  const nf = Math.round(90 * q) + 30;
  for (let i = 0; i < nf; i++)
    L.starsF.push({ x: h1(i, seed) * (w + 400), y: h1(i, seed + 1) * h,
      s: 0.5 + h1(i, seed + 2) * 1.2, ph: h1(i, seed + 3) * TAU });
  const nn = Math.round(36 * q) + 12;
  for (let i = 0; i < nn; i++)
    L.starsN.push({ x: h1(i, seed + 11) * (w + 400), y: h1(i, seed + 12) * h,
      s: 1 + h1(i, seed + 13) * 1.6, ph: h1(i, seed + 14) * TAU,
      cross: h1(i, seed + 15) > 0.75 });
  for (let i = 0; i < 6; i++) {
    const verts = [];
    const nv = 7 + Math.floor(h1(i, seed + 21) * 3);
    for (let k = 0; k < nv; k++) verts.push(0.7 + h1(i * 10 + k, seed + 22) * 0.5);
    L.rocks.push({ x: h1(i, seed + 23) * (w + 400), y: h * (0.15 + h1(i, seed + 24) * 0.6),
      r: 14 + h1(i, seed + 25) * 26, verts, rs: (h1(i, seed + 26) - 0.5) * 0.8,
      ph: h1(i, seed + 27) * TAU, drift: 8 + h1(i, seed + 28) * 14 });
  }
  const nst = Math.round(22 * q) + 8;
  for (let i = 0; i < nst; i++)
    L.streaks.push({ x: h1(i, seed + 31) * (w + 400), y: h1(i, seed + 32) * h,
      len: 20 + h1(i, seed + 33) * 40 });
  return L;
};

/* ============================================================
   RITNING — bakgrund per miljö (4 djupskikt + ljus)
   ============================================================ */
/* ================= LAGUN (lagoon-paradise) ================= */
function envLagoon(c, S, w, h) {
  const L = layout("lagoon-paradise", S, w, h);
  const gy = h - S.groundH;
  const horizon = h * 0.60;
  const sz = Math.round(w) + "x" + Math.round(h);
  c.fillStyle = linGrad(c, "lagoon.sky." + sz, 0, 0, 0, h, [0, "#3ec6e8", 0.45, "#a8ecdc", 0.62, "#e8f7d8", 1, "#fdf3cf"]);
  c.fillRect(-30, -30, w + 60, h + 60);
  const sx = w * 0.24, sy = h * 0.15;
  c.fillStyle = radGrad(c, "lagoon.sun." + sz, sx, sy, 4, sx, sy, 110, [0, "rgba(255,255,240,0.85)", 1, "rgba(255,255,240,0)"]);
  c.fillRect(sx - 110, sy - 110, 220, 220);
  c.fillStyle = "#fffdf0";
  c.beginPath(); c.arc(sx, sy, 30, 0, TAU); c.fill();
  c.fillStyle = "rgba(255,255,255,0.9)";
  for (let i = 0; i < 4; i++) {
    const cxp = wrapX(h1(i, 7) * (w + 400) + S.time * 8, 0, 0, w);
    const cyp = h * (0.1 + i * 0.09);
    c.beginPath();
    c.ellipse(cxp, cyp, 56, 15, 0, 0, TAU);
    c.ellipse(cxp - 36, cyp + 5, 30, 11, 0, 0, TAU);
    c.ellipse(cxp + 36, cyp + 5, 32, 12, 0, 0, TAU);
    c.fill();
  }
  for (const isl of L.isles) {
    const x = wrapX(isl.x, S.camX, 0.1, w);
    if (x < -220 || x > w + 220) continue;
    if (isl.kind === "volcano") {
      c.fillStyle = "#5a4a52";
      c.beginPath();
      c.moveTo(x - isl.wdt / 2, horizon); c.lineTo(x, horizon - 150 - isl.v * 60);
      c.lineTo(x + isl.wdt / 2, horizon); c.closePath(); c.fill();
      c.fillStyle = "#7a5a3a";
      c.beginPath();
      c.moveTo(x - 18, horizon - 150 - isl.v * 60); c.lineTo(x, horizon - 150 - isl.v * 60);
      c.lineTo(x + 18, horizon - 150 - isl.v * 60); c.lineTo(x + 8, horizon - 132 - isl.v * 60);
      c.lineTo(x - 8, horizon - 132 - isl.v * 60); c.closePath(); c.fill();
      for (let k = 0; k < 3; k++) {
        const rt = ((S.time * 0.25 + k / 3 + isl.v) % 1);
        c.globalAlpha = 0.5 * (1 - rt);
        c.fillStyle = "#cfc4cc";
        c.beginPath(); c.arc(x + Math.sin(rt * 5 + k) * 14, horizon - 165 - isl.v * 60 - rt * 70, 8 + rt * 14, 0, TAU); c.fill();
      }
      c.globalAlpha = 1;
    } else {
      c.fillStyle = "#3fa36b";
      c.beginPath(); c.ellipse(x, horizon, isl.wdt / 2, 34 + isl.v * 20, 0, Math.PI, 0); c.fill();
      c.fillStyle = "#63c76a";
      c.beginPath(); c.ellipse(x - isl.wdt * 0.15, horizon - 8, isl.wdt * 0.28, 20 + isl.v * 12, 0, Math.PI, 0); c.fill();
    }
  }
  c.fillStyle = linGrad(c, "lagoon.ocean." + sz, 0, horizon, 0, gy, [0, "#37c8d8", 0.6, "#1f9ec4", 1, "#177a9e"]);
  c.fillRect(-30, horizon, w + 60, gy - horizon);
  c.lineWidth = 2.5; c.lineCap = "round";
  for (const wv of L.waves) {
    const yy = horizon + (gy - horizon) * wv.yf * 0.5 + 8;
    c.strokeStyle = "rgba(255,255,255,0.55)";
    c.beginPath();
    for (let x = -30; x <= w + 30; x += 14) {
      const y = yy + Math.sin(x * 0.05 + S.time * wv.sp + wv.ph) * wv.amp * 0.4;
      x === -30 ? c.moveTo(x, y) : c.lineTo(x, y);
    }
    c.stroke();
  }
  c.fillStyle = "rgba(235,250,255,0.85)";
  const fx = wrapX(h1(3, 77) * (w + 400), S.camX, 0.22, w);
  const fw = 26;
  c.fillRect(fx, horizon - 110, fw, 110 + (gy - horizon) * 0.4);
  c.fillStyle = "rgba(255,255,255,0.8)";
  const fall = (S.time * 160) % 46;
  for (let y = horizon - 110 + fall - 46; y < horizon + 20; y += 46) c.fillRect(fx + 3, y, fw - 6, 13);
  for (const p of L.palms) {
    const x = wrapX(p.x, S.camX, 0.35, w);
    if (x < -80 || x > w + 80) continue;
    const baseY = gy - 6, th = 110 * p.s;
    const sway = Math.sin(S.time * 1.4 + p.ph) * 6;
    c.strokeStyle = "#7a5230"; c.lineWidth = 7 * p.s; c.lineCap = "round";
    c.beginPath(); c.moveTo(x, baseY);
    c.quadraticCurveTo(x + p.lean * 60, baseY - th * 0.6, x + p.lean * 60 + sway, baseY - th);
    c.stroke();
    const tx = x + p.lean * 60 + sway, ty = baseY - th;
    c.strokeStyle = "#2fa36b"; c.lineWidth = 5 * p.s;
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI * 0.1 - i * 0.5 + Math.sin(S.time * 1.8 + p.ph + i) * 0.06;
      c.beginPath(); c.moveTo(tx, ty);
      c.quadraticCurveTo(tx + Math.cos(a) * 26 * p.s, ty + Math.sin(a) * 16 * p.s - 6,
        tx + Math.cos(a) * 42 * p.s, ty + Math.sin(a) * 20 * p.s + 7);
      c.stroke();
    }
    c.fillStyle = "#6b4423";
    c.beginPath(); c.arc(tx - 4, ty + 2, 3.5 * p.s, 0, TAU); c.arc(tx + 4, ty + 2, 3.5 * p.s, 0, TAU); c.fill();
  }
  c.strokeStyle = "rgba(43,60,70,0.6)"; c.lineWidth = 2; c.lineCap = "round";
  for (const b of L.birds) {
    const bx = wrapX(b.bx + S.time * b.sp, 0, 0, w);
    const by = b.by + Math.sin(S.time * 0.9 + b.ph) * 8;
    const f = Math.sin(S.time * 7 + b.ph) * 4;
    c.beginPath();
    c.moveTo(bx - 9, by - f); c.quadraticCurveTo(bx - 3, by + 1, bx, by);
    c.quadraticCurveTo(bx + 3, by + 1, bx + 9, by - f);
    c.stroke();
  }
  for (const bl of L.blooms) {
    const y = ((bl.off + S.time * bl.sp) % (h + 60)) - 30;
    const x = wrapX(bl.bx + Math.sin(S.time * 1.3 + bl.ph) * 30, S.camX, 0.45, w);
    c.save(); c.translate(x, y); c.rotate(S.time * 1.8 + bl.ph);
    c.globalAlpha = 0.85; c.fillStyle = "#ffb3d1";
    c.beginPath(); c.ellipse(0, 0, bl.s + 1, bl.s * 0.6, 0, 0, TAU); c.fill();
    c.restore();
  }
  c.globalAlpha = 1;
  groundStrip(c, S, w, h, "#f2df9e", "#dcc176", "rgba(255,255,255,0.6)");
  for (const co of L.corals) {
    const x = wrapX(co.x, S.camX, 0.6, w);
    if (x < -40 || x > w + 40) continue;
    const baseY = gy + 8, s = co.s;
    const sway = Math.sin(S.time * 1.6 + co.ph) * 3;
    c.strokeStyle = co.col; c.lineWidth = 4; c.lineCap = "round"; c.globalAlpha = 0.85;
    for (const [dx, hh] of [[-8, 22], [0, 30], [8, 24]]) {
      c.beginPath(); c.moveTo(x + dx * s, baseY);
      c.quadraticCurveTo(x + dx * s + sway, baseY - hh * s * 0.6, x + dx * s + sway * 1.6, baseY - hh * s);
      c.stroke();
    }
    c.globalAlpha = 1;
  }
}

/* ================= GLACIÄR (glacier-aurora) ================= */
function envGlacier(c, S, w, h, rime) {
  const L = layout("glacier-aurora", S, w, h);
  const gy = h - S.groundH;
  const sz = Math.round(w) + "x" + Math.round(h);
  c.fillStyle = rime ? linGrad(c, "rime.sky." + sz, 0, 0, 0, h, [0, "#061a22", 0.5, "#0f3a46", 1, "#3f7f86"])
    : linGrad(c, "glacier.sky." + sz, 0, 0, 0, h, [0, "#0a1030", 0.5, "#1c2f5e", 1, "#5e7ba6"]);
  c.fillRect(-30, -30, w + 60, h + 60);
  for (let i = 0; i < 40; i++) {
    const tw = 0.3 + 0.7 * Math.abs(Math.sin(S.time * 1.5 + i * 1.7));
    c.globalAlpha = tw * 0.8; c.fillStyle = "#fff";
    c.fillRect(h1(i, 5) * w, h1(i, 9) * h * 0.4, 1.6, 1.6);
  }
  c.globalAlpha = 1;
  if (rime) drawLighthouse(c, S, w, h, gy);
  for (let b = 0; b < (rime ? 0 : 2); b++) {
    c.save();
    c.globalAlpha = 0.20 + 0.07 * Math.sin(S.time * 0.8 + b * 2);
    c.fillStyle = linGrad(c, "glacier.aurora" + b + "." + Math.round(w), 0, 0, w, 0,
      b ? [0, "#7df9ff", 0.5, "#b47fe8", 1, "#4dffa6"] : [0, "#4dffa6", 0.5, "#7df9ff", 1, "#b47fe8"]);
    c.beginPath();
    const yb = h * (0.12 + b * 0.09);
    for (let x = -30; x <= w + 30; x += 14) {
      const y = yb + Math.sin(x * 0.02 + S.time * 0.7 + b * 2) * 24 + Math.sin(x * 0.05 - S.time * 0.4) * 9;
      x === -30 ? c.moveTo(x, y) : c.lineTo(x, y);
    }
    for (let x = w + 30; x >= -30; x -= 14) {
      const y = yb + 60 + Math.sin(x * 0.02 + S.time * 0.7 + b * 2) * 24;
      c.lineTo(x, y);
    }
    c.closePath(); c.fill();
    c.restore();
  }
  const mx = w * 0.8, my = h * 0.13;
  c.fillStyle = radGrad(c, "glacier.moon." + sz, mx, my, 4, mx, my, 70, [0, "rgba(230,240,255,0.55)", 1, "rgba(230,240,255,0)"]);
  c.fillRect(mx - 70, my - 70, 140, 140);
  c.fillStyle = "#eef4ff";
  c.beginPath(); c.arc(mx, my, 22, 0, TAU); c.fill();
  const ridge = (baseY, amp, f1, off, col) => {
    c.fillStyle = col;
    c.beginPath(); c.moveTo(-30, baseY);
    for (let x = -30; x <= w + 30; x += 12) {
      const wx = x + off;
      c.lineTo(x, baseY - (Math.abs(Math.sin(wx * f1)) * amp + Math.abs(Math.sin(wx * f1 * 2.7 + 1.7)) * amp * 0.4));
    }
    c.lineTo(w + 30, baseY); c.lineTo(w + 30, gy); c.lineTo(-30, gy); c.closePath(); c.fill();
    c.fillStyle = "rgba(255,255,255,0.92)";
    for (let x = -20; x < w + 20; x += 80) {
      const wx = x + off;
      const peak = baseY - (Math.abs(Math.sin(wx * f1)) * amp + 24);
      c.beginPath();
      c.moveTo(x - 24, peak + 30); c.lineTo(x, peak); c.lineTo(x + 24, peak + 30);
      c.lineTo(x + 11, peak + 24); c.lineTo(x, peak + 30); c.lineTo(x - 11, peak + 24);
      c.closePath(); c.fill();
    }
  };
  ridge(gy - 120, 130, 0.005, S.camX * 0.06, "#5e7396");
  ridge(gy - 60, 90, 0.008, S.camX * 0.12 + 400, "#7c93b5");
  c.fillStyle = "#bcd8ee";
  c.beginPath();
  c.moveTo(-30, gy - 40);
  c.lineTo(w * 0.4, gy - 150); c.lineTo(w * 0.55, gy - 150); c.lineTo(w * 0.35, gy - 30);
  c.lineTo(-30, gy - 30); c.closePath(); c.fill();
  c.strokeStyle = "rgba(70,110,150,0.6)"; c.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    c.beginPath();
    c.moveTo(w * (0.1 + i * 0.07), gy - 60 - i * 18);
    c.lineTo(w * (0.16 + i * 0.07), gy - 44 - i * 18);
    c.stroke();
  }
  const lakeY = gy - 26;
  c.fillStyle = linGrad(c, "glacier.lake." + sz, 0, lakeY, 0, gy + 20, [0, "rgba(200,230,250,0.75)", 1, "rgba(140,180,220,0.9)"]);
  c.fillRect(-30, lakeY, w + 60, gy + 20 - lakeY);
  c.fillStyle = "rgba(255,255,255,0.5)";
  const shim = (S.time * 30) % (w + 200);
  c.fillRect(w - shim + 100, lakeY + 4, 90, 3);
  for (const cb of L.cabins) {
    const x = wrapX(cb.x, S.camX, 0.3, w);
    if (x < -100 || x > w + 100) continue;
    const by = gy - 4, bw = cb.wdt, bh = 34;
    c.fillStyle = "#6b4a33"; c.fillRect(x, by - bh, bw, bh);
    c.fillStyle = "#4a3222";
    c.beginPath(); c.moveTo(x - 6, by - bh); c.lineTo(x + bw / 2, by - bh - 22); c.lineTo(x + bw + 6, by - bh); c.closePath(); c.fill();
    c.fillStyle = "rgba(255,255,255,0.9)";
    c.beginPath(); c.moveTo(x - 6, by - bh); c.lineTo(x + bw / 2, by - bh - 22); c.lineTo(x + bw + 6, by - bh);
    c.lineTo(x + bw - 4, by - bh); c.lineTo(x + bw / 2, by - bh - 12); c.lineTo(x + 4, by - bh); c.closePath(); c.fill();
    const flick = 0.7 + 0.3 * Math.sin(S.time * 3 + x);
    c.globalAlpha = flick; c.fillStyle = "#ffd97a";
    c.fillRect(x + bw / 2 - 7, by - bh + 10, 14, 12);
    c.globalAlpha = 1;
    for (let k = 0; k < 2; k++) {
      const rt = ((S.time * 0.3 + k / 2 + cb.lit) % 1);
      c.globalAlpha = 0.4 * (1 - rt); c.fillStyle = "#dfe6ee";
      c.beginPath(); c.arc(x + bw - 10 + rt * 12, by - bh - 26 - rt * 40, 4 + rt * 6, 0, TAU); c.fill();
    }
    c.globalAlpha = 1;
  }
  for (const t of L.pines) {
    const x = wrapX(t.x, S.camX, 0.5, w);
    if (x < -60 || x > w + 60) continue;
    const s = t.s, baseY = gy - 2;
    c.fillStyle = "#5a3d28"; c.fillRect(x - 3 * s, baseY - 14 * s, 6 * s, 14 * s);
    const layers = [["#2e5d4f", -44, 34], ["#3a7563", -28, 42], ["#4a8a74", -12, 50]];
    for (const [col, ty, hw] of layers) {
      c.fillStyle = col;
      c.beginPath(); c.moveTo(x, baseY + ty * s - 10 * s); c.lineTo(x - hw * s / 2, baseY + ty * s + 12 * s); c.lineTo(x + hw * s / 2, baseY + ty * s + 12 * s); c.closePath(); c.fill();
      c.fillStyle = "rgba(255,255,255,0.9)";
      c.beginPath(); c.moveTo(x, baseY + ty * s - 10 * s); c.lineTo(x - hw * s / 4, baseY + ty * s + 2 * s); c.lineTo(x, baseY + ty * s - 2 * s); c.lineTo(x + hw * s / 4, baseY + ty * s + 2 * s); c.closePath(); c.fill();
    }
  }
  c.fillStyle = "#fff";
  for (const f of L.flakes) {
    const y = ((f.off + S.time * f.sp) % (h + 20)) - 10;
    const x = wrapX(f.x + Math.sin(S.time * 1.5 + f.ph) * 18, S.camX, 0.25, w);
    c.globalAlpha = 0.85;
    c.beginPath(); c.arc(x, y, f.s, 0, TAU); c.fill();
  }
  c.globalAlpha = 1;
  for (const fo of L.fog) {
    const fx2 = wrapX(S.time * fo.sp + fo.ph * 100, 0, 0, w + fo.wdt) - fo.wdt / 2;
    c.globalAlpha = fo.a; c.fillStyle = "#dfe8f2";
    c.beginPath(); c.ellipse(fx2, h * fo.yf, fo.wdt / 2, 22, 0, 0, TAU); c.fill();
  }
  c.globalAlpha = 1;
  if (rime) groundStrip(c, S, w, h, "#bfe9e0", "#3fa792", "rgba(232,255,248,0.8)");
  else groundStrip(c, S, w, h, "#eef4fb", "#c3d4e8", "rgba(255,255,255,0.8)");
}
/* Rimewake beacon: a lighthouse on the far cliff; the beam sweeps slowly (static in reduced motion).
   Drawn BEHIND the obstacle layer like all scenery; low alpha so gates stay fully readable. */
function drawLighthouse(c, S, w, h, gy) {
  const x = wrapX(w * 0.25, S.camX, 0.04, w);
  const base = gy - 150;
  const rm = document.body && document.body.classList.contains("reduced-motion");
  const a = rm ? -0.35 : Math.sin(S.time * 0.6) * 0.9 - 0.2;
  c.save();
  c.globalAlpha = 0.16; c.fillStyle = "#e8fff8";
  c.beginPath(); c.moveTo(x, base - 62);
  c.lineTo(x + Math.cos(a - 0.12) * w * 1.2, base - 62 + Math.sin(a - 0.12) * w * 1.2);
  c.lineTo(x + Math.cos(a + 0.12) * w * 1.2, base - 62 + Math.sin(a + 0.12) * w * 1.2);
  c.closePath(); c.fill();
  c.globalAlpha = 1;
  c.fillStyle = "#24424c"; c.beginPath(); c.moveTo(x - 60, gy); c.lineTo(x - 30, base + 8); c.lineTo(x + 40, base + 4); c.lineTo(x + 80, gy); c.closePath(); c.fill();
  c.fillStyle = "#e9f3f2"; c.beginPath(); c.moveTo(x - 9, base); c.lineTo(x - 6, base - 54); c.lineTo(x + 6, base - 54); c.lineTo(x + 9, base); c.closePath(); c.fill();
  c.fillStyle = "#ff6b4a"; c.fillRect(x - 8, base - 22, 16, 7); c.fillRect(x - 7, base - 42, 14, 6);
  c.fillStyle = "#1a2f36"; c.fillRect(x - 8, base - 62, 16, 8);
  c.fillStyle = "#fff6c4"; c.beginPath(); c.arc(x, base - 58, 4, 0, TAU); c.fill();
  c.restore();
}

/* ================= DAL (valley-highlands) ================= */
function envValley(c, S, w, h) {
  const L = layout("valley-highlands", S, w, h);
  const gy = h - S.groundH;
  const sz = Math.round(w) + "x" + Math.round(h);
  c.fillStyle = linGrad(c, "valley.sky." + sz, 0, 0, 0, h, [0, "#4fa8e8", 0.55, "#bfe3d8", 1, "#fdf6d8"]);
  c.fillRect(-30, -30, w + 60, h + 60);
  const sx = w * 0.75, sy = h * 0.14;
  c.fillStyle = radGrad(c, "valley.sun." + sz, sx, sy, 4, sx, sy, 100, [0, "rgba(255,252,220,0.85)", 1, "rgba(255,252,220,0)"]);
  c.fillRect(sx - 100, sy - 100, 200, 200);
  c.fillStyle = "#fffbe8";
  c.beginPath(); c.arc(sx, sy, 30, 0, TAU); c.fill();
  c.fillStyle = "rgba(255,255,255,0.92)";
  for (const cl of L.clouds) {
    const cxp = wrapX(cl.x + S.time * cl.v, 0, 0, w);
    c.beginPath();
    c.ellipse(cxp, cl.y, 52 * cl.s, 14 * cl.s, 0, 0, TAU);
    c.ellipse(cxp - 32 * cl.s, cl.y + 5, 26 * cl.s, 10 * cl.s, 0, 0, TAU);
    c.ellipse(cxp + 32 * cl.s, cl.y + 5, 28 * cl.s, 11 * cl.s, 0, 0, TAU);
    c.fill();
  }
  const cols = ["#8fa8c4", "#6e8aa8", "#55688a"];
  const snow = [true, true, false];
  for (let r = 0; r < 3; r++) {
    c.fillStyle = cols[r];
    c.beginPath(); c.moveTo(-30, gy - 40);
    for (let x = -30; x <= w + 30; x += 14) {
      const wx = x + S.camX * (0.05 + r * 0.05) + r * 300;
      c.lineTo(x, gy - 40 - (Math.abs(Math.sin(wx * 0.006)) * (110 + r * 40) + Math.abs(Math.sin(wx * 0.017 + 2)) * 30));
    }
    c.lineTo(w + 30, gy - 40); c.lineTo(w + 30, gy); c.lineTo(-30, gy); c.closePath(); c.fill();
    if (snow[r]) {
      c.fillStyle = "rgba(255,255,255,0.9)";
      for (let x = -20; x < w + 20; x += 90) {
        const wx = x + S.camX * (0.05 + r * 0.05) + r * 300;
        const peak = gy - 40 - (Math.abs(Math.sin(wx * 0.006)) * (110 + r * 40) + 22);
        c.beginPath();
        c.moveTo(x - 22, peak + 28); c.lineTo(x, peak); c.lineTo(x + 22, peak + 28);
        c.lineTo(x + 10, peak + 22); c.lineTo(x, peak + 28); c.lineTo(x - 10, peak + 22);
        c.closePath(); c.fill();
      }
    }
  }
  // flod (slingrande ljusband i dalen)
  c.strokeStyle = "rgba(160,220,245,0.9)"; c.lineWidth = 16; c.lineCap = "round";
  c.beginPath();
  for (let x = -30; x <= w + 30; x += 16) {
    const y = gy - 60 + Math.sin((x + S.camX * 0.3) * 0.012) * 22;
    x === -30 ? c.moveTo(x, y) : c.lineTo(x, y);
  }
  c.stroke();
  c.strokeStyle = "rgba(255,255,255,0.7)"; c.lineWidth = 4;
  c.beginPath();
  for (let x = -30; x <= w + 30; x += 16) {
    const y = gy - 62 + Math.sin((x + S.camX * 0.3) * 0.012) * 22;
    x === -30 ? c.moveTo(x, y) : c.lineTo(x, y);
  }
  c.stroke();
  // vattenfall från klipporna
  for (const wf of L.falls) {
    const x = wrapX(wf.x, S.camX, 0.2, w);
    if (x < -60 || x > w + 60) continue;
    c.fillStyle = "#7a8a99";
    c.fillRect(x - 8, wf.top - 40, wf.wdt + 16, 60);
    c.fillStyle = "rgba(230,245,255,0.9)";
    c.fillRect(x, wf.top - 40, wf.wdt, (gy - 60) - (wf.top - 40));
    c.fillStyle = "rgba(255,255,255,0.85)";
    const fd = (S.time * 200) % 52;
    for (let y = wf.top - 40 + fd - 52; y < gy - 60; y += 52) c.fillRect(x + 2, y, wf.wdt - 4, 14);
    c.globalAlpha = 0.5; c.fillStyle = "#e8f4ff";
    c.beginPath(); c.ellipse(x + wf.wdt / 2, gy - 58, wf.wdt, 9, 0, 0, TAU); c.fill();
    c.globalAlpha = 1;
  }
  // örnar mellan topparna
  c.strokeStyle = "rgba(43,33,24,0.55)"; c.lineWidth = 2.5; c.lineCap = "round";
  for (const e of L.eagles) {
    const ex = e.cx + Math.sin(S.time * e.sp + e.ph) * e.ax - S.camX * 0.1 % 80;
    const ey = e.cy + Math.cos(S.time * e.sp * 1.3 + e.ph) * 20;
    const f = Math.sin(S.time * 6 + e.ph) * 5;
    c.beginPath();
    c.moveTo(ex - 12, ey - f); c.quadraticCurveTo(ex - 4, ey + 2, ex, ey);
    c.quadraticCurveTo(ex + 4, ey + 2, ex + 12, ey - f);
    c.stroke();
  }
  groundStrip(c, S, w, h, "#5da33c", "#3f7a2a", "rgba(255,255,255,0.4)");
  for (const fl of L.flowers) {
    const x = wrapX(fl.x, S.camX, 0.6, w);
    if (x < -20 || x > w + 20) continue;
    c.fillStyle = fl.col;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      c.beginPath(); c.ellipse(x + Math.cos(a) * 3.5, gy - 10 + Math.sin(a) * 3.5, 3, 3, 0, 0, TAU); c.fill();
    }
    c.fillStyle = "#ffcf3f";
    c.beginPath(); c.arc(x, gy - 10, 2.6, 0, TAU); c.fill();
  }
}

/* ================= NEBULA (arcane-nebula) ================= */
function envNebula(c, S, w, h) {
  const L = layout("arcane-nebula", S, w, h);
  const gy = h - S.groundH;
  const sz = Math.round(w) + "x" + Math.round(h);
  c.fillStyle = linGrad(c, "nebula.sky." + sz, 0, 0, 0, h, [0, "#080418", 0.55, "#241245", 1, "#3d1a55"]);
  c.fillRect(-30, -30, w + 60, h + 60);
  for (const b of L.blobs) {
    const nx = b.xf * w + Math.sin(S.time * b.sp + b.ph) * 26;
    const ny = b.yf * h + Math.cos(S.time * b.sp * 0.8 + b.ph) * 18;
    const ng = c.createRadialGradient(nx, ny, 4, nx, ny, b.r);
    ng.addColorStop(0, "rgba(" + b.col + ",0.32)"); ng.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = ng;
    c.fillRect(nx - b.r, ny - b.r, b.r * 2, b.r * 2);
  }
  for (const st of L.streams) {
    const x = wrapX(st.x, S.camX, 0.04, w);
    const tw = 0.3 + 0.7 * Math.abs(Math.sin(S.time * 1.7 + st.ph));
    c.globalAlpha = tw; c.fillStyle = "#d9c8ff";
    c.fillRect(x, st.y, st.s, st.s);
  }
  c.globalAlpha = 1;
  const scyc = 9, stt = S.time % scyc;
  if (stt < 1.1) {
    const k = stt / 1.1;
    const hx0 = w * 0.85 - k * w * 0.5, hy0 = h * 0.08 + k * h * 0.22;
    const tg = c.createLinearGradient(hx0, hy0, hx0 + 60, hy0 - 30);
    tg.addColorStop(0, "rgba(255,255,255,0.9)"); tg.addColorStop(1, "rgba(255,255,255,0)");
    c.strokeStyle = tg; c.lineWidth = 2.5; c.lineCap = "round";
    c.beginPath(); c.moveTo(hx0, hy0); c.lineTo(hx0 + 60, hy0 - 30); c.stroke();
  }
  // svävande kristallöar med runor
  for (const isl of L.isles) {
    const x = wrapX(isl.x, S.camX, 0.15, w);
    if (x < -90 || x > w + 90) continue;
    const y = isl.y + Math.sin(S.time * 0.6 + isl.ph) * 10;
    const s = isl.s;
    c.fillStyle = "rgba(60,40,100,0.9)";
    c.beginPath();
    c.moveTo(x - 34 * s, y - 6 * s); c.lineTo(x - 12 * s, y + 22 * s); c.lineTo(x + 16 * s, y + 18 * s);
    c.lineTo(x + 34 * s, y - 10 * s); c.lineTo(x + 10 * s, y - 16 * s); c.lineTo(x - 16 * s, y - 14 * s);
    c.closePath(); c.fill();
    c.strokeStyle = "#241c4e"; c.lineWidth = 2; c.stroke();
    const cols = ["#7df9ff", "#e0aaff", "#ff9ad5"];
    for (let k = 0; k < isl.runes; k++) {
      const cxr = x + (k - (isl.runes - 1) / 2) * 18 * s;
      const cyr = y - 26 * s - (k % 2) * 8 * s;
      c.fillStyle = cols[k % 3]; c.globalAlpha = 0.9;
      c.beginPath();
      c.moveTo(cxr, cyr - 9 * s); c.lineTo(cxr + 5 * s, cyr); c.lineTo(cxr, cyr + 9 * s);
      c.lineTo(cxr - 5 * s, cyr); c.closePath(); c.fill();
      c.globalAlpha = 1;
      c.fillStyle = "rgba(255,255,255,0.75)";
      c.fillRect(cxr - 1, cyr - 5 * s, 2, 10 * s);
    }
    c.save();
    c.globalAlpha = 0.4 + 0.15 * Math.sin(S.time * 2 + isl.ph);
    c.strokeStyle = "#b47fe8"; c.lineWidth = 2;
    c.beginPath(); c.ellipse(x, y + 4 * s, 44 * s, 12 * s, -0.15 + 0.05 * Math.sin(S.time * 0.5 + isl.ph), S.time * 0.4, S.time * 0.4 + 4.2); c.stroke();
    c.restore();
    glowDot(c, x, y + 24 * s, 5, "#b47fe8", "#fff", 0.5);
  }
  // irrbloss
  for (const wsp of L.wisps) {
    const x = wsp.cx + Math.sin(S.time * wsp.sp + wsp.ph) * wsp.ax - S.camX * 0.2 % 60;
    const y = wsp.cy + Math.cos(S.time * wsp.sp * 1.2 + wsp.ph) * 24;
    glowDot(c, x, y, 4, wsp.col, "#fff", 0.8);
  }
  groundStrip(c, S, w, h, "#2c1a55", "#170f33", "rgba(180,127,232,0.55)");
  c.save();
  c.globalAlpha = 0.6 + 0.25 * Math.sin(S.time * 2);
  c.fillStyle = "#b47fe8";
  c.fillRect(-30, gy - 3, w + 60, 3);
  c.restore();
}

function drawEnv(id, c, S, w, h) {
  if (id === "forest-deep") return envForest(c, S, w, h);
  if (id === "city-neon") return envCity(c, S, w, h);
  if (id === "space-deep") return envSpace(c, S, w, h);
  if (id === "lagoon-paradise") return envLagoon(c, S, w, h);
  if (id === "glacier-aurora") return envGlacier(c, S, w, h);
  if (id === "rimewake") return envGlacier(c, S, w, h, true);
  if (id === "valley-highlands") return envValley(c, S, w, h);
  if (id === "arcane-nebula") return envNebula(c, S, w, h);
}

function drawBackground(c, S, w, h) {
  const cur = S.envId, prev = S.prevEnvId, b = S.envBlend;
  if (prev && prev !== cur && b < 1 && isPremium(prev)) {
    drawEnv(prev, c, S, w, h); // mjuk övertoning mellan världar
    c.save(); c.globalAlpha = b; drawEnv(cur, c, S, w, h); c.restore();
  } else {
    drawEnv(cur, c, S, w, h);
  }
}

/* ---------- markremsa (tydlig kollisionslinje, världens färger) ---------- */
function groundStrip(c, S, w, h, top, dark, dash) {
  const gy = h - S.groundH;
  c.fillStyle = linGrad(c, "ground." + top + "." + dark + "." + Math.round(w) + "x" + Math.round(h) + "." + Math.round(gy),
    0, gy, 0, h, [0, top, 1, dark || top]);
  c.fillRect(-30, gy, w + 60, S.groundH + 30);
  c.fillStyle = "rgba(0,0,0,0.3)";
  c.fillRect(-30, gy, w + 60, 2.5);
  c.fillStyle = dash || "rgba(255,255,255,0.35)";
  const off = S.camX % 64;
  for (let x = -off; x < w + 30; x += 64) c.fillRect(x, gy + 10, 30, 4);
}

/* ================= SKOG (forest-deep) ================= */
function envForest(c, S, w, h) {
  const L = layout("forest-deep", S, w, h);
  const gy = h - S.groundH;
  const sz = Math.round(w) + "x" + Math.round(h);
  // 1) himmel + sol
  c.fillStyle = linGrad(c, "forest.sky." + sz, 0, 0, 0, h, [0, "#8fd4e8", 0.5, "#cdeec9", 1, "#fdf6d8"]);
  c.fillRect(-30, -30, w + 60, h + 60);
  const sx = w * 0.22, sy = h * 0.16;
  c.fillStyle = radGrad(c, "forest.sun." + sz, sx, sy, 4, sx, sy, 120, [0, "rgba(255,252,220,0.9)", 1, "rgba(255,252,220,0)"]);
  c.fillRect(sx - 120, sy - 120, 240, 240);
  c.fillStyle = "#fffbe8";
  c.beginPath(); c.arc(sx, sy, 34, 0, TAU); c.fill();
  // solstrålar genom träden (långsamma, subtila)
  c.save();
  c.globalCompositeOperation = "lighter";
  c.globalAlpha = 0.07 + 0.02 * Math.sin(S.time * 0.5);
  c.fillStyle = "#fffbe8";
  for (let i = 0; i < 3; i++) {
    c.save();
    c.translate(sx, -20); c.rotate(0.42 + i * 0.16 + Math.sin(S.time * 0.1 + i) * 0.02);
    c.fillRect(0, 0, h * 1.3, 60 + i * 30);
    c.restore();
  }
  c.restore();
  // 2) fjärrberg + dis
  c.fillStyle = "#a9cfdd";
  c.beginPath(); c.moveTo(-30, gy);
  for (let x = -30; x <= w + 30; x += 14) {
    const wx = x + S.camX * 0.05;
    c.lineTo(x, gy - 190 - Math.abs(Math.sin(wx * 0.006)) * 130 - Math.abs(Math.sin(wx * 0.017 + 2)) * 40);
  }
  c.lineTo(w + 30, gy); c.closePath(); c.fill();
  const hz = c.createLinearGradient(0, gy - 330, 0, gy);
  hz.addColorStop(0, "rgba(255,255,255,0)"); hz.addColorStop(1, "rgba(255,255,255,0.25)");
  c.fillStyle = hz; c.fillRect(-30, gy - 330, w + 60, 330);
  // 3) bakre jättestammar
  for (const t of L.back) {
    const x = wrapX(t.x, S.camX, 0.14, w);
    if (x < -100 || x > w + 100) continue;
    c.fillStyle = "rgba(70,90,70,0.55)";
    const tw = t.wdt;
    c.fillRect(x - tw / 2, gy - t.hgt - 200, tw, t.hgt + 200);
    c.fillStyle = "rgba(46,90,60,0.6)";
    c.beginPath(); c.ellipse(x, gy - t.hgt - 190, tw * 1.6, 60 + t.v * 40, 0, 0, TAU); c.fill();
  }
  // 4) mitt: detaljerade träd + vattenfallsklippor
  for (const cf of L.cliffs) {
    const x = wrapX(cf.x, S.camX, 0.3, w);
    if (x < -120 || x > w + 120) continue;
    // klippa
    const rg = c.createLinearGradient(x, 0, x + cf.wdt, 0);
    rg.addColorStop(0, "#6b7683"); rg.addColorStop(0.5, "#9aa5b1"); rg.addColorStop(1, "#4d565f");
    c.fillStyle = rg;
    c.fillRect(x, 60, cf.wdt, gy - 60);
    c.fillStyle = "rgba(255,255,255,0.25)";
    c.fillRect(x + 4, 60, 5, gy - 60);
    // vattenfall (animerade strimmor)
    const fx = x + cf.wdt * 0.35, fw = cf.wdt * 0.3;
    const wg = c.createLinearGradient(0, 60, 0, gy);
    wg.addColorStop(0, "rgba(220,240,255,0.85)"); wg.addColorStop(1, "rgba(150,200,240,0.9)");
    c.fillStyle = wg;
    c.fillRect(fx, 60, fw, gy - 60);
    c.fillStyle = "rgba(255,255,255,0.7)";
    const fall = (S.time * 220) % 60;
    for (let y = 60 + fall - 60; y < gy; y += 60) c.fillRect(fx + 2, y, fw - 4, 16);
    // dimma vid basen
    c.globalAlpha = 0.5 + 0.15 * Math.sin(S.time * 2 + x);
    c.fillStyle = "#e8f4ff";
    c.beginPath(); c.ellipse(fx + fw / 2, gy - 8, fw, 12, 0, 0, TAU); c.fill();
    c.globalAlpha = 1;
    // grönska på klippkanten
    c.fillStyle = "#3f8f2f";
    c.beginPath(); c.ellipse(x + 8, 66, 16, 7, 0, 0, TAU);
    c.ellipse(x + cf.wdt - 8, 62, 18, 8, 0, 0, TAU); c.fill();
  }
  for (const t of L.mid) {
    const x = wrapX(t.x, S.camX, 0.32, w);
    if (x < -140 || x > w + 140) continue;
    const s = t.s, sway = Math.sin(S.time * 1.3 + t.x * 0.05) * 4 * s;
    const baseY = gy - 10;
    // stam
    const tg = c.createLinearGradient(x - 9 * s, 0, x + 9 * s, 0);
    tg.addColorStop(0, "#5d3d22"); tg.addColorStop(0.5, "#8a5f36"); tg.addColorStop(1, "#4a2f18");
    c.fillStyle = tg;
    const th = 150 * s;
    c.beginPath();
    c.moveTo(x - 9 * s, baseY); c.lineTo(x - 5 * s + sway * 0.4, baseY - th);
    c.lineTo(x + 5 * s + sway * 0.4, baseY - th); c.lineTo(x + 9 * s, baseY);
    c.closePath(); c.fill();
    // lianer
    c.strokeStyle = "rgba(60,140,60,0.8)"; c.lineWidth = 2.5; c.lineCap = "round";
    for (let vi = 0; vi < t.vines; vi++) {
      const vx = x - 20 * s + vi * (40 * s / Math.max(1, t.vines - 1)) + sway * 0.7;
      const vy0 = baseY - th * (0.55 + h1(vi, t.x) * 0.3);
      c.beginPath(); c.moveTo(vx, vy0);
      c.quadraticCurveTo(vx + Math.sin(S.time * 1.6 + vi * 2) * 8, vy0 + 34, vx + Math.sin(S.time * 1.1 + vi) * 5, vy0 + 62 * s);
      c.stroke();
      c.fillStyle = "#4fae4f";
      c.beginPath(); c.ellipse(vx + Math.sin(S.time * 1.1 + vi) * 5, vy0 + 62 * s, 4, 6, 0.4, 0, TAU); c.fill();
    }
    // krona i tre lager (djupskuggning)
    const cy = baseY - th;
    const layers = [["#2e7d3a", 0, 64 * s], ["#3fa34d", -26 * s, 52 * s], ["#63c76a", -48 * s, 40 * s]];
    for (const [col, dy, r] of layers) {
      c.fillStyle = col;
      c.beginPath();
      c.ellipse(x + sway - r * 0.5, cy + dy, r * 0.75, r * 0.55, 0, 0, TAU);
      c.ellipse(x + sway + r * 0.5, cy + dy + 4, r * 0.7, r * 0.5, 0, 0, TAU);
      c.ellipse(x + sway, cy + dy - r * 0.4, r * 0.8, r * 0.6, 0, 0, TAU);
      c.fill();
    }
    c.fillStyle = "rgba(255,255,220,0.35)";
    c.beginPath(); c.ellipse(x + sway - 12 * s, cy - 52 * s, 16 * s, 9 * s, -0.4, 0, TAU); c.fill();
  }
  // löv + fjärilar (levande luft)
  for (const lf of L.leaves) {
    const y = ((lf.off + S.time * lf.sp) % (h + 60)) - 30;
    const x = wrapX(lf.bx + Math.sin(S.time * 1.2 + lf.ph) * 36, S.camX, 0.4, w);
    c.save(); c.translate(x, y); c.rotate(S.time * 2 + lf.ph);
    c.fillStyle = lf.autumn ? "rgba(230,140,50,0.9)" : "rgba(110,190,90,0.9)";
    c.beginPath(); c.ellipse(0, 0, lf.s, lf.s * 0.55, 0, 0, TAU); c.fill();
    c.restore();
  }
  for (const f of L.flies) {
    const x = f.cx + Math.sin(S.time * f.sp + f.ph) * f.ax - S.camX * 0.3 % 60;
    const y = f.cy + Math.cos(S.time * f.sp * 1.3 + f.ph) * f.ay;
    const flap = Math.abs(Math.sin(S.time * 16 + f.ph)) * 0.9 + 0.1;
    c.save(); c.translate(x, y);
    c.fillStyle = f.col;
    c.beginPath(); c.ellipse(-3, 0, 4, 2.4 * flap + 0.6, -0.4, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(3, 0, 4, 2.4 * flap + 0.6, 0.4, 0, TAU); c.fill();
    c.fillStyle = "#2b2118";
    c.beginPath(); c.ellipse(0, 0, 1.6, 3, 0, 0, TAU); c.fill();
    c.restore();
  }
  // mark: mossremsa
  groundStrip(c, S, w, h, "#5da33c", "#3f7a2a", "rgba(255,255,255,0.4)");
  c.fillStyle = "#3f8f2f";
  const off = S.camX % 90;
  for (let x = -off; x < w + 30; x += 90) {
    c.beginPath(); c.ellipse(x + h1(Math.round((x + S.camX) / 90), 5) * 60, gy - 6, 10, 5, 0, 0, TAU); c.fill();
  }
}

/* ================= STAD (city-neon) ================= */
function envCity(c, S, w, h) {
  const L = layout("city-neon", S, w, h);
  const gy = h - S.groundH;
  const sz = Math.round(w) + "x" + Math.round(h);
  // 1) natthimmel + stjärnor + måne
  c.fillStyle = linGrad(c, "city.sky." + sz, 0, 0, 0, h, [0, "#060818", 0.45, "#1a1240", 0.75, "#47235c", 1, "#8a3f5a"]);
  c.fillRect(-30, -30, w + 60, h + 60);
  for (const st of L.stars) {
    const tw = 0.35 + 0.65 * Math.abs(Math.sin(S.time * 1.6 + st.ph));
    c.globalAlpha = tw * 0.85; c.fillStyle = "#fff";
    c.fillRect(st.x, st.y, st.s, st.s);
  }
  c.globalAlpha = 1;
  const mx = w * 0.8, my = h * 0.14;
  c.fillStyle = radGrad(c, "city.moon." + sz, mx, my, 4, mx, my, 90, [0, "rgba(255,244,200,0.5)", 1, "rgba(255,244,200,0)"]);
  c.fillRect(mx - 90, my - 90, 180, 180);
  c.fillStyle = "#fdf3cf";
  c.beginPath(); c.arc(mx, my, 26, 0, TAU); c.fill();
  c.fillStyle = "rgba(200,180,160,0.5)";
  c.beginPath(); c.arc(mx - 8, my - 4, 5, 0, TAU); c.arc(mx + 7, my + 6, 3.5, 0, TAU); c.fill();
  // 2) bortre skyline (fönster som tänds, blinkande master)
  for (const b of L.far) {
    const x = wrapX(b.x, S.camX, 0.05, w);
    if (x < -140 || x > w + 140) continue;
    const top = gy - 40 - b.hgt;
    c.fillStyle = "#241b3d";
    c.fillRect(x, top, b.wdt, b.hgt + 40);
    // fönsterraster (var 3:e rad tänds deterministiskt)
    for (let wy = top + 10; wy < gy - 50; wy += 14) {
      for (let wx = x + 6; wx < x + b.wdt - 6; wx += 12) {
        const lit = h1(Math.round(wx * 3 + wy * 7), 3);
        if (lit < 0.4) {
          const flick = lit < 0.06 ? (0.4 + 0.6 * Math.abs(Math.sin(S.time * 3 + wx))) : 1;
          c.globalAlpha = flick;
          c.fillStyle = lit < 0.2 ? "#9be8ff" : "#ffd97a";
          c.fillRect(wx, wy, 5, 7);
        }
      }
    }
    c.globalAlpha = 1;
    // blinkande mast
    if (b.wins > 0.6) {
      const on = Math.sin(S.time * 2.4 + x) > 0;
      glowDot(c, x + b.wdt / 2, top - 6, 3, on ? "#ff5b5b" : "#7a2020", on ? "#fff" : "#7a2020", 1);
    }
  }
  // moln mellan husen
  c.fillStyle = "rgba(180,150,200,0.13)";
  for (let i = 0; i < 3; i++) {
    const cxp = wrapX(h1(i, 77) * (w + 400) + S.time * 6, 0, 0, w);
    const cyp = h * (0.2 + i * 0.13);
    c.beginPath();
    c.ellipse(cxp, cyp, 90, 22, 0, 0, TAU);
    c.ellipse(cxp - 60, cyp + 6, 50, 16, 0, 0, TAU);
    c.ellipse(cxp + 60, cyp + 6, 54, 17, 0, 0, TAU);
    c.fill();
  }
  // 3) närmre torn (neonkanter, billboards)
  for (const b of L.back) {
    const x = wrapX(b.x, S.camX, 0.12, w);
    if (x < -160 || x > w + 160) continue;
    const top = gy - 60 - b.hgt;
    const bg = c.createLinearGradient(x, 0, x + b.wdt, 0);
    bg.addColorStop(0, "#241c48"); bg.addColorStop(0.5, "#3a2c66"); bg.addColorStop(1, "#1a1430");
    c.fillStyle = bg;
    c.fillRect(x, top, b.wdt, b.hgt + 60);
    if (b.neon) { // neonkant på taket
      c.fillStyle = "rgba(0,255,255,0.9)";
      c.fillRect(x, top, b.wdt, 3);
      glowDot(c, x + 6, top + 2, 2, "#00ffff", "#fff", 0.8);
      glowDot(c, x + b.wdt - 6, top + 2, 2, "#ff4fd8", "#fff", 0.8);
    } else {
      c.fillStyle = "rgba(255,120,90,0.85)";
      c.fillRect(x, top, b.wdt, 3);
    }
    // fönster (glesare = billigare)
    for (let wy = top + 14; wy < gy - 70; wy += 22) {
      for (let wx = x + 8; wx < x + b.wdt - 8; wx += 20) {
        const lit = h1(Math.round(wx * 3 + wy * 7), 9);
        if (lit < 0.42) {
          c.globalAlpha = lit < 0.05 ? (0.4 + 0.6 * Math.abs(Math.sin(S.time * 3 + wx))) : 0.95;
          c.fillStyle = lit < 0.2 ? "#9be8ff" : "#ffd97a";
          c.fillRect(wx, wy, 8, 11);
        }
      }
    }
    c.globalAlpha = 1;
    if (b.bill) { // animerad reklamskylt
      const hue = (S.time * 40 + x) % 360;
      c.fillStyle = "hsl(" + hue + ",85%,55%)";
      rr(c, x + 10, top + 40, b.wdt - 20, 30, 6); c.fill();
      c.fillStyle = "#2b2118";
      c.fillRect(x + 10, top + 70, 6, 24); c.fillRect(x + b.wdt - 16, top + 70, 6, 24);
      c.fillStyle = "#fff";
      c.font = "900 13px sans-serif"; c.textAlign = "center";
      c.fillText("★ FLYG ★", x + b.wdt / 2, top + 60);
    }
  }
  // 4) mitt: hustak + bro med tåg + trafikljusspår
  const laneA = gy - 130, laneB = gy - 96;
  // trafik (ljusspår som rör sig)
  for (const cr of L.carsA) {
    const x = wrapX(cr.off + S.time * cr.sp, 0, 0, w);
    glowDot(c, x, laneA, 2.6, "#ffe9a8", "#fff", 0.9);
  }
  for (const cr of L.carsB) {
    const x = wrapX(cr.off - S.time * cr.sp, 0, 0, w);
    glowDot(c, x, laneB, 2.6, "#ff5b5b", "#fff", 0.9);
  }
  // hustakssilhuetter
  c.fillStyle = "#150f28";
  for (let i = 0; i < 8; i++) {
    const x = wrapX(h1(i, 51) * (w + 400), S.camX, 0.22, w);
    const rw = 50 + h1(i, 52) * 60, rh = 26 + h1(i, 53) * 30;
    c.fillRect(x, gy - 60 - rh, rw, rh + 60);
    // vattentorn / antenn på vissa tak
    if (h1(i, 54) > 0.5) {
      c.fillRect(x + rw / 2 - 8, gy - 60 - rh - 26, 16, 26);
      c.beginPath(); c.moveTo(x + rw / 2 - 11, gy - 60 - rh - 26);
      c.lineTo(x + rw / 2 + 11, gy - 60 - rh - 26);
      c.lineTo(x + rw / 2, gy - 60 - rh - 38); c.closePath(); c.fill();
    } else {
      c.fillRect(x + rw / 2 - 1, gy - 60 - rh - 30, 2, 30);
      const on = Math.sin(S.time * 2 + x) > 0;
      glowDot(c, x + rw / 2, gy - 60 - rh - 32, 2.4, on ? "#ff5b5b" : "#5a1515", on ? "#fff" : "#5a1515", 1);
    }
  }
  // bro + tåg (periodiskt, deterministiskt)
  const bridgeY = gy - 170;
  c.fillStyle = "#0f0b1e";
  c.fillRect(-30, bridgeY, w + 60, 10);
  c.fillStyle = "#241b3d";
  for (let x = -20; x < w + 20; x += 120) c.fillRect(x, bridgeY + 10, 12, gy - bridgeY);
  const tcyc = 16, tt = S.time % tcyc;
  if (tt < 5) {
    const tx = w + 100 - (tt / 5) * (w + 500);
    c.fillStyle = "#2c2348";
    for (let k = 0; k < 4; k++) {
      c.fillRect(tx - k * 62, bridgeY - 30, 56, 30);
      c.fillStyle = "#ffe9a8";
      for (let wx = tx - k * 62 + 6; wx < tx - k * 62 + 50; wx += 12) c.fillRect(wx, bridgeY - 22, 7, 10);
      c.fillStyle = "#2c2348";
    }
    glowDot(c, tx + 6, bridgeY - 14, 3, "#ff5b5b", "#fff", 1); // frontljus
  }
  // flygplan + helikopter (periodiska passager)
  const pcyc = 26, pt = S.time % pcyc;
  if (pt < 9) {
    const px = w + 60 - (pt / 9) * (w + 300), py = h * 0.12 + Math.sin(S.time) * 6;
    c.fillStyle = "rgba(10,8,20,0.9)";
    c.beginPath(); c.ellipse(px, py, 26, 6, 0, 0, TAU); c.fill();
    c.fillRect(px - 4, py - 14, 8, 14);
    if (Math.sin(S.time * 9) > 0) glowDot(c, px - 26, py, 2.4, "#fff", "#fff", 1);
  }
  const hcyc = 31, ht = (S.time + 13) % hcyc;
  if (ht < 7) {
    const hx = -60 + (ht / 7) * (w + 300), hy = h * 0.3;
    c.fillStyle = "rgba(10,8,20,0.9)";
    c.beginPath(); c.ellipse(hx, hy, 14, 6, 0, 0, TAU); c.fill();
    c.strokeStyle = "rgba(200,200,220,0.7)"; c.lineWidth = 2;
    const ra = S.time * 30;
    c.beginPath();
    c.moveTo(hx + Math.cos(ra) * 22, hy - 8); c.lineTo(hx - Math.cos(ra) * 22, hy - 8);
    c.stroke();
    if (Math.sin(S.time * 7) > 0) glowDot(c, hx, hy + 6, 2, "#ff5b5b", "#fff", 1);
  }
  // gatmark: asfalt med neonstreck
  groundStrip(c, S, w, h, "#23233a", "#12121f", "rgba(0,255,255,0.5)");
  // förgrund: mörk taklist nederst (under kollisionslinjen)
  c.fillStyle = "rgba(8,6,16,0.92)";
  const poff = S.camX * 0.9 % 220;
  for (let x = -poff; x < w + 40; x += 220) c.fillRect(x, gy + 26, 130, h);
}

/* ================= RYMD (space-deep) ================= */
function envSpace(c, S, w, h) {
  const L = layout("space-deep", S, w, h);
  const gy = h - S.groundH;
  const sz = Math.round(w) + "x" + Math.round(h);
  // 1) djuprymd + nebulosor (långsamt drivande)
  c.fillStyle = linGrad(c, "space.sky." + sz, 0, 0, 0, h, [0, "#020208", 0.55, "#0b1030", 1, "#1c1440"]);
  c.fillRect(-30, -30, w + 60, h + 60);
  const nebs = [
    [0.25, 0.3, 150, "194,79,158"], [0.75, 0.55, 180, "30,144,255"],
    [0.5, 0.8, 130, "122,77,232"], [0.9, 0.2, 110, "30,200,190"]
  ];
  for (let i = 0; i < nebs.length; i++) {
    const nx = nebs[i][0] * w + Math.sin(S.time * 0.07 + i * 2) * 24;
    const ny = nebs[i][1] * h + Math.cos(S.time * 0.06 + i) * 18;
    const nr = nebs[i][2];
    const ng = c.createRadialGradient(nx, ny, 4, nx, ny, nr);
    ng.addColorStop(0, "rgba(" + nebs[i][3] + ",0.34)"); ng.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = ng;
    c.fillRect(nx - nr, ny - nr, nr * 2, nr * 2);
  }
  // avlägsen galax
  c.save();
  c.translate(w * 0.2, h * 0.28); c.rotate(-0.4 + Math.sin(S.time * 0.05) * 0.03);
  c.globalAlpha = 0.5; c.strokeStyle = "#bfa8ff"; c.lineWidth = 3;
  for (let i = 1; i <= 3; i++) {
    c.globalAlpha = 0.5 - i * 0.12;
    c.beginPath(); c.ellipse(0, 0, i * 22, i * 9, 0, 0, TAU); c.stroke();
  }
  c.globalAlpha = 0.9; c.fillStyle = "#fff";
  c.beginPath(); c.arc(0, 0, 5, 0, TAU); c.fill();
  c.restore(); c.globalAlpha = 1;
  // 2) stjärnor i två djup
  for (const st of L.starsF) {
    const x = wrapX(st.x, S.camX, 0.02, w);
    const tw = 0.3 + 0.7 * Math.abs(Math.sin(S.time * 1.4 + st.ph));
    c.globalAlpha = tw; c.fillStyle = "#cfe0ff";
    c.fillRect(x, st.y, st.s, st.s);
  }
  for (const st of L.starsN) {
    const x = wrapX(st.x, S.camX, 0.06, w);
    const tw = 0.35 + 0.65 * Math.abs(Math.sin(S.time * 2 + st.ph));
    c.globalAlpha = tw; c.fillStyle = "#fff";
    c.fillRect(x, st.y, st.s, st.s);
    if (st.cross) {
      c.globalAlpha = tw * 0.5;
      c.fillRect(x - st.s * 2, st.y + st.s / 2 - 0.5, st.s * 4, 1);
      c.fillRect(x + st.s / 2 - 0.5, st.y - st.s * 2, 1, st.s * 4);
    }
  }
  c.globalAlpha = 1;
  // stjärnfall (periodiskt)
  const scyc = 8, stt = S.time % scyc;
  if (stt < 1.1) {
    const k = stt / 1.1;
    const hx0 = w * 0.85 - k * w * 0.5, hy0 = h * 0.05 + k * h * 0.25;
    const tg = c.createLinearGradient(hx0, hy0, hx0 + 70, hy0 - 35);
    tg.addColorStop(0, "rgba(255,255,255,0.9)"); tg.addColorStop(1, "rgba(255,255,255,0)");
    c.strokeStyle = tg; c.lineWidth = 2.5; c.lineCap = "round";
    c.beginPath(); c.moveTo(hx0, hy0); c.lineTo(hx0 + 70, hy0 - 35); c.stroke();
  }
  // 3) ringplanet + måne (långsamt skimrande)
  const px = w * 0.72 - S.camX * 0.04 % 60, py = h * 0.3;
  const pr = Math.min(w, h) * 0.11;
  const pg = c.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.2, px, py, pr * 1.4);
  pg.addColorStop(0, "#ffb37a"); pg.addColorStop(0.55, "#e8768a"); pg.addColorStop(1, "#5a2a6a");
  c.fillStyle = pg;
  c.beginPath(); c.arc(px, py, pr, 0, TAU); c.fill();
  c.globalAlpha = 0.25 + 0.1 * Math.sin(S.time * 0.8); // band
  c.fillStyle = "#fff";
  c.fillRect(px - pr, py - pr * 0.3, pr * 2, pr * 0.12);
  c.fillRect(px - pr, py + pr * 0.25, pr * 2, pr * 0.1);
  c.globalAlpha = 1;
  c.save(); // ringar
  c.translate(px, py); c.rotate(-0.35);
  c.strokeStyle = "rgba(220,200,255,0.75)"; c.lineWidth = 5;
  c.beginPath(); c.ellipse(0, 0, pr * 1.7, pr * 0.5, 0, 0, TAU); c.stroke();
  c.strokeStyle = "rgba(220,200,255,0.35)"; c.lineWidth = 9;
  c.beginPath(); c.ellipse(0, 0, pr * 2, pr * 0.62, 0, 0, TAU); c.stroke();
  c.restore();
  const mox = px - pr * 2.4, moy = py + pr * 1.2;
  c.fillStyle = "#c8cfd8";
  c.beginPath(); c.arc(mox, moy, pr * 0.28, 0, TAU); c.fill();
  c.fillStyle = "rgba(120,130,150,0.6)";
  c.beginPath(); c.arc(mox - 3, moy - 2, 3, 0, TAU); c.arc(mox + 4, moy + 3, 2.2, 0, TAU); c.fill();
  // 4) asteroidfält (tumlande, parallax)
  for (const r of L.rocks) {
    const x = wrapX(r.x - S.time * r.drift, S.camX, 0.2, w);
    if (x < -80 || x > w + 80) continue;
    c.save(); c.translate(x, r.y); c.rotate(S.time * r.rs + r.ph);
    const rg = c.createRadialGradient(-r.r * 0.3, -r.r * 0.3, 2, 0, 0, r.r * 1.2);
    rg.addColorStop(0, "#9aa2ae"); rg.addColorStop(1, "#4a505c");
    c.fillStyle = rg;
    c.beginPath();
    for (let k = 0; k < r.verts.length; k++) {
      const a = (k / r.verts.length) * TAU, rad = r.r * r.verts[k];
      k === 0 ? c.moveTo(Math.cos(a) * rad, Math.sin(a) * rad) : c.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    c.closePath(); c.fill();
    c.strokeStyle = "#20242c"; c.lineWidth = 2; c.stroke();
    c.fillStyle = "rgba(30,34,44,0.6)";
    c.beginPath(); c.arc(-r.r * 0.2, 0, r.r * 0.22, 0, TAU); c.arc(r.r * 0.25, -r.r * 0.2, r.r * 0.15, 0, TAU); c.fill();
    c.restore();
  }
  // rymdskepp + station (periodiska passager)
  const vcyc = 20, vt = S.time % vcyc;
  if (vt < 6) {
    const vx = -60 + (vt / 6) * (w + 200), vy = h * 0.18;
    c.fillStyle = "rgba(200,210,230,0.9)";
    c.beginPath(); c.moveTo(vx - 12, vy); c.lineTo(vx + 10, vy - 4); c.lineTo(vx + 10, vy + 4); c.closePath(); c.fill();
    if (Math.sin(S.time * 10) > 0) glowDot(c, vx + 10, vy, 2, "#7df9ff", "#fff", 1);
  }
  const qcyc = 47, qt = (S.time + 20) % qcyc;
  if (qt < 9) {
    const qx = w + 80 - (qt / 9) * (w + 260), qy = h * 0.62;
    c.fillStyle = "rgba(150,160,190,0.85)";
    c.fillRect(qx - 8, qy - 8, 16, 16);
    c.fillStyle = "rgba(60,120,220,0.8)";
    c.fillRect(qx - 34, qy - 5, 26, 10); c.fillRect(qx + 8, qy - 5, 26, 10);
    if (Math.sin(S.time * 6) > 0) glowDot(c, qx, qy - 10, 2, "#ff5b5b", "#fff", 1);
  }
  // energihorisont (tydlig "mark" i rymden)
  groundStrip(c, S, w, h, "#23234d", "#0a0a22", "rgba(125,249,255,0.55)");
  c.save();
  c.globalAlpha = 0.6 + 0.25 * Math.sin(S.time * 2);
  c.fillStyle = "#7df9ff";
  c.fillRect(-30, gy - 3, w + 60, 3);
  c.restore();
}

/* ============================================================
   FÖRGRUND — nära kameran, aldrig över spelbandet
   (täckning endast i ytterkanter + under marklinjen)
   ============================================================ */
function drawForeground(c, S, w, h) {
  const id = S.envId;
  if (id === "forest-deep") {
    // mörka löv i överkantens hörn (långsam svaj)
    c.fillStyle = "rgba(20,50,26,0.88)";
    for (const [bx, dir] of [[-20, 1], [w + 20, -1]]) {
      const sway = Math.sin(S.time * 0.9 + bx) * 8;
      c.beginPath();
      c.ellipse(bx, 30 + sway, 90, 44, dir * 0.25, 0, TAU);
      c.ellipse(bx + dir * 70, 70 + sway, 60, 30, dir * -0.2, 0, TAU);
      c.fill();
    }
    c.fillStyle = "rgba(46,125,58,0.9)";
    c.beginPath();
    c.ellipse(-10, 66, 34, 14, 0.3, 0, TAU); c.ellipse(w + 10, 60, 38, 15, -0.3, 0, TAU);
    c.fill();
  } else if (id === "city-neon") {
    // vinjettstaplar i kanterna (mörka husknutar som susar förbi)
    c.fillStyle = "rgba(8,6,16,0.9)";
    const off = S.camX * 0.85 % 340;
    for (let x = -off; x < w + 60; x += 340) {
      c.fillRect(x, -30, 26, h * 0.22);
      c.fillRect(x + 260, h * 0.7, 30, h);
    }
    c.fillStyle = "rgba(0,255,255,0.5)";
    const off2 = S.camX * 0.85 % 340;
    for (let x = -off2; x < w + 60; x += 340) {
      c.fillRect(x, 0, 26, 3);
    }
  } else if (id === "space-deep") {
    // snabba stjärnstreck (fartkänsla, tunna = skymmer inget)
    c.strokeStyle = "rgba(255,255,255,0.28)"; c.lineWidth = 2; c.lineCap = "round";
    const L = layout("space-deep", S, w, h);
    c.beginPath();
    for (const st of L.streaks) {
      const x = wrapX(st.x - S.time * 60, S.camX, 0.7, w);
      c.moveTo(x, st.y); c.lineTo(x - 8, st.y - st.len * 0.4);
    }
    c.stroke();
  } else if (id === "lagoon-paradise") {
    // vajande palmblad i överkanterna (hörn, aldrig mitt)
    c.fillStyle = "rgba(20,90,60,0.88)";
    for (const [bx, dir] of [[-20, 1], [w + 20, -1]]) {
      const sway = Math.sin(S.time * 1.1 + bx) * 8;
      c.beginPath();
      c.ellipse(bx, 26 + sway, 80, 34, dir * 0.3, 0, TAU);
      c.ellipse(bx + dir * 60, 60 + sway, 52, 24, dir * -0.25, 0, TAU);
      c.fill();
    }
  } else if (id === "glacier-aurora" || id === "rimewake") {
    // frostram i kanterna (tunna, skymmer inget)
    c.fillStyle = "rgba(200,225,245,0.16)";
    for (const [bx, dir] of [[-14, 1], [w + 14, -1]]) {
      c.beginPath();
      c.ellipse(bx, h * 0.5, 26, h * 0.42, dir * 0.08, 0, TAU);
      c.fill();
    }
    c.fillStyle = "rgba(230,242,252,0.8)";
    const off = S.camX % 130;
    for (let x = -off; x < w + 40; x += 130) {
      c.beginPath(); c.ellipse(x + 40, h - S.groundH - 2, 16, 5, 0, 0, TAU); c.fill();
    }
  } else if (id === "valley-highlands") {
    // grästuvor i underkanterna (under spelbandet)
    c.strokeStyle = "rgba(30,90,40,0.5)"; c.lineWidth = 3; c.lineCap = "round";
    const off = (S.camX * 0.9) % 52;
    c.beginPath();
    for (let x = -off; x < w + 40; x += 52) {
      const hh = 12 + h1(Math.round((x + S.camX * 0.9) / 52), 3) * 14;
      const sway = Math.sin(S.time * 2.2 + x) * 2;
      c.moveTo(x, h + 4); c.quadraticCurveTo(x + 3 + sway, h - hh * 0.6, x + 8 + sway, h - hh);
    }
    c.stroke();
  } else if (id === "arcane-nebula") {
    // tunna ljusstrimmor i kanterna (fartkänsla, skymmer inget)
    c.strokeStyle = "rgba(180,127,232,0.25)"; c.lineWidth = 2; c.lineCap = "round";
    const L = layout("arcane-nebula", S, w, h);
    c.beginPath();
    for (const st of L.streams) {
      if (st.x % 3 > 1) continue;
      const x = wrapX(st.x - S.time * 40, S.camX, 0.7, w);
      c.moveTo(x, st.y); c.lineTo(x - 7, st.y - 14);
    }
    c.stroke();
  }
}

/* A2 (P1-2): översta himmelsfärgen per premiummiljö (stopp 0 i respektive sky-gradient) —
   används för att fortsätta himlen ovanför den logiska planen på höga skärmar. */
const SKY_TOP = { "lagoon-paradise": "#3ec6e8", "glacier-aurora": "#0a1030", "rimewake": "#061a22", "valley-highlands": "#4fa8e8",
  "arcane-nebula": "#080418", "forest-deep": "#8fd4e8", "city-neon": "#060818", "space-deep": "#020208" };
function skyTop(envId) { return SKY_TOP[envId] || null; }
window.Worlds = { selectEnv, isPremium, drawBackground, drawForeground, VARIANTS, skyTop,
  SHOWCASE, showcaseFor, showcaseLevel, thumbnail };
})();
