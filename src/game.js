/* ============================================================
   DIPWING — src/game.js
   Nivå 1 (Sommaräng) fullt spelbar + skalbar grund för 21+ nivåer.

   Arkitektur:
   - LOGIK: state machine MENU/READY/PLAYING/DYING/GAMEOVER/CLEAR/PAUSED
   - NIVÅER: levelConfig(n) — hastighet, gap, spacing, mål, rörliga hinder
   - VÄRLDAR: WORLDS{} — palett + dekoration + ambient per miljö
   - FYSIK: delta-tid, responsiv flap, rättvis (förlåtande) kollision
   ============================================================ */
(function () {
"use strict";

/* ---------- helpers ---------- */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function rand(a, b) { return a + Math.random() * (b - a); }

/* ---------- tuning (från main.pjs, med fallback) ---------- */
function readTuning() {
  const d = { gravity: 1500, flapVelocity: -440, maxFallSpeed: 640, birdXfrac: 0.32,
              speed: 155, gap: 205, spacing: 350, target: 10 };
  // Gate C: noll är ett giltigt värde (|| hade svalt det) — endast null/NaN faller tillbaka.
  const num = (v, fb) => { if (v == null) return fb; const n = Number(v); return Number.isFinite(n) ? n : fb; };
  try {
    const r = window.root;
    if (r && r.tuning) {
      d.gravity = num(r.tuning.gravity, d.gravity);
      d.flapVelocity = num(r.tuning.flapVelocity, d.flapVelocity);
      d.maxFallSpeed = num(r.tuning.maxFallSpeed, d.maxFallSpeed);
      d.birdXfrac = num(r.tuning.birdX, d.birdXfrac);
    }
    if (r && r.level1) {
      d.speed = num(r.level1.speed, d.speed);
      d.gap = num(r.level1.gap, d.gap);
      d.spacing = num(r.level1.spacing, d.spacing);
      d.target = num(r.level1.target, d.target);
    }
  } catch (e) { /* fallback gäller */ }
  return d;
}
const TUNE = readTuning();

/* ============================================================
   NIVÅSYSTEM — varje nivå har egna inställningar.
   L1–3: lugn bas. 4–5: smalare + snabbare. 6–10: varierat
   avstånd + ramp. 11–20: rörliga hinder. 21+: puls + vindkänsla.
   ============================================================ */
/* A5: sekunder mellan hinder vid basfart. L1 = TUNE.spacing/TUNE.speed (350/155 ≈ 2,26 s).
   L2 2,15 s → L20 1,16 s (−0,055 s/nivå) → L40 1,00 s (−0,008 s/nivå), golv 1,0 s.
   Minsta fönster vid maxfart garanteras separat av Director (MIN_REACT / MIN_REACT_TIMING). */
function spacingSeconds(level) {
  if (level <= 20) return 2.15 - 0.055 * (level - 2);
  return Math.max(1.0, 1.16 - 0.008 * (level - 20));
}
function levelConfig(level) {
  level = Math.max(1, Math.floor(level));
  if (level === 1) {
    return { level, speed: TUNE.speed, gap: TUNE.gap, spacing: TUNE.spacing,
      target: TUNE.target, maxJump: 165, oscAmp: 0, oscSpeed: 0, pulse: 0,
      ramp: 0, spacingVar: 0, twinCh: 0, world: worldForLevel(1) };
  }
  const post = Math.max(0, level - 21); // Gate D: mjuk fortsättning efter 21 (ingen platå)
  const speed = Math.min(380, 158 + level * 7 + (level > 10 ? (level - 10) * 5 : 0) + post * 3);
  const gap = Math.max(105, 208 - (level - 1) * 5 - post * 1.5);
  // A5 (P1-1): avståndet definieras som TID mellan hinder vid nivåns basfart (sekunder) och
  // gäller nu på riktigt (tidigare spawnade spelet först vid maxSpacing ⇒ 2–3 s glest överallt).
  const spacing = Math.round(speed * spacingSeconds(level));
  const target = Math.min(30, 10 + Math.floor((level - 1) * 1.5));
  const maxJump = Math.min(330, 175 + level * 6 + post * 2);
  const oscAmp = level >= 11 ? Math.min(110, 30 + (level - 11) * 9) : 0;
  const oscSpeed = level >= 11 ? 1.1 + Math.min(1.6, (level - 11) * 0.12) : 0;
  const pulse = level >= 21 ? Math.min(26, 10 + (level - 21) * 2) : 0;
  const ramp = level >= 6 ? 0.15 : 0;                       // fartökning inom nivån
  const spacingVar = level >= 6 ? Math.min(90, 20 + (level - 6) * 6) : 0; // varierat avstånd
  // A7 (P1-4): tvillingchansen används nu på alla nivåer ≥2 (förut död kod efter L10) och växer
  // efter L21 (0,10 → 0,195 vid L40, tak 0,20) så L23–40 inte blir en platå.
  const twinCh = (level >= 2 && level <= 10) ? 0.22 : (level >= 21 ? Math.min(0.20, 0.10 + (level - 21) * 0.005) : 0.08);
  return { level, speed, gap, spacing, target, maxJump, oscAmp, oscSpeed, pulse, ramp, spacingVar, twinCh, world: worldForLevel(level) };
}

function worldForLevel(level) {
  if (level <= 3) return "meadow";
  if (level <= 5) return "tropic";
  if (level <= 10) return "sunset";
  if (level <= 20) return "winter";
  return "magic";
}

/* Världsinfo — namn/taggar via I18N (sv identiska med tidigare strängar).
   Getters: all befintlig kod (wi.name/wi.tag) blir lokaliserad utan ändring. */
const WORLD_INFO = {
  meadow: { get name() { return I18N.worldName("meadow"); }, icon: "🌿", get tag() { return I18N.worldTag("meadow"); } },
  tropic: { get name() { return I18N.worldName("tropic"); }, icon: "🌺", get tag() { return I18N.worldTag("tropic"); } },
  sunset: { get name() { return I18N.worldName("sunset"); }, icon: "🌅", get tag() { return I18N.worldTag("sunset"); } },
  winter: { get name() { return I18N.worldName("winter"); }, icon: "❄️", get tag() { return I18N.worldTag("winter"); } },
  magic:  { get name() { return I18N.worldName("magic"); }, icon: "✨", get tag() { return I18N.worldTag("magic"); } }
};

/* ============================================================
   PROGRESSION — äventyrsresa över världar (enbart UI/sparande).
   Sanningen förblir worldForLevel() ovan: WORLD_ORDER är en VY
   över den (start/slut per värld), ingen konkurrerande regel.
   Rör ALDRIG fysik/RNG/hinder/svårighet.
   Framtidskrokar (EJ implementerat): SPECIAL_WORLDS (daily,
   bonus, secret, tidsbegränsade) + world-specifika belöningar
   kan läggas till här utan att röra kärnlogiken.
   ============================================================ */
const WORLD_ORDER = [
  { id: "meadow", start: 1, end: 3 },
  { id: "tropic", start: 4, end: 5 },
  { id: "sunset", start: 6, end: 10 },
  { id: "winter", start: 11, end: 20 },
  { id: "magic",  start: 21, end: Infinity } // oändlig — ingen world-final
];
// const SPECIAL_WORLDS = []; // framtid: {id, type:'daily'|'bonus'|'secret', ...} (ej implementerat)
const Progress = {
  order: WORLD_ORDER,
  worldDefForLevel(level) {
    for (const d of WORLD_ORDER) if (level >= d.start && level <= d.end) return d;
    return WORLD_ORDER[WORLD_ORDER.length - 1];
  },
  worldIndexForId(id) { return WORLD_ORDER.findIndex(d => d.id === id); },
  isWorldFinal(level) {
    const d = this.worldDefForLevel(level);
    return Number.isFinite(d.end) && level === d.end;
  },
  nextWorldAfter(level) {
    const i = this.worldIndexForId(this.worldDefForLevel(level).id);
    return WORLD_ORDER[i + 1] || null;
  },
  // 'done' | 'current' (+isNew vid färsk upplåsning) | 'next' | 'locked' (endless magic blir aldrig done)
  worldStatus(def, mode) {
    const un = store.unlocked;
    if (Number.isFinite(def.end) && un > def.end) return { key: "done" };
    if (un >= def.start) return { key: "current", isNew: un === def.start && def.start > 1 };
    const prevIdx = this.worldIndexForId(def.id) - 1;
    const prev = WORLD_ORDER[prevIdx];
    const isNext = prev && Number.isFinite(prev.end) && un > prev.end && un < def.start;
    void mode;
    return { key: isNext ? "next" : "locked" };
  },
  worldProgress(def, mode) {
    if (!Number.isFinite(def.end)) return { done: 0, total: Infinity, endless: true };
    let done = 0;
    for (let l = def.start; l <= def.end; l++) {
      if (store.isCleared(mode, l) || store.bestFor(mode, l) >= levelConfig(l).target) done++;
    }
    return { done, total: def.end - def.start + 1, endless: false };
  },
  levelState(level, mode) {
    if (level > store.unlocked) return "locked";
    if (store.isCleared(mode, level) || store.bestFor(mode, level) >= levelConfig(level).target) return "done";
    return "open";
  },
  /* Endless-milstolpar: Magi (21+ ∞) har ingen world-final. Var 10:e nivå
     från 30 firas som milstolpe — samma progression, extra erkännande. */
  isMilestone(level) {
    return worldForLevel(level) === "magic" && level >= 30 && level % 10 === 0;
  }
};
function worldArtStyle(worldKey) {
  try {
    const sky = WORLDS[worldKey].sky;
    return "background:linear-gradient(180deg," + sky.join(",") + ");";
  } catch (e) { return "background:linear-gradient(180deg,#5fb4ef,#e8f9e8);"; }
}
function validateProgressMapping() {
  // varnar (kraschar aldrig) om WORLD_ORDER glider isär från worldForLevel
  for (const d of WORLD_ORDER) {
    if (worldForLevel(d.start) !== d.id) console.warn("[progress] start mismatch", d.id, d.start);
    if (Number.isFinite(d.end) && worldForLevel(d.end) !== d.id) console.warn("[progress] end mismatch", d.id, d.end);
  }
}

/* Världspaletter — allt som ritas läser härifrån (skalbart per nivå) */
const WORLDS = {
  meadow: {
    sky: ["#5fb4ef", "#a5ddf9", "#e8f9e8", "#fef9e2"],
    sun: { x: 0.78, y: 0.18, r: 42, core: "#fffbe8", glow: "rgba(255,244,180,0.55)" },
    farMount: "#a9c3e2", nearMount: "#7fa3cf", mountSnow: null,
    hillBack: "#8fd45e", hillFront: "#5da93c", hillShade: "#4a8f31",
    tree: "round", ground: "#7ed957", groundDark: "#5cab3e", dirt: "#d9a066", dirtDark: "#b57e48",
    cloud: "#ffffff", cloudShade: "#dceefb",
    pipe: ["#3f9e4d", "#6fce7e", "#b8f0c0"], pipeEdge: "#2b6b35", capLight: "rgba(255,255,255,0.35)",
    ambient: "pollen", night: 0
  },
  tropic: {
    sky: ["#2fb9e6", "#7fe7d2", "#d8f7c9", "#fff6c9"],
    sun: { x: 0.22, y: 0.16, r: 46, core: "#ffffff", glow: "rgba(255,255,220,0.6)" },
    farMount: "#7cc4b2", nearMount: "#4da88f", mountSnow: null,
    hillBack: "#4fd18a", hillFront: "#2fa36b", hillShade: "#25855a",
    tree: "palm", ground: "#f2df9e", groundDark: "#dcc176", dirt: "#e8b96f", dirtDark: "#c08a45",
    cloud: "#ffffff", cloudShade: "#d8f4ec",
    pipe: ["#2f9e8f", "#54d1b8", "#b5f2e2"], pipeEdge: "#1f6b60", capLight: "rgba(255,255,255,0.4)",
    ambient: "petals", night: 0
  },
  sunset: {
    sky: ["#3b2d5e", "#8a3f6e", "#e86a5a", "#ff9a5a", "#ffd97a"],
    sun: { x: 0.5, y: 0.52, r: 58, core: "#ffe9a8", glow: "rgba(255,150,60,0.55)" },
    farMount: "#5c4470", nearMount: "#46325c", mountSnow: null,
    hillBack: "#6b4a68", hillFront: "#4a3350", hillShade: "#3a2740",
    tree: "silhouette", ground: "#6b4a3a", groundDark: "#4f3428", dirt: "#7a5642", dirtDark: "#54382a",
    cloud: "#ffc9a8", cloudShade: "#b06a8a",
    pipe: ["#8a4a8a", "#c47fc4", "#f2c4f2"], pipeEdge: "#5e2f5e", capLight: "rgba(255,220,170,0.5)",
    ambient: "fireflies", night: 0.25
  },
  winter: {
    sky: ["#8fb4dd", "#c4d9ef", "#eaf3fb", "#ffffff"],
    sun: { x: 0.76, y: 0.16, r: 38, core: "#ffffff", glow: "rgba(220,235,255,0.6)" },
    farMount: "#b9cde6", nearMount: "#93aecb", mountSnow: "#ffffff",
    hillBack: "#dfeaf5", hillFront: "#c2d6ea", hillShade: "#a9c2da",
    tree: "pine", ground: "#f4f8fc", groundDark: "#d4e3f2", dirt: "#b9c9dc", dirtDark: "#93a9c2",
    cloud: "#ffffff", cloudShade: "#d8e6f5",
    pipe: ["#4a90c4", "#7cc0ee", "#cfeaff"], pipeEdge: "#2f6085", capLight: "rgba(255,255,255,0.55)",
    ambient: "snow", night: 0
  },
  magic: {
    sky: ["#12082e", "#3a1a63", "#7a2f8f", "#c44f9e"],
    sun: { x: 0.5, y: 0.2, r: 40, core: "#e8fbff", glow: "rgba(125,249,255,0.4)" }, // måne
    farMount: "#3a2560", nearMount: "#2a1a4a", mountSnow: "#9df2ff",
    hillBack: "#4a3a8a", hillFront: "#352a6b", hillShade: "#241c4e",
    tree: "crystal", ground: "#5a4ab0", groundDark: "#423488", dirt: "#3a2c72", dirtDark: "#2a2056",
    cloud: "#8a7fd0", cloudShade: "#4a3f8a",
    pipe: ["#7a3fb0", "#b47fe8", "#ecd4ff"], pipeEdge: "#4e2472", capLight: "rgba(180,255,255,0.5)",
    ambient: "sparkle", night: 0.55
  }
};

/* ---------- lagring (A3: all åtkomst via SafeStorage — kastar aldrig) ---------- */
const store = {
  get unlocked() { return Number(SafeStorage.get("pfb_unlocked_v1") || 1) || 1; },
  set unlocked(v) { SafeStorage.set("pfb_unlocked_v1", String(v)); if (window.SaveV2) SaveV2.mirror(); },
  best(level) { try { const o = JSON.parse(SafeStorage.get("pfb_best_v1") || "{}"); return o[level] || 0; } catch (e) { return 0; } },
  setBest(level, s) {
    if (typeof S !== "undefined" && S.simMode) return false; // tester skriver aldrig till lagring
    try {
      const o = JSON.parse(SafeStorage.get("pfb_best_v1") || "{}");
      if (s > (o[level] || 0)) { o[level] = s; SafeStorage.set("pfb_best_v1", JSON.stringify(o)); if (window.SaveV2) SaveV2.mirror(); return true; }
    } catch (e) {}
    return false;
  },
  skyBest(level) { try { const o = JSON.parse(SafeStorage.get("pfb_best_sky_v1") || "{}"); return o[level] || 0; } catch (e) { return 0; } },
  skySetBest(level, s) {
    if (S.simMode) return false; // tester skriver aldrig till lagring
    try {
      const o = JSON.parse(SafeStorage.get("pfb_best_sky_v1") || "{}");
      if (s > (o[level] || 0)) { o[level] = s; SafeStorage.set("pfb_best_sky_v1", JSON.stringify(o)); if (window.SaveV2) SaveV2.mirror(); return true; }
    } catch (e) {}
    return false;
  },
  bestFor(mode, level) { return mode === "sky" ? this.skyBest(level) : this.best(level); },
  setBestFor(mode, level, s) { return mode === "sky" ? this.skySetBest(level, s) : this.setBest(level, s); },
  /* --- Gate D: endless-rekord + medaljer (SaveV2 är sanning, v1 är spegel) --- */
  endlessBest(mode) { try { return window.SaveV2 ? SaveV2.getEndlessBest(mode) : 0; } catch (e) { return 0; } },
  setEndlessBest(mode, s) {
    if (typeof S !== "undefined" && S.simMode) return false;
    try { return window.SaveV2 ? SaveV2.setEndlessBest(mode, s) : false; } catch (e) { return false; }
  },
  medal(mode, level) { try { return window.SaveV2 ? SaveV2.getMedal(mode, level) : 0; } catch (e) { return 0; } },
  setMedal(mode, level, stars) {
    if (typeof S !== "undefined" && S.simMode) return 0;
    try { return window.SaveV2 ? SaveV2.setMedal(mode, level, stars) : 0; } catch (e) { return 0; }
  },
  /* --- progression: avklarade nivåer per läge (NYCKLAR TILLAGDA, gamla orörda) ---
     pfb_cleared_v1 (classic) / pfb_cleared_sky_v1 (sky): {level:1}.
     Unlock (pfb_unlocked_v1) förblir delad och enda sanningen för lås.
     Replay sänker aldrig unlock (levelClear höjer endast). */
  _clearedKey(mode) { return mode === "sky" ? "pfb_cleared_sky_v1" : "pfb_cleared_v1"; },
  _readCleared(mode) { try { return JSON.parse(SafeStorage.get(this._clearedKey(mode)) || "{}") || {}; } catch (e) { return {}; } },
  isCleared(mode, level) { try { return !!this._readCleared(mode)[level]; } catch (e) { return false; } },
  setCleared(mode, level) {
    if (typeof S !== "undefined" && S.simMode) return false; // tester skriver aldrig till lagring
    try {
      const k = this._clearedKey(mode), o = this._readCleared(mode);
      if (!o[level]) { o[level] = 1; SafeStorage.set(k, JSON.stringify(o)); if (window.SaveV2) SaveV2.mirror(); return true; }
    } catch (e) {}
    return false;
  },
  /* Migrering för återvändare: fyll cleared utifrån best>=target för nivåer
     under unlock. Rör aldrig befintliga nycklar, sänker aldrig unlock. */
  migrateProgress() {
    try {
      let un = Number(SafeStorage.get("pfb_unlocked_v1") || 1) || 1;
      un = Math.max(1, Math.floor(un));
      SafeStorage.set("pfb_unlocked_v1", String(un));
      for (const mode of ["classic", "sky"]) {
        const bk = mode === "sky" ? "pfb_best_sky_v1" : "pfb_best_v1";
        let best = {}; try { best = JSON.parse(SafeStorage.get(bk) || "{}") || {}; } catch (e) { best = {}; }
        const ck = this._clearedKey(mode);
        let cl = {}; try { cl = JSON.parse(SafeStorage.get(ck) || "{}") || {}; } catch (e) { cl = {}; }
        let dirty = false;
        for (let lvl = 1; lvl < un; lvl++) {
          if (!cl[lvl] && (best[lvl] || 0) >= levelConfig(lvl).target) { cl[lvl] = 1; dirty = true; }
        }
        if (dirty) SafeStorage.set(ck, JSON.stringify(cl));
      }
    } catch (e) {}
    if (window.SaveV2) SaveV2.mirror();
  },
  get muted() { return SafeStorage.get("pfb_muted_v1") === "1"; },
  set muted(v) { SafeStorage.set("pfb_muted_v1", v ? "1" : "0"); if (window.SaveV2) SaveV2.mirror(); }
};

/* ============================================================
   Phase 1A — EKONOMI (fjädrar, dagbelöning, fågelsamling).
   Regler (hårda):
   - Enda intjäningen: +perPipe per passerat hinder (exakt en gång per
     hinder — vid ob.passed-flanken i stepPlaying) samt +firstClear en
     gång per (läge, nivå) via bonus-ledgern i SaveV2.
   - ALDRIG i simMode: simuleringar/tester ger noll valuta och rör
     aldrig sparfilen.
   - Ekonomin läser bara spelet — fysik, hinder, svårighet, poäng och
     Classic/Sky-regler är orörda. Kosmetik påverkar aldrig gameplay.
   ============================================================ */
function econV2() { // idea 3 flag (default on): ?econ=0 or localStorage pfb_econ_v2="0" ⇒ v0.3 rules
  try { const q = new URLSearchParams(location.search).get("econ"); if (q === "0") return false; if (q === "1") return true;
    return SafeStorage.get("pfb_econ_v2") !== "0"; } catch (e) { return true; }
}
const ECON_V2 = econV2();
function econR() { try { return ECON_V2 ? window.ECON.rewards : window.ECON.legacy.rewards; } catch (e) { return { perPipe: 2, firstClear: 25 }; } }
const Econ = {
  V2: ECON_V2,
  runEarned: 0,  // fjädrar intjänade under pågående försök (nollställs i showReady)
  runPipes: 0,
  unflushed: 0, // Gate C: buffrade fjädrar — lagring skrivs i klump (aldrig per hinder)
  unflushedObs: 0, _q: 0, _day: null, _dayBase: 0, _since: 0, _milePaid: null,
  get perPipe() { try { return econR().perPipe | 0 || 2; } catch (e) { return 2; } },
  get firstClear() { try { return econR().firstClear | 0 || 25; } catch (e) { return 25; } },
  get bal() { try { return (window.SaveV2 ? SaveV2.getFeathers() : 0) + (this.unflushed | 0); } catch (e) { return this.unflushed | 0; } },
  live() { return !(window.__DW_SIM === true || (typeof S !== "undefined" && S.simMode)); },
  /* daily obstacle bonus: day + count at run start. Within ONE session the day only rolls over after
     real monotonic time reached the next UTC midnight (clock forward without reload gives nothing). */
  _sessT0: null, _sessDay: null, _sessMsToMidnight: 0,
  econDay() {
    if (!window.SaveV2) return { day: null, n: 0 };
    const now = new Date(), today = SaveV2.utcDateStr(now);
    if (this._sessT0 == null) {
      this._sessT0 = performance.now(); this._sessDay = today;
      const mid = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
      this._sessMsToMidnight = mid - now.getTime();
    }
    let t = today;
    if (t !== this._sessDay && performance.now() - this._sessT0 < this._sessMsToMidnight) t = this._sessDay;
    return SaveV2.dayObstacles(t);
  },
  resetRun() {
    this.flush(); this.unflushed = 0; this.unflushedObs = 0; this.runEarned = 0; this.runPipes = 0; this._since = 0; this._milePaid = {};
    if (this.V2 && this.live()) { try { const e = this.econDay(); this._day = e.day; this._dayBase = e.n | 0; } catch (e) { this._day = null; this._dayBase = 0; } }
  },
  /* rate for the k-th obstacle of the day (0-based): 2 / 1 / one per four (quarter accumulator) */
  rateFor(k) {
    if (!this.V2) return this.perPipe;
    const tiers = econR().dayTiers || [[1e9, 2]];
    for (const [cap, r] of tiers) if (k < cap) {
      if (r >= 1) return r | 0;
      this._q += r; if (this._q >= 1 - 1e-9) { this._q -= 1; return 1; } return 0;
    }
    return 0;
  },
  /* +rate för ett passerat hinder. Buffras i minnet (Gate C) och skrivs
     till lagring i klump via flush() — aldrig en localStorage-skrivning per hinder. */
  awardPipe() {
    if (!this.live()) return 0;
    if (this._day == null && this.V2) { try { const e = this.econDay(); this._day = e.day; this._dayBase = e.n | 0; } catch (e) {} }
    let a = this.rateFor((this._dayBase | 0) + this._since);
    // endless milestones (per run, once each)
    try {
      if (this.V2 && S.runMode === "endless") {
        const ms = econR().endlessMilestones || {}, sc = S.score | 0;
        if (ms[sc] && !(this._milePaid || {})[sc]) { (this._milePaid = this._milePaid || {})[sc] = 1; a += ms[sc] | 0;
          if (window.Analytics) Analytics.emit("endless_milestone", { n: sc, amount: ms[sc] | 0 }); }
      }
    } catch (e) {}
    this.unflushed += a; this.unflushedObs++; this._since++; // ingen lagring här
    this.runEarned += a; this.runPipes++;
    if (a > 0) try {
      S.popups.push({ x: S.bird.x + 44, y: S.bird.y - 34, t: 0, txt: "+" + a + "🪶", feather: true });
      AudioFX.feather();
      Econ.refreshFeatherUI();
    } catch (e) {}
    return a;
  },
  /* Skriv buffrade fjädrar till lagring. Idempotent — anropas vid
     clear/krasch/paus/meny/flikbyte. Returnerar sparat belopp. */
  flush() {
    if (!this.live()) return 0;
    const obs = this.unflushedObs | 0; this.unflushedObs = 0;
    if (obs > 0 && this.V2 && this._day && window.SaveV2) { try { SaveV2.addDayObstacles(obs, this._day); this._dayBase += obs; this._since -= obs; } catch (e) {} }
    if (!(this.unflushed > 0)) return 0;
    const n = this.unflushed;
    this.unflushed = 0;
    try {
      if (window.SaveV2) SaveV2.addFeathers(n);
      this.refreshFeatherUI();
      return n;
    } catch (e) { this.unflushed += n; return 0; }
  },
  /* Förstaclear-bonus. V2: once per LEVEL across modes (E5). Returnerar beloppet (0 om redan tagen eller sim). */
  awardFirstClear() {
    if (!this.live()) return 0;
    try {
      const fresh = this.V2 ? SaveV2.claimFirstClearLevel(S.mode, S.level) : SaveV2.claimBonus(S.mode, S.level);
      if (window.SaveV2 && fresh) {
        SaveV2.addFeathers(this.firstClear);
        if (window.Analytics) Analytics.emit("firstclear_bonus", { level: S.level, mode: S.mode, amount: this.firstClear });
        this.refreshFeatherUI();
        return this.firstClear;
      }
    } catch (e) {}
    return 0;
  },
  clockSkew() { try { return !!(window.SaveV2 && SaveV2.dailyState().clockSkew); } catch (e) { return false; } },
  dailyTrack() { try { return (ECON_V2 ? window.ECON.dailyTrack : window.ECON.legacy.dailyTrack).slice(); } catch (e) { return [50, 60, 80, 100, 130, 160, 300]; } },
  dailyRewardFor(claimIndex) {
    const t = this.dailyTrack();
    return t[((Math.max(1, claimIndex | 0) - 1) % t.length + t.length) % t.length];
  },
  /* A10 (P2-1): klockhopp framåt. Offline kan inget helt förhindras (spelaren äger klockan), men inom
     EN session krävs ≥ CLAIM_GAP_H timmar verklig (monoton) tid mellan två hämtningar — att vrida
     fram klockan utan omladdning ger alltså inget. Bakåtvriden klocka spärras redan (Gate C). */
  CLAIM_GAP_H: 20,
  _sessClaimAt: null,
  sessionAllowsClaim() { return this._sessClaimAt == null || (performance.now() - this._sessClaimAt) >= this.CLAIM_GAP_H * 3600e3; },
  canClaimDaily() {
    try { return window.SaveV2 ? (SaveV2.dailyState().canClaim && this.sessionAllowsClaim()) : false; }
    catch (e) { return false; }
  },
  nextDailyReward() { try { return this.dailyRewardFor((SaveV2.dailyState().claimedTotal | 0) + 1); } catch (e) { return 0; } },
  /* Daglig claim. Idempotent per datum — samma dag twice ⇒ {ok:false}. */
  claimDaily() {
    if (!this.live()) return { ok: false, sim: true };
    try {
      if (!this.sessionAllowsClaim()) return { ok: false, reason: "session" };
      const r = SaveV2.claimDaily();
      if (!r.ok) return r;
      this._sessClaimAt = performance.now();
      const reward = this.dailyRewardFor(r.claimIndex);
      SaveV2.addFeathers(reward);
      this.refreshFeatherUI();
      if (window.Analytics) Analytics.emit("daily_claim", { reward, claimIndex: r.claimIndex });
      return { ok: true, reward, claimIndex: r.claimIndex };
    } catch (e) { return { ok: false }; }
  },
  birdDefs() { try { return window.ECON.BIRDS.slice(); } catch (e) { return [{ id: "sunny", cost: 0 }]; } },
  birdDef(id) { const ds = this.birdDefs(); for (const d of ds) if (d.id === id) return d; return ds[0]; },
  /* Upplåsning med tvåstegsbekräftelse i UI; här: atomisk spend+own (v4: one write). Prestige birds
     cannot be bought — they unlock when the visible requirement is met (claimPrestige). */
  unlockBird(id) {
    if (!this.live()) return { ok: false, sim: true };
    try {
      const def = this.birdDef(id);
      if (!def || def.id !== id) return { ok: false, reason: "unknown" };
      if (def.prestige) return { ok: false, reason: "prestige" };
      if (SaveV2.isOwned(id)) return { ok: false, reason: "owned" };
      const r = SaveV2.buyBird ? SaveV2.buyBird(id, def.cost) : (SaveV2.spendFeathers(def.cost) && SaveV2.ownBird(id) ? { ok: true } : { ok: false, reason: "funds" });
      if (!r.ok) return r;
      this.refreshFeatherUI();
      if (window.Analytics) { Analytics.emit("feather_spend", { what: "bird", id, cost: def.cost }); Analytics.emit("bird_unlock", { id }); }
      return { ok: true, cost: def.cost };
    } catch (e) { return { ok: false }; }
  },
  /* ---- Courier Closet (v4) ---- */
  cosmeticDefs(slot) { try { return (window.ECON.COSMETICS[slot] || []).slice(); } catch (e) { return []; } },
  cosmeticDef(slot, id) { for (const d of this.cosmeticDefs(slot)) if (d.id === id) return d; return null; },
  prestigeMet(p) {
    if (!p) return false;
    try {
      if (p.type === "clear") return store.isCleared("classic", p.level);
      if (p.type === "endless") return Math.max(store.endlessBest("classic"), store.endlessBest("sky")) >= (p.n | 0);
    } catch (e) {}
    return false;
  },
  /* unlock a prestige item when its requirement is met (0 feathers, never for sale) */
  claimPrestige(slot, id) {
    if (!this.live()) return { ok: false, sim: true };
    const def = slot === "bird" ? this.birdDef(id) : this.cosmeticDef(slot, id);
    if (!def || def.id !== id || !def.prestige) return { ok: false, reason: "unknown" };
    if (!this.prestigeMet(def.prestige)) return { ok: false, reason: "locked" };
    const ok = slot === "bird" ? SaveV2.ownBird(id) : SaveV2.ownCosmetic(slot, id);
    if (ok && window.Analytics) Analytics.emit("prestige_unlock", { slot, id });
    return { ok: true, fresh: !!ok };
  },
  buyCosmetic(slot, id) {
    if (!this.live()) return { ok: false, sim: true };
    const def = this.cosmeticDef(slot, id);
    if (!def) return { ok: false, reason: "unknown" };
    if (def.prestige) return { ok: false, reason: "prestige" };
    if (!(def.cost > 0)) return { ok: false, reason: "free" };
    const r = SaveV2.buyCosmetic(slot, id, def.cost);
    if (r.ok) { this.refreshFeatherUI(); if (window.Analytics) Analytics.emit("feather_spend", { what: slot, id, cost: def.cost }); }
    return r.ok ? { ok: true, cost: def.cost } : r;
  },
  equipCosmetic(slot, id) { if (!this.live()) return false; try { const ok = SaveV2.equipCosmetic(slot, id); this._cosEq = null; return ok; } catch (e) { return false; } },
  _cosEq: null,
  cosEquipped() { // cached; read from the save at most once per change (never per frame)
    if (this._cosEq) return this._cosEq;
    try { this._cosEq = (window.SaveV2 && SaveV2.cosmetics) ? SaveV2.cosmetics().equipped : {}; } catch (e) { this._cosEq = {}; }
    return this._cosEq;
  },
  equipBird(id) {
    if (!this.live()) return false;
    try {
      const ok = SaveV2.equipBird(id);
      if (ok) {
        try { S.birdSkin = id; } catch (e) {}
        if (window.Analytics) Analytics.emit("bird_equip", { id });
      }
      return ok;
    } catch (e) { return false; }
  },
  skin() { try { return (window.SaveV2 && SaveV2.equippedBird()) || "sunny"; } catch (e) { return "sunny"; } },
  /* Uppdatera alla balansvisningar (billig — textContent-sättning). */
  refreshFeatherUI() {
    try {
      const b = this.bal;
      const fp = $("featherPill"); if (fp) fp.textContent = "🪶 " + b;
      const mb = $("menuFeathers"); if (mb) mb.textContent = b;
      const cn = $("clockNotice"); if (cn) cn.hidden = !this.clockSkew();
      const db = $("dailyBtn");
      if (db) {
        // A10: tydlig belöning i klartext när den kan hämtas (förut bara en röd prick)
        const can = this.canClaimDaily();
        const html = can ? I18N.t("daily_btn_ready", { n: this.nextDailyReward() }) : I18N.t("daily_btn");
        if (db.innerHTML !== html) db.innerHTML = html;
        db.classList.toggle("green", !!can);
        db.classList.toggle("secondary", !can);
        db.classList.toggle("pulse", !!can);
      }
    } catch (e) {}
  }
};
/* ============================================================
   LJUD — swappable audio engine + sound packs (v0.3).
   ENGINE (stable interface, sound-design-agnostic): master/sfx/music buses, setVolume (SFX),
   setMusicVolume, mute via `muted`, pause()/resume() (also on visibilitychange), iOS unlock on the
   first gesture (resume + 1-sample silent buffer; "interrupted" state handled), silent in Sim/tests.
   PACKS (the sound design): "legacy" = the exact v0.2 sounds, DEFAULT. "v1-draft" = the Identity V1
   draft (pentatonic streak, noise flap, music bed) — OFF until Martin approves a sound concept
   (Audio Director / Audio Design Bible pending). Enable for review: ?audio=v1-draft or
   localStorage pfb_audio_pack="v1-draft". A future pack only has to implement the cue names in CUES.
   NOT verified on a real iPhone/Android.
   ============================================================ */
const AUDIO_CUES = ["flap", "score", "near", "hit", "fall", "swoosh", "click", "chirp", "fanfare", "medal",
  "worldComplete", "milestone", "feather", "unlock"];
const SOUND_PACKS = {
  /* v0.2 sounds, byte-for-byte same parameters (gain now goes through the SFX bus, master 1.0 for this pack) */
  legacy: {
    master: 1.0, music: null,
    flap(A) { A.tone(420, 0.14, "triangle", 0.22, 140); },
    score(A) { A.tone(880, 0.12, "sine", 0.22); A.tone(1318, 0.18, "sine", 0.2, null, 0.09); },
    near() {}, chirp() {}, medal(A) { this.milestone(A); },
    hit(A) { A.tone(160, 0.25, "square", 0.25, 50); A.tone(90, 0.3, "sawtooth", 0.18, 40, 0.02); },
    fall(A) { A.tone(700, 0.5, "sine", 0.12, 180); },
    swoosh(A) { A.tone(300, 0.18, "sine", 0.12, 700); },
    click(A) { A.tone(650, 0.07, "square", 0.1, 500); },
    fanfare(A) { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => A.tone(f, 0.22, "triangle", 0.2, null, i * 0.13)); },
    worldComplete(A) { [392, 494, 587, 784, 988, 1175].forEach((f, i) => A.tone(f, 0.3, "triangle", 0.22, null, i * 0.12)); A.tone(1568, 0.6, "sine", 0.18, null, 0.75); },
    milestone(A) { A.tone(1318, 0.4, "sine", 0.2); A.tone(1760, 0.5, "sine", 0.18, null, 0.12); A.tone(2093, 0.6, "sine", 0.15, null, 0.24); },
    feather(A) { A.tone(1568, 0.09, "sine", 0.12, 2093); },
    unlock(A) { [659, 784, 988, 1318].forEach((f, i) => A.tone(f, 0.22, "triangle", 0.2, null, i * 0.1)); }
  },
  /* DRAFT — not approved. Identity spec §9 proposal, kept for the Audio Director to review. */
  "v1-draft": {
    master: 0.8,
    music: { bpm: 100, root: 523, lead: [0, null, 7, 4, null, 9, 7, null, 2, null, 9, 7, null, 4, 2, null],
      bass: [-12, null, null, null, -5, null, null, null, -8, null, null, null, -5, null, null, null] },
    flap(A) { A.noise(40, "bandpass", 1800, 0.18); A.tone(A.semis(880, (Math.random() * 4 - 2)), 0.05, "triangle", 0.06); },
    score(A) { const sc = [0, 2, 4, 7, 9]; let n = 0; try { n = Math.max(0, (S.score | 0) - 1); } catch (e) {}
      A.tone(A.semis(523, sc[n % 5] + 12 * (Math.floor(n / 5) % 2)), 0.25, "sine", 0.22); },
    near(A) { A.noise(120, "highpass", 3000, 0.12); },
    hit(A) { A.tone(110, 0.22, "sine", 0.3, 55); A.noise(90, "lowpass", 600, 0.22); },
    fall(A) { A.tone(700, 0.5, "sine", 0.1, 180); },
    swoosh(A) { A.noise(160, "bandpass", 900, 0.1); },
    click(A) { A.tone(660, 0.05, "triangle", 0.1); },
    chirp(A) { A.tone(3200, 0.09, "sine", 0.08, 4200); },
    fanfare(A) { [0, 4, 7, 12].forEach((s, i) => A.tone(A.semis(659, s), 0.3, "triangle", 0.18, null, i * 0.11)); this.chirp(A); },
    medal(A) { [0, 4, 7].forEach(s => A.tone(A.semis(659, s), 0.6, "sine", 0.14)); },
    worldComplete(A) { [0, 4, 7, 12, 16, 19].forEach((s, i) => A.tone(A.semis(392, s), 0.3, "triangle", 0.2, null, i * 0.12)); A.tone(1568, 0.6, "sine", 0.16, null, 0.75); },
    milestone(A) { this.medal(A); },
    feather(A) { A.tone(1568, 0.07, "sine", 0.08, 2093); },
    unlock(A) { [0, 4, 7, 12].forEach((s, i) => A.tone(A.semis(659, s), 0.22, "triangle", 0.18, null, i * 0.1)); }
  }
};
function pickSoundPack() {
  let id = "legacy";
  try { const q = new URLSearchParams(location.search).get("audio"); if (q && SOUND_PACKS[q]) id = q;
    else { const ls = window.SafeStorage ? SafeStorage.get("pfb_audio_pack") : localStorage.getItem("pfb_audio_pack"); if (ls && SOUND_PACKS[ls]) id = ls; } } catch (e) {}
  return id;
}
const AudioFX = {
  ctx: null, muted: store.muted, volume: 1, musicVol: 0.5, packId: pickSoundPack(), paused: false,
  _master: null, _sfx: null, _mus: null, _noise: null, _musTimer: null, _musNext: 0, _musStep: 0, _gesture: false, _unlocked: false,
  get pack() { return SOUND_PACKS[this.packId] || SOUND_PACKS.legacy; },
  hasMusic() { return !!this.pack.music; },
  setPack(id) { if (!SOUND_PACKS[id]) return false; this.packId = id; if (this._master) this._master.gain.value = this.pack.master; this.syncMusic(); return true; },
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v)));
    if (!(this.volume > 0)) this.volume = 0;
    if (this._sfx) this._sfx.gain.value = this.volume;
  },
  setMusicVolume(v) {
    this.musicVol = Math.max(0, Math.min(1, Number(v))); if (!(this.musicVol > 0)) this.musicVol = 0;
    if (this._mus) this._mus.gain.value = this.musicVol * 0.25; // ≈ −12 dB under SFX
    this.syncMusic();
  },
  setMuted(m) { this.muted = !!m; this.syncMusic(); },
  silent() { return this.muted || window.__DW_SIM === true; },
  ensure() {
    this._gesture = true;
    if (window.__DW_SIM) return;
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
      try {
        const c = this.ctx;
        this._master = c.createGain(); this._master.gain.value = this.pack.master; this._master.connect(c.destination);
        this._sfx = c.createGain(); this._sfx.gain.value = this.volume; this._sfx.connect(this._master);
        this._mus = c.createGain(); this._mus.gain.value = this.musicVol * 0.25; this._mus.connect(this._master);
        const len = Math.floor(c.sampleRate * 0.25), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
        let seed = 12345; for (let i = 0; i < len; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = seed / 0x3fffffff - 1; }
        this._noise = buf;
      } catch (e) {}
    }
    if (!this._unlocked && this.ctx) { // iOS unlock: play one silent sample inside the gesture
      try { const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource(); s.buffer = b; s.connect(this.ctx.destination); s.start(0); this._unlocked = true; } catch (e) {}
    }
    // iOS Safari can report "interrupted" (call, Siri) as well as "suspended"
    if (!this.paused && this.ctx && (this.ctx.state === "suspended" || this.ctx.state === "interrupted")) { try { this.ctx.resume(); } catch (e) {} }
    this.syncMusic();
  },
  /* pause()/resume(): app hidden or game paused — suspends the context so nothing plays or drains battery */
  pause() { this.paused = true; this.syncMusic(); if (this.ctx && this.ctx.state === "running") { try { this.ctx.suspend(); } catch (e) {} } },
  resume() { this.paused = false; if (this._gesture && this.ctx && this.ctx.state !== "running") { try { this.ctx.resume(); } catch (e) {} } this.syncMusic(); },
  out() { return this._sfx || (this.ctx && this.ctx.destination); },
  play(cue) { if (this.silent() || this.volume <= 0 || this.paused) return; const f = this.pack[cue]; if (typeof f === "function") try { f.call(this.pack, this); } catch (e) {} },
  tone(freq, dur, type, vol, slideTo, delay) {
    if (this.silent() || this.volume <= 0) return;
    this.ensure();
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + (delay || 0);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol || 0.2), t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.out());
    o.start(t0); o.stop(t0 + dur + 0.05);
  },
  noise(ms, filterType, hz, vol, delay) {
    if (this.silent() || this.volume <= 0) return;
    this.ensure();
    if (!this.ctx || !this._noise) return;
    const t0 = this.ctx.currentTime + (delay || 0), dur = ms / 1000;
    const src = this.ctx.createBufferSource(); src.buffer = this._noise;
    const f = this.ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = hz; f.Q.value = 0.9;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.out());
    src.start(t0); src.stop(t0 + dur + 0.02);
  },
  semis(base, n) { return base * Math.pow(2, n / 12); },
  /* ---- music (only packs that define `music`) ---- */
  syncMusic() {
    const m = this.pack.music;
    const want = !!m && this._gesture && this.ctx && !this.silent() && !this.paused && this.musicVol > 0 && !(typeof document !== "undefined" && document.hidden);
    if (want && !this._musTimer) {
      this._musNext = this.ctx.currentTime + 0.1;
      this._musTimer = setInterval(() => this._schedule(), 120);
    } else if (!want && this._musTimer) { clearInterval(this._musTimer); this._musTimer = null; }
  },
  _schedule() {
    const m = this.pack.music;
    if (!m || !this.ctx || this.silent() || this.paused || this.musicVol <= 0) return this.syncMusic();
    const eighth = 60 / m.bpm / 2;
    while (this._musNext < this.ctx.currentTime + 0.3) {
      const i = this._musStep % m.lead.length, a = m.lead[i], b = m.bass[i % m.bass.length], t = this._musNext - this.ctx.currentTime;
      if (a != null) this._musNote(this.semis(m.root, a), 0.22, "triangle", 0.16, t);
      if (b != null) this._musNote(this.semis(m.root, b), 0.5, "sine", 0.2, t);
      this._musNext += eighth; this._musStep++;
    }
  },
  _musNote(f, dur, type, vol, delay) {
    const t0 = this.ctx.currentTime + Math.max(0, delay);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this._mus); o.start(t0); o.stop(t0 + dur + 0.05);
  }
};
for (const cue of AUDIO_CUES) AudioFX[cue] = function () { this.play(cue); };
try { document.addEventListener("visibilitychange", () => { if (document.hidden) AudioFX.pause(); else AudioFX.resume(); }); } catch (e) {}
/* ---------- DOM ---------- */
const $ = id => document.getElementById(id);
const canvas = $("gameCanvas"), ctx = canvas.getContext("2d");
const stage = $("stage");
const hud = $("hud"), scoreBig = $("scoreBig"), levelPill = $("levelPill"), progressFill = $("progressFill");
const tutorial = $("tutorial"), tutorialText = $("tutorialText");
const menuOv = $("menuOv"), levelsOv = $("levelsOv"), readyOv = $("readyOv"),
      pauseOv = $("pauseOv"), overOv = $("overOv"), clearOv = $("clearOv"),
      worldsOv = $("worldsOv"), settingsOv = $("settingsOv"),
      dailyOv = $("dailyOv"), birdsOv = $("birdsOv"); // Phase 1A-overlays (kan saknas i äldre tester — guardas)
const flashEl = $("flash"), fadeBlack = $("fadeBlack"), muteBtn = $("muteBtn");

/* ---------- spelstatus ---------- */
const S = {
  state: "menu",       // menu | ready | playing | dying | gameover | clear | paused
  pausedFrom: null,
  level: 1, cfg: levelConfig(1), world: WORLDS.meadow, worldKey: "meadow",
  selectedLevel: 1,
  levelFilterWorld: null,      // vilken värld nivåväljaren visar (null = följ selectedLevel)
  clearIsNewBest: false,       // sätts i levelClear (enbart UI)
  clearIsWorldFinal: false,    // sätts i levelClear (enbart UI)
  clearWorldId: null,          // avklarad värld (för replay-world, enbart UI)
  clearIsMilestone: false,     // endless-milstolpe (enbart UI)
  W: 480, H: 800, dpr: 1, scale: 1, groundH: 92,
  viewH: 800, camY: 0, // Gate B: H=800 är den LOGISKA spelytan (alltid).
  // viewH/camY är endast kamera: bottenankrad (marken alltid synlig),
  // extra himmel ovanför på höga skärmar. All gameplay (band, fysik,
  // spawn, kollision) använder H — aldrig viewH.
  camX: 0, time: 0, ptime: 0, // time = visuell klocka (aldrig i hash); ptime = fysiktid (hashad)
  bird: { x: 150, y: 340, vy: 0, rot: 0, wing: 0, alive: true },
  pipes: [], particles: [], popups: [], clouds: [], trees: [], ambient: [],
  score: 0, best: 0, shake: 0, shakeT: 0, deathT: 0, clearT: 0,
  prevGapY: null, flapLock: 0, playStartT: 0,
  mode: "classic",            // classic = ren skillnad (Phase 0), sky = framtida progression
  runMode: "adventure",       // Gate D: 'adventure' (målbaserad) | 'endless' (oändlig)
  diff: null,                 // Gate D: endless svårighets-pseudonivå (null = följ S.level)
  overdrive: false,           // Gate D: fortsatt runda efter clear (medaljjakt)
  runSeed: 1, attempt: 0,     // deterministisk sekvens per försök (samma seed ⇒ samma hinder)
  spawnLastFam: null, spawnCount: 0,
  envId: null, prevEnvId: null, envBlend: 1, // premiumsceneri (visual only)
  birdSkin: "sunny", // Phase 1A: utrustad fågel (kosmetik — fysik/hitbox identisk)
  simMode: false, simResult: null // testsele: Sim.run sätter dessa (inga sidoeffekter då)
};
S.bird.x = S.W * TUNE.birdXfrac;

function setLevel(n) {
  S.level = n;
  S.cfg = levelConfig(n);
  S.worldKey = S.cfg.world;
  S.world = WORLDS[S.worldKey];
  S.best = store.bestFor(S.mode, n);
  S.bird.x = S.W * TUNE.birdXfrac;
  buildDecor();
  // premiumsceneri (visual only — deterministiskt per nivå, ingen RNG)
  if (window.Worlds) {
    const eid = Worlds.selectEnv(n, S.worldKey);
    if (S.envId && eid !== S.envId) { S.prevEnvId = S.envId; S.envBlend = 0; }
    else if (!S.envId) { S.prevEnvId = null; S.envBlend = 1; }
    S.envId = eid;
  }
}

/* ---------- dekorationer ---------- */
function buildDecor() {
  S.clouds = [];
  for (let i = 0; i < 8; i++) {
    S.clouds.push({ x: hash(i * 3 + S.level) * 900 - 200, y: 40 + hash(i * 7 + 1) * 260,
      s: 0.6 + hash(i * 13) * 0.9, v: 6 + hash(i * 29) * 14 });
  }
  // främre molnlager (närmast kameran — 2.5D-djup, enbart dekor)
  S.cloudsFront = [];
  for (let i = 0; i < 4; i++) {
    S.cloudsFront.push({ x: hash(i * 7 + S.level * 3 + 99) * 900 - 200, y: 150 + hash(i * 17 + 5) * 300,
      s: 1.1 + hash(i * 23) * 1.1, v: 14 + hash(i * 41) * 18 });
  }
  S.trees = [];
  const span = 2600;
  for (let i = 0; i < 14; i++) {
    S.trees.push({ x: (i / 14) * span + hash(i * 5 + S.level * 11) * 90,
      s: 0.75 + hash(i * 17) * 0.6, v: hash(i * 31) });
  }
  S.ambient = [];
  const n = 42;
  for (let i = 0; i < n; i++) {
    S.ambient.push({ x: Math.random() * S.W, y: rand(S.camY, S.H), // Gate B: täck hela kameraremsan
      s: rand(1, 3.2), ph: rand(0, TAU), sp: rand(12, 55) });
  }
}

/* ---------- canvas-storlek (Gate B: logisk spelplan + kamera) ---------- */
function resize() {
  const r = stage.getBoundingClientRect();
  // A2 (P0-2): använd elementets verkliga mått (tidigare min 280×420 ⇒ förvrängd canvas på korta skärmar)
  const cssW = Math.max(1, r.width), cssH = Math.max(1, r.height);
  // A9: DPR-tak 2, sänks adaptivt (2 → 1.5 → 1) om bildrutorna är för långsamma (se perfGovernor)
  S.dpr = Math.min(S.dprCap || 2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(cssW * S.dpr));
  canvas.height = Math.max(1, Math.round(cssH * S.dpr));
  S.H = 800; // logisk spelplan — ändras ALDRIG med skärm (samma seed ⇒ samma sekvens)
  // A2: "contain" — hela den logiska planen 480×800 syns ALLTID (förut skalades efter bredd och toppen
  // klipptes på datorer/liggande). Överskott i höjd = extra himmel ovanför (bottenankrad kamera),
  // överskott i bredd = centrerad plan med maskade sidomarginaler (offX).
  S.scale = Math.min(canvas.width / S.W, canvas.height / S.H);
  S.viewW = canvas.width / S.scale;
  S.offX = (S.viewW - S.W) / 2;
  S.viewH = canvas.height / S.scale;
  S.camY = S.H - S.viewH; // alltid <= 0 (negativ = extra himmel)
  S.bird.x = S.W * TUNE.birdXfrac;
  // Gate C: pausa säkert vid väsentlig vyändring mitt i en runda (aldrig instant death).
  try {
    const cw = Math.round(cssW), chh = Math.round(cssH);
    if (S.state === "playing" && window.__lastView &&
        (Math.abs(cw - window.__lastView.w) > 40 || Math.abs(chh - window.__lastView.h) > 40)) {
      doPause();
    }
    window.__lastView = { w: cw, h: chh };
  } catch (e) {}
  syncRotateVeil();
}
/* A2: rotationsspärr. Telefon (touch) i liggande läge med låg höjd ⇒ blockerande ruta, rundan pausas
   och kan inte startas förrän enheten är stående igen. Ingen "Fortsätt ändå" (gav halv skärm).
   Datorer/surfplattor blockeras aldrig — där syns hela planen tack vare "contain"-skalningen. */
let _veilDismiss = false; // behålls för bakåtkompatibilitet (ingen knapp sätter den längre)
function isTouchDevice() {
  try { return (window.matchMedia && matchMedia("(pointer: coarse)").matches) || (navigator.maxTouchPoints | 0) > 0; } catch (e) { return false; }
}
function rotateBlocked() {
  try { return isTouchDevice() && window.innerWidth > window.innerHeight && window.innerHeight < 520; } catch (e) { return false; }
}
function syncRotateVeil() {
  try {
    const el = document.getElementById("rotateVeil");
    const blocked = rotateBlocked();
    S.rotateBlocked = blocked;
    if (blocked && (S.state === "playing" || S.state === "countdown")) doPause();
    if (!el) return;
    el.hidden = !blocked;
  } catch (e) {}
}
window.addEventListener("resize", resize);
/* A8 (P1-7): pausa vid flikbyte, fönsterfokus-tapp (notis, kontrollcenter, klick utanför iframe)
   och pagehide (bfcache/stängning). Flikbyte dödar aldrig. */
function autoPause() { if (S.state === "playing" || S.state === "countdown") doPause(); }
document.addEventListener("visibilitychange", () => { if (document.hidden) autoPause(); });
window.addEventListener("blur", autoPause);
window.addEventListener("pagehide", autoPause);

/* ---------- UI-hjälp ---------- */
function hideAll() {
  [menuOv, levelsOv, worldsOv, readyOv, pauseOv, overOv, clearOv, settingsOv, dailyOv, birdsOv, document.getElementById("courseOv")].forEach(o => { if (o) o.hidden = true; });
  tutorial.hidden = true;
}
function showMenu() {
  S.state = "menu";
  Econ.flush(); // Gate C: spara ev. buffrade fjädrar innan vyn byts
  hideAll(); menuOv.hidden = false; hud.hidden = true;
  refreshMenu();
}
function refreshMenu() {
  const sel = S.selectedLevel;
  $("menuBest").textContent = store.bestFor(S.mode, sel);
  $("menuUnlocked").textContent = store.unlocked;
  const b = store.bestFor(S.mode, sel), t = levelConfig(sel).target;
  $("menuMedal").textContent = medalFor(b, t);
  $("playBtn").innerHTML = I18N.t("play_level", { n: sel });
  $("menuPill").textContent = I18N.t("menu_pill", { n: sel });
  try {
    if ($("endlessBtn")) $("endlessBtn").innerHTML = I18N.t("endless_btn");
    if ($("endlessBestLine")) $("endlessBestLine").innerHTML =
      I18N.t("endless_best_line", { m: S.mode === "sky" ? "SKY" : "Classic", n: store.endlessBest(S.mode) });
  } catch (e) {}
  Econ.refreshFeatherUI(); // Phase 1A: balans + dagbelöningsprick
  try { Daily.menuButton(); } catch (e) {} // idea 5: today's course entry
  try {
    const wsel = WORLD_INFO[worldForLevel(sel)];
    if (wsel && $("menuSubtitle")) $("menuSubtitle").textContent = I18N.t("menu_subtitle", { name: wsel.name, icon: wsel.icon, tag: wsel.tag });
  } catch (e) {}
  syncModeBtns();
}
function medalFor(score, target) {
  if (score >= target) return "🏆";
  const r = target ? score / target : 0;
  if (r >= 0.7) return "🥇";
  if (r >= 0.4) return "🥈";
  if (r >= 0.2) return "🥉";
  return "—";
}
function medalEmoji(score, target) {
  const m = medalFor(score, target);
  return m === "—" ? "🐣" : m;
}

/* Tips-pool — via I18N (sv identiska med tidigare strängar). */
function tipsPool() { return I18N.tips(); }
const TIPS = [
  "Tips: flaxa lite tidigare än du tror!",
  "Tips: håll fågeln i mitten av öppningen.",
  "Tips: korta, lugna tryck är bäst.",
  "Tips: andas ut — nivå 1 är gjord för att lyckas!",
  "Tips: sikta på öppningens mitt, inte kanten."
];

function showReady(level) {
  setLevel(level);
  S.runMode = "adventure"; S.diff = level; S.overdrive = false; S.odBaseTarget = null; // Gate D
  S.state = "ready";
  S.score = 0; S.pipes = []; S.particles = []; S.popups = [];
  S.camX = 0; S.shake = 0; S.prevGapY = null; // Gate A: null = mittenstart (0 kläms mot taket)
  S.ptime = 0; S.__stepIdx = 0; LIVE_ACC.acc = 0; // Gate B: fryst fysikklocka per försök
  S.spawnLastFam = null; S.spawnCount = 0; S.simResult = null;
  // nytt försök ⇒ ny deterministisk sekvens (loggas för replay/daglig utmaning)
  S.attempt++;
  S.runSeed = (((Math.random() * 0xFFFFFFFF) >>> 0) ^ (S.attempt * 2654435761) ^ (S.level * 40503)) >>> 0;
  window.RNG.reset(S.runSeed);
  resetBird();
  Econ.resetRun(); // Phase 1A: nollställ försöksräknare för fjädrar
  hideAll(); readyOv.hidden = false; hud.hidden = false;
  updateHUD();
  const wi = WORLD_INFO[S.worldKey];
  $("readyPill").textContent = I18N.t("ready_pill", { icon: wi.icon, n: level, name: wi.name });
  if (level === 1) {
    $("readyTitle").textContent = I18N.t("ready_l1_title");
    $("readyDesc").innerHTML = I18N.t("ready_l1_desc");
  } else {
    const c = S.cfg;
    const mov = c.oscAmp > 0 ? I18N.t("ready_mov") : "";
    $("readyTitle").textContent = I18N.t("ready_title", { n: level, name: wi.name, icon: wi.icon });
    $("readyDesc").innerHTML = I18N.t("ready_desc", { t: c.target, g: Math.round(c.gap), mov });
  }
  const intro = window.Director.describe(level);
  if (intro) $("readyDesc").innerHTML += "<br><b>" + intro + "</b>";
  $("readyDesc").innerHTML += I18N.t("ready_mode_line", {
    m: I18N.t(S.mode === "sky" ? "mode_sky" : "mode_classic"), s: S.runSeed });
  $("readyBtn").innerHTML = I18N.t("ready_btn", { n: level });
  tutorial.hidden = true; // visas först under flygning (nivå 1), så det inte krockar med kortet
  showCoachTip(level); // Stage C: kort familjetips (auto-dismiss, sett-flaggor sparas)
}

/* ============================================================
   Gate D: ENDLESS — separat oändligt läge (egen rekordtabell).
   Samma fysik, samma Director, samma grindar. Ingen mållinje:
   rundan slutar vid krasch. Svårighet (S.diff) och värld växer med poäng.
   ============================================================ */
function endlessCfg(score) {
  const dl = Math.min(1 + Math.floor(Math.max(0, score) / 10), 50);
  const c = levelConfig(dl);
  c.target = Infinity; c.endless = true; c.dl = dl;
  return c;
}
function setEndless() {
  S.runMode = "endless"; S.overdrive = false;
  S.level = 0; S.diff = 1;
  S.cfg = endlessCfg(0);
  S.worldKey = worldForLevel(1); S.world = WORLDS[S.worldKey];
  S.best = store.endlessBest(S.mode);
  S.bird.x = S.W * TUNE.birdXfrac;
  buildDecor();
  if (window.Worlds) {
    const eid = Worlds.selectEnv(1, S.worldKey);
    if (S.envId && eid !== S.envId) { S.prevEnvId = S.envId; S.envBlend = 0; }
    else if (!S.envId) { S.prevEnvId = null; S.envBlend = 1; }
    S.envId = eid;
  }
}
function showEndless() {
  setEndless();
  S.state = "ready";
  S.score = 0; S.pipes = []; S.particles = []; S.popups = [];
  S.camX = 0; S.shake = 0; S.prevGapY = null;
  S.ptime = 0; S.__stepIdx = 0; LIVE_ACC.acc = 0;
  S.spawnLastFam = null; S.spawnCount = 0; S.simResult = null;
  S.attempt++;
  S.runSeed = (((Math.random() * 0xFFFFFFFF) >>> 0) ^ (S.attempt * 2654435761) ^ 0xE1414) >>> 0;
  window.RNG.reset(S.runSeed);
  resetBird();
  Econ.resetRun();
  hideAll(); readyOv.hidden = false; hud.hidden = false;
  updateHUD();
  const eb = store.endlessBest(S.mode);
  $("readyPill").textContent = I18N.t("endless_pill");
  $("readyTitle").textContent = I18N.t("endless_ready_title");
  $("readyDesc").innerHTML = I18N.t("endless_ready_desc", { b: eb, m: S.mode === "sky" ? "SKY" : "Classic" });
  $("readyDesc").innerHTML += I18N.t("ready_mode_line", {
    m: I18N.t(S.mode === "sky" ? "mode_sky" : "mode_classic"), s: S.runSeed });
  $("readyBtn").innerHTML = I18N.t("endless_start_btn");
  hideCoachTip(false);
}
/* Växer med poängen: svårighet var 10:e, ny värld var 12:e hinder. */
function refreshEndless() {
  const dl = Math.min(1 + Math.floor(S.score / 10), 50);
  S.diff = dl;
  S.cfg = endlessCfg(S.score);
  const wk = worldForLevel(1 + Math.floor(S.score / 12));
  if (wk !== S.worldKey) {
    S.worldKey = wk; S.world = WORLDS[wk];
    if (window.Worlds) {
      const eid = Worlds.selectEnv(dl, wk);
      if (S.envId && eid !== S.envId) { S.prevEnvId = S.envId; S.envBlend = 0; }
      S.envId = eid;
    }
    if (window.Analytics) Analytics.emit("endless_world", { score: S.score, world: wk, mode: S.mode });
  }
}
/* Overdrive: fortsätt samma adventure-runda efter clear för medaljjakt.
   Ingen andra clear — krasch avslutar med marginal. */
function resumeOverdrive() {
  if (S.state !== "clear" || S.runMode !== "adventure") return;
  Econ.flush();
  hideAll(); hud.hidden = false;
  S.state = "playing"; S.overdrive = true;
  // A1 (P0-1): målet behålls (S.odBaseTarget) — tidigare sattes target = Infinity,
  // vilket gav 0 stjärnor, "Infinity (+0)", inget rekord och tappad ramp-fart.
  // Ingen andra clear: stepPlaying hoppar över levelClear när S.overdrive är sant.
  S.odBaseTarget = S.cfg.target;
  AudioFX.ensure(); AudioFX.click();
  hideCoachTip(true);
  S.popups.push({ x: S.W / 2, y: S.H * 0.3, t: 0, txt: "🔥 OVERDRIVE" });
  if (window.Analytics) Analytics.emit("overdrive", { level: S.level, mode: S.mode });
}

function startPlaying() {
  if (S.state !== "ready") return;
  if (S.rotateBlocked) return; // A2: rotationsspärr
  S.state = "playing";
  S.playStartT = S.time;
  if (S.runMode === "daily") Daily.onStart(); // fixed start state ⇒ receipt replays exactly in Sim; seed not logged
  else console.log("[dipwing] run seed " + S.runSeed + " level " + S.level + " mode " + S.mode);
  hideAll(); hud.hidden = false;
  // instruktion under flygning på nivå 1 (försvinner efter 3 poäng / 8 sek)
  if (S.level === 1 && S.runMode !== "daily") {
    tutorialText.innerHTML = I18N.t("tutorial_l1");
    tutorial.hidden = false;
  }
  hideCoachTip(true); // coachen har gjort sitt när spelet startar
  if (window.Analytics && S.runMode !== "daily") Analytics.emit("level_start", { level: S.level, mode: S.mode, seed: S.runSeed });
  flap();
}

function updateHUD() {
  if (scoreBig.textContent !== String(S.score)) {
    scoreBig.textContent = S.score;
    scoreBig.classList.remove("pop");
    void scoreBig.offsetWidth;
    scoreBig.classList.add("pop");
  }
  if (S.runMode === "daily") { // idea 5
    levelPill.textContent = I18N.t("course_hud", { s: S.score, n: S.cfg.target });
    progressFill.style.width = clamp(S.score / S.cfg.target * 100, 0, 100) + "%";
    return;
  }
  if (S.runMode === "endless") { // Gate D: visa världsfärd, inget mål
    levelPill.textContent = I18N.t("endless_hud", { s: S.score });
    progressFill.style.width = ((S.score % 12) / 12 * 100) + "%";
    return;
  }
  if (S.overdrive) { // A1: visa marginal i stället för "mål" under overdrive
    levelPill.textContent = I18N.t("hud_overdrive", { n: S.level, m: Math.max(0, S.score - S.cfg.target) });
    progressFill.style.width = clamp(Math.max(0, S.score - S.cfg.target) / 12 * 100, 0, 100) + "%";
    return;
  }
  levelPill.textContent = I18N.t("hud_level", { n: S.level, t: S.cfg.target, sky: S.mode === "sky" ? " • SKY" : "" });
  progressFill.style.width = clamp(S.score / S.cfg.target * 100, 0, 100) + "%";
}

/* Classic/Sky-lägesväljare (Phase 0: separata rekord, identiskt spel). */
function setMode(m) {
  if (m !== "classic" && m !== "sky") return;
  const changed = m !== S.mode;
  S.mode = m;
  S.best = store.bestFor(S.mode, S.level);
  syncModeBtns();
  if (changed && window.Analytics) Analytics.emit("mode_change", { mode: m });
  if (S.state === "menu") refreshMenu();
  try {
    if (worldsOv && !worldsOv.hidden) renderWorlds();
    if (levelsOv && !levelsOv.hidden) renderLevelGrid();
    if (S.state === "menu") refreshMenu();
  } catch (e) {}
}
function syncModeBtns() {
  const pairs = [["modeClassicBtn", "modeClassicBtn2", "classic"], ["modeSkyBtn", "modeSkyBtn2", "sky"]];
  for (const [a, b, m] of pairs) {
    for (const id of [a, b]) {
      const el = $(id);
      if (!el) continue;
      const on = S.mode === m;
      el.style.background = on ? "linear-gradient(180deg,#ffd45e,#ffb830)" : "";
      el.style.borderColor = on ? "#2b2118" : "";
      el.style.opacity = on ? "1" : "0.75";
    }
  }
}

function doPause() {
  if (S.state !== "playing" && S.state !== "ready" && S.state !== "countdown") return;
  Econ.flush(); // Gate C: spara buffert vid paus
  S.pausedFrom = S.state === "countdown" ? "playing" : S.state;
  S.state = "paused";
  hideCountdown();
  hideAll(); pauseOv.hidden = false;
}
/* A8 (P1-7): 3-2-1 innan spelet fortsätter. Världen står still; tryck ignoreras. */
const COUNTDOWN_S = 3;
function showCountdownNum(n) {
  const el = document.getElementById("countdown"); if (!el) return;
  if (el.textContent !== String(n)) {
    el.textContent = String(n);
    if (!reducedMotion()) { el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); }
  }
  el.hidden = false;
}
function hideCountdown() { const el = document.getElementById("countdown"); if (el) el.hidden = true; }
function doResume() {
  if (S.state !== "paused") return;
  const to = S.pausedFrom || "playing";
  hideAll();
  hud.hidden = false;
  if (to === "ready") { S.state = "ready"; readyOv.hidden = false; return; }
  if (S.rotateBlocked) { S.state = "paused"; pauseOv.hidden = false; return; }
  S.state = "countdown"; S.countdownT = COUNTDOWN_S;
  showCountdownNum(COUNTDOWN_S);
}

function gameOver(hitGround) {
  if (S.state !== "playing") return;
  if (S.simMode) { S.simResult = S.simResult || (hitGround ? "crash-ground" : "crash"); return; }
  if (S.runMode === "daily") Daily.end(false); // before anything moves: the receipt hash must match the Sim replay
  S.state = "dying";
  S.deathT = 0;
  AudioFX.hit();
  flash(0.7);
  if (!reducedMotion()) { S.shake = 14; S.shakeT = 0.45; } // a11y: ingen skakning i reducerat läge
  burst(S.bird.x, S.bird.y, 14, true);
  if (!hitGround) AudioFX.fall();
  tutorial.hidden = true;
}

function showGameOver() {
  S.state = "gameover";
  Econ.flush(); // Gate C: krasch sparar intjänade fjädrar (ingen bonus vid krasch)
  if (S.runMode === "daily") { hud.hidden = true; return Daily.open(); } // own result panel, no revive, no records
  if (S.runMode === "endless") return showEndlessOver();
  if (S.overdrive) return showOverdriveOver();
  const isBest = store.setBestFor(S.mode, S.level, S.score);
  hideAll(); overOv.hidden = false; hud.hidden = true;
  $("overScore").textContent = S.score;
  $("overBest").textContent = store.bestFor(S.mode, S.level) + (isBest ? I18N.t("new_best") : "");
  $("overTarget").textContent = S.cfg.target;
  $("medal").textContent = medalEmoji(S.score, S.cfg.target);
  $("overKicker").textContent = S.score >= S.cfg.target * 0.7 ? I18N.t("over_kicker_close") : I18N.t("over_kicker_over");
  $("overTitle").textContent = S.score === 0 ? I18N.t("over_title_0") : S.score >= 7 && S.level === 1 ? I18N.t("over_title_good") : I18N.t("over_title_bad");
  const _tips = tipsPool();
  $("overTip").textContent = _tips[Math.floor(Math.random() * _tips.length)];
  /* Phase 1A: visa sparade fjädrar från försöket (ingen bonus vid krasch). */
  S.overEarned = Econ.runEarned;
  try {
    const oe = $("overEarned");
    if (oe) {
      if (S.overEarned > 0) { oe.hidden = false; oe.textContent = I18N.t("over_earned", { n: S.overEarned }); }
      else oe.hidden = true;
    }
  } catch (e) {}
  if (window.Analytics) Analytics.emit("crash", { level: S.level, score: S.score, mode: S.mode });
  if (window.Analytics && S.overEarned > 0) Analytics.emit("feather_run", { level: S.level, mode: S.mode,
    result: "crash", pipes: Econ.runPipes, pipeFeathers: S.overEarned, bonus: 0, earned: S.overEarned });
}
/* Gate D: endless-krasch — egen rekordtabell, omedelbar omstart. */
function endlessMedal(score) {
  if (score >= 100) return "🏆";
  if (score >= 50) return "🥇";
  if (score >= 25) return "🥈";
  if (score >= 10) return "🥉";
  return "🐣";
}
function showEndlessOver() {
  const isBest = store.setEndlessBest(S.mode, S.score);
  S.endlessIsBest = !!isBest;
  hideAll(); overOv.hidden = false; hud.hidden = true;
  $("overScore").textContent = S.score;
  $("overBest").textContent = store.endlessBest(S.mode) + (isBest ? I18N.t("new_best") : "");
  $("overTarget").textContent = "∞";
  $("medal").textContent = endlessMedal(S.score);
  $("overKicker").textContent = isBest ? I18N.t("endless_newbest") : I18N.t("endless_over");
  $("overTitle").textContent = I18N.t("endless_over_title", { s: S.score });
  const _tips = tipsPool();
  $("overTip").textContent = _tips[Math.floor(Math.random() * _tips.length)];
  S.overEarned = Econ.runEarned;
  try {
    const oe = $("overEarned");
    if (oe) {
      if (S.overEarned > 0) { oe.hidden = false; oe.textContent = I18N.t("over_earned", { n: S.overEarned }); }
      else oe.hidden = true;
    }
  } catch (e) {}
  if (window.Analytics) Analytics.emit("endless_crash", { score: S.score, mode: S.mode, best: isBest });
}
/* Gate D: overdrive-krasch — marginalen avgör medaljen (1–3★, höjer endast). */
function showOverdriveOver() {
  const base = Number.isFinite(S.odBaseTarget) ? S.odBaseTarget : S.cfg.target; // A1: aldrig Infinity
  const margin = Math.max(0, S.score - base);
  const stars = starCount(S.score, base);
  const saved = store.setMedal(S.mode, S.level, Math.max(1, stars));
  const isBest = store.setBestFor(S.mode, S.level, S.score); // A1: overdrive-poäng är nivåns rekord
  S.best = store.bestFor(S.mode, S.level);
  hideAll(); overOv.hidden = false; hud.hidden = true;
  $("overScore").textContent = S.score;
  $("overBest").textContent = S.best + (isBest ? I18N.t("new_best") : "");
  $("overTarget").textContent = base + " (+" + margin + ")";
  $("medal").textContent = medalEmoji(S.score, base);
  $("overKicker").textContent = I18N.t("over_od_kicker");
  $("overTitle").textContent = stars >= 3 ? I18N.t("over_od_3") : stars === 2 ? I18N.t("over_od_2") : I18N.t("over_od_1");
  $("overTip").textContent = I18N.t("over_od_tip", { m: Math.max(0, margin), s: starStr(saved) });
  S.overEarned = Econ.runEarned;
  try {
    const oe = $("overEarned");
    if (oe) {
      if (S.overEarned > 0) { oe.hidden = false; oe.textContent = I18N.t("over_earned", { n: S.overEarned }); }
      else oe.hidden = true;
    }
  } catch (e) {}
  if (window.Analytics) Analytics.emit("overdrive_crash", { level: S.level, score: S.score, margin, stars: saved, mode: S.mode });
}

function levelClear() {
  if (S.state !== "playing") return;
  if (S.simMode) { S.simResult = "clear"; return; }
  if (S.runMode === "daily") { Daily.end(true); S.state = "clear"; S.clearT = 0; AudioFX.fanfare(); confetti(); tutorial.hidden = true; return; }
  S.state = "clear";
  S.clearT = 0;
  AudioFX.fanfare();
  confetti();
  Econ.flush(); // Gate C: spara hinderfjädrar före förstaclear-bonusen
  const isBest = store.setBestFor(S.mode, S.level, S.score);
  S.clearIsNewBest = !!isBest;
  store.setCleared(S.mode, S.level); // replay avklarar utan att röra unlock
  store.setMedal(S.mode, S.level, 1); // Gate D: clear = minst 1★ (fler kräver overdrive)
  if (store.unlocked < S.level + 1) store.unlocked = S.level + 1; // höj endast — sänk aldrig
  /* Phase 1A: förstaclear-bonus (exakt en gång per läge+nivå) + run-summering. */
  S.clearPipesEarned = Econ.runEarned;
  S.clearBonus = Econ.awardFirstClear();
  S.clearTotalEarned = S.clearPipesEarned + S.clearBonus;
  S.clearIsWorldFinal = Progress.isWorldFinal(S.level);
  S.clearWorldId = Progress.worldDefForLevel(S.level).id;
  S.clearIsMilestone = !S.clearIsWorldFinal && Progress.isMilestone(S.level);
  if (S.clearIsWorldFinal && S.clearT === 0) { confetti(); AudioFX.worldComplete(); } // större firande vid world-final
  if (S.clearIsMilestone && S.clearT === 0) { confetti(); AudioFX.milestone(); } // milstolpe: extra erkännande, samma progression
  tutorial.hidden = true;
  if (window.Analytics) Analytics.emit("clear", { level: S.level, score: S.score, mode: S.mode,
    worldFinal: S.clearIsWorldFinal, milestone: S.clearIsMilestone });
  if (window.Analytics) Analytics.emit("feather_run", { level: S.level, mode: S.mode, result: "clear",
    pipes: Econ.runPipes, pipeFeathers: S.clearPipesEarned, bonus: S.clearBonus, earned: S.clearTotalEarned });
  if (S.clearIsWorldFinal && window.Analytics) Analytics.emit("world_unlock", { world: S.level + 1 });
}

/* Gate D: medaljer mäter MÄSTERSKAP, inte bara avklarad nivå.
   ★ = clear (mål nått). ★★ = overdrive +5. ★★★ = overdrive +12.
   En vanlig clear ger alltid exakt 1 stjärna — för fler måste spelaren
   fortsätta samma runda via OVERDRIVE och riskera allt. */
function starCount(score, target) {
  if (!(score >= target)) return 0;
  const m = score - target;
  if (m >= 12) return 3;
  if (m >= 5) return 2;
  return 1;
}
function starStr(n) { return n > 0 ? "★".repeat(n) + "☆".repeat(3 - n) : "☆☆☆"; }

function medalForScore(score, target) { return medalFor(score, target); }

function showClearPanel() {
  hideAll(); clearOv.hidden = false; hud.hidden = true;
  const wi = WORLD_INFO[S.worldKey];
  const isFinal = !!S.clearIsWorldFinal;
  const nextDef = Progress.nextWorldAfter(S.level);
  const card = $("clearCard");
  if (card) card.classList.toggle("world-complete", isFinal);
  if ($("clearPill")) $("clearPill").textContent = isFinal ? I18N.t("clear_pill_world", { w: wi.name.toUpperCase() }) :
    (S.clearIsMilestone ? I18N.t("clear_pill_milestone", { n: S.level }) : I18N.t("clear_pill"));
  $("clearTitle").textContent = isFinal ? (I18N.t("clear_title_world", { i: wi.icon })) :
    (S.clearIsMilestone ? I18N.t("clear_title_milestone") : I18N.t("clear_title"));
  if ($("clearWorldTag")) $("clearWorldTag").textContent = I18N.t("clear_tag", { i: wi.icon, n: S.level, name: wi.name });
  // stjärnor (animerade — trigga om animationen varje gång)
  const stars = $("clearStars");
  if (stars) {
    const n = starCount(S.score, S.cfg.target);
    const spans = stars.querySelectorAll(".star");
    spans.forEach((sp, i) => {
      sp.classList.remove("earned");
      void sp.offsetWidth;
      if (i < n) sp.classList.add("earned");
    });
  }
  if ($("clearNewBest")) $("clearNewBest").hidden = !S.clearIsNewBest;
  $("medalClear").textContent = medalEmoji(S.score, S.cfg.target);
  $("clearScore").textContent = S.score;
  if ($("clearObstacles")) $("clearObstacles").textContent = S.score; // 1 poäng = 1 passerat hinder
  $("clearBest").textContent = store.bestFor(S.mode, S.level) + (S.clearIsNewBest ? I18N.t("new_best") : "");
  // nästa destination (aldrig autostart — spelaren väljer)
  const nxt = S.level + 1;
  const nwi = WORLD_INFO[worldForLevel(nxt)];
  $("clearNext").textContent = nwi ? I18N.t("clear_next_level", { n: nxt, w: nwi.name, i: nwi.icon }) : "—";
  // world-final: presentera den nyss upplåsta världen
  const nwCard = $("nextWorldCard");
  if (nwCard) {
    if (isFinal && nextDef) {
      const ninfo = WORLD_INFO[nextDef.id];
      nwCard.hidden = false;
      if ($("nextWorldArt")) {
        let nstyle = worldArtStyle(nextDef.id);
        try {
          const W = window.Worlds;
          if (W && W.showcaseFor) {
            const env = W.showcaseFor(nextDef.id);
            if (env) { const t = W.thumbnail(env, W.showcaseLevel(nextDef.id), 360, 120); if (t) nstyle += "background-image:url('" + t + "');"; }
          }
        } catch (e) {}
        $("nextWorldArt").setAttribute("style", nstyle);
        $("nextWorldArt").textContent = ninfo.icon;
      }
      if ($("nextWorldName")) $("nextWorldName").textContent = I18N.t("next_world_name", { w: ninfo.name, i: ninfo.icon });
      if ($("nextWorldTag")) $("nextWorldTag").textContent = I18N.t("next_world_tag", { tag: ninfo.tag, n: nextDef.start });
      const nb = $("nextBtn");
      if (nb) nb.innerHTML = I18N.t("next_explore", { w: ninfo.name.toUpperCase(), i: ninfo.icon });
    } else {
      nwCard.hidden = true;
      const nb = $("nextBtn");
      if (nb) nb.innerHTML = I18N.t("next_continue", { n: nxt });
    }
  } else {
    const nb = $("nextBtn");
    if (nb) nb.innerHTML = I18N.t("next_continue", { n: nxt });
  }
  if ($("clearRetryBtn")) $("clearRetryBtn").innerHTML = I18N.t("play_again", { n: S.level });
  // Gate D: OVERDRIVE — fortsätt rundan för medaljjakt (+5 ⇒ ★★, +12 ⇒ ★★★)
  const odb = $("overdriveBtn");
  if (odb) {
    odb.innerHTML = I18N.t("overdrive_btn");
    odb.title = I18N.t("overdrive_hint");
    odb.onclick = () => { resumeOverdrive(); };
  }
  // world-final: replay-knappen för HELA den avklarade världen (nivåväljare);
  // annars: genväg till världskartan. (Play again = alltid samma nivå.)
  const cwb = $("clearWorldsBtn");
  if (cwb) {
    if (isFinal && S.clearWorldId) {
      const cdone = WORLD_INFO[S.clearWorldId];
      cwb.innerHTML = I18N.t("replay_world", { w: cdone ? cdone.name : "" });
      cwb.onclick = () => { AudioFX.ensure(); AudioFX.click(); openLevels(S.clearWorldId); };
    } else {
      cwb.innerHTML = I18N.t("worlds_btn");
      cwb.onclick = () => { AudioFX.ensure(); AudioFX.click(); openWorlds(); };
    }
  }
  // Phase 1A: verkliga belöningar (aldrig fejkade köp/knappar).
  const rslot = $("clearRewardSlot");
  if (rslot) {
    const parts = [];
    if ((S.clearPipesEarned | 0) > 0) parts.push(I18N.t("clear_earned", { n: S.clearPipesEarned }));
    if ((S.clearBonus | 0) > 0) parts.push("<b>" + I18N.t("clear_bonus", { n: S.clearBonus }) + "</b>");
    if (parts.length) {
      rslot.hidden = false;
      rslot.innerHTML = "🪶 " + parts.join(" &nbsp;•&nbsp; ") + ' &nbsp;<span style="opacity:.7">(Σ ' + Econ.bal + " 🪶)</span>";
    } else rslot.hidden = true;
  }
}

/* ============================================================
   Idea 5 – TODAY'S COURSE (Dagens bana) + spoiler-free share card + E2 run receipt.
   - Same UTC-date seed for everyone: RNG.dailySeed(date [+ "#salt"]) (prefix "dipwing-daily-v1-").
   - 18–24 obstacles. Difficulty band: Monday calm (L5–7), Saturday sharp (L12–15), otherwise L6–13.
     Never L18+ (no saw/laser pressure, no gap floor 105).
   - The date is locked when the run is set up; a run past midnight counts for the day it started.
   - Unlimited attempts; today's BEST counts. Own records (pfb_daily_v1): never touches level/endless records,
     medals, unlocks or first-clear.
   - 25 🪶 once per UTC day for the first clear (keyed on the session-guarded economy day; no pay on clock skew).
     Obstacle feathers use the normal per-day tiers. Sharing never pays anything.
   - No revive, no ads. Seed never shown. Result labelled UNVERIFIED everywhere.
   - E2 receipt (pfb_receipt_v1): flap physics-step indices + score + Sim hash of the best run; replays locally with Sim.
   - Days the fine planner could not clear are re-salted from the pre-checked calendar below
     (tools/daily/check-days.mjs). Days outside the calendar are playable but labelled "not pre-checked".
   Flag: ?daily=0 or localStorage pfb_daily_course="0" hides the mode (nothing else changes).
   ============================================================ */
const DAILY_CAL = /* @daily-calendar:begin */ {"from":"2026-11-09","to":"2027-04-07","salt":{},"hard":{"2026-11-15":1,"2026-11-22":1,"2026-12-05":1,"2026-12-19":1,"2026-12-22":1,"2026-12-29":1,"2026-12-30":1,"2027-01-07":1,"2027-01-16":1,"2027-01-17":1,"2027-01-19":1,"2027-02-02":1,"2027-02-03":1,"2027-02-06":1,"2027-02-09":1,"2027-02-13":1,"2027-02-27":1,"2027-02-28":1,"2027-03-04":1,"2027-03-10":1,"2027-03-19":1,"2027-03-20":1,"2027-03-25":1}} /* @daily-calendar:end */;
const DAILY_ON = (function () {
  try { const q = new URLSearchParams(location.search).get("daily"); if (q === "0") return false; if (q === "1") return true;
    return SafeStorage.get("pfb_daily_course") !== "0"; } catch (e) { return true; }
})();
const courseOv = document.getElementById("courseOv");
const Daily = {
  ON: DAILY_ON, KEY: "pfb_daily_v1", RKEY: "pfb_receipt_v1", SQUARES: 12, NEAR_PX: 8, SLOW_RATIO: 0.9,
  cal: DAILY_CAL,
  today() { return new Date().toISOString().slice(0, 10); },
  mix(h) { h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); return (h ^ (h >>> 16)) >>> 0; },
  info(date, saltOverride) {
    const salt = saltOverride != null ? saltOverride | 0 : (DAILY_CAL.salt[date] | 0);
    const seed = window.RNG.dailySeed(date + (salt ? "#" + salt : ""));
    const wd = new Date(date + "T12:00:00Z").getUTCDay();
    const h = this.mix(seed);
    const kind = wd === 1 ? "calm" : wd === 6 ? "sharp" : "normal";
    const dl = kind === "calm" ? 5 + (h % 3) : kind === "sharp" ? 12 + (h % 4) : 6 + (h % 8);
    const target = 18 + ((h >>> 8) % 7);
    const checked = !!(DAILY_CAL.from && date >= DAILY_CAL.from && date <= DAILY_CAL.to);
    return { date, salt, seed, kind, dl, target, checked, hard: !!DAILY_CAL.hard[date] };
  },
  cfg(info) { const c = levelConfig(info.dl); c.target = info.target; c.daily = true; return c; },
  /* put the (live or Sim) state into daily mode — identical in both, so receipts replay exactly */
  apply(info) { S.runMode = "daily"; S.diff = info.dl; S.overdrive = false; S.odBaseTarget = null; S.cfg = this.cfg(info); S.dailyInfo = info; },
  /* ---------- storage (own key; old builds ignore it ⇒ rollback-safe) ---------- */
  load() {
    let d = null; try { d = JSON.parse(SafeStorage.get(this.KEY) || "null"); } catch (e) { d = null; }
    if (!d || typeof d !== "object" || d.v !== 1) d = { v: 1, date: null, attempts: 0, best: null, last: null, paid: null, days: {} };
    if (!d.days || typeof d.days !== "object") d.days = {};
    return d;
  },
  save(d) {
    const keys = Object.keys(d.days).sort(); while (keys.length > 60) delete d.days[keys.shift()]; // keep 60 days of own history
    try { SafeStorage.set(this.KEY, JSON.stringify(d)); } catch (e) {}
  },
  forDate(date) { const d = this.load(); if (d.date !== date) { d.date = date; d.attempts = 0; d.best = null; d.last = null; } return d; },
  better(a, b) { // a better than b?
    if (!b) return true;
    if (!!a.cleared !== !!b.cleared) return !!a.cleared;
    if (a.score !== b.score) return a.score > b.score;
    return a.cleared && a.ticks < b.ticks;
  },
  squares(r) {
    const N = r.target, out = [];
    for (let i = 0; i < this.SQUARES; i++) {
      const a = Math.floor(i * N / this.SQUARES), b = Math.max(a + 1, Math.floor((i + 1) * N / this.SQUARES));
      let st = "ok";
      if (!r.cleared && r.score >= a && r.score < b) st = "crash";
      else if (!r.cleared && r.score < a) st = "none";
      else for (let k = a; k < b; k++) if ((r.marks || "")[k] === "w") st = "warn";
      out.push(st);
    }
    return out;
  },
  /* ---------- live run ---------- */
  showReady() {
    if (!this.ON) return showMenu();
    const info = this.info(this.today());
    setLevel(info.dl);
    this.apply(info);
    S.state = "ready";
    S.score = 0; S.pipes = []; S.particles = []; S.popups = [];
    S.camX = 0; S.shake = 0; S.prevGapY = null;
    S.ptime = 0; S.__stepIdx = 0; LIVE_ACC.acc = 0; S.liveStep = 0;
    S.spawnLastFam = null; S.spawnCount = 0; S.simResult = null;
    S.attempt++;
    S.runSeed = info.seed; window.RNG.reset(S.runSeed);
    S.dailyFlaps = []; S.dailyMarks = []; S.dailyWall = 0; S.dailyEnded = false;
    resetBird();
    Econ.resetRun();
    hideAll(); readyOv.hidden = false; hud.hidden = false;
    updateHUD();
    const d = this.forDate(info.date);
    $("readyPill").textContent = I18N.t("course_pill");
    $("readyTitle").textContent = I18N.t("course_ready_title", { date: info.date });
    $("readyDesc").innerHTML = I18N.t("course_ready_desc", { n: info.target, kind: I18N.t("course_kind_" + info.kind) }) +
      "<br>" + I18N.t("course_best_line", { b: d.best ? d.best.score : 0, n: info.target, t: d.attempts }) +
      "<br><span class='tiny'>" + I18N.t("course_midnight") + "</span>"; // no seed line (E: hide seed in daily UI)
    $("readyBtn").innerHTML = I18N.t("course_play");
    tutorial.hidden = true;
    hideCoachTip(false);
  },
  /* called from startPlaying for daily runs: fixed start state so the receipt replays in Sim */
  onStart() {
    S.bird.y = S.H * 0.44; S.bird.vy = 0; S.bird.rot = 0; S.camX = 0;
    S.dailyWall = 0; // real seconds spent in "playing" (fed by the main loop, unclamped) → slow-motion check
  },
  onFlap() { if (S.runMode === "daily" && S.state === "playing" && S.dailyFlaps) S.dailyFlaps.push(S.liveStep | 0); },
  /* per physics step (live + Sim): closest approach to an opening edge while inside an obstacle */
  track(br) {
    for (const ob of S.pipes) {
      if (ob.passed || S.bird.x + br <= ob.x + 4 || S.bird.x - br >= ob.x + ob.w - 4) continue;
      const mod = window.OBSTACLES[ob.fam];
      const g = mod.gapNow ? mod.gapNow(ob) : { top: ob.gapY - ob.gap / 2, bot: ob.gapY + ob.gap / 2 };
      const clr = Math.min(S.bird.y - br - (g.top + 3), (g.bot - 3) - (S.bird.y + br));
      ob._clr = ob._clr == null ? clr : Math.min(ob._clr, clr);
    }
  },
  onPassed(ob) { if (!S.simMode && S.dailyMarks) S.dailyMarks.push(ob._clr != null && ob._clr < this.NEAR_PX ? "w" : "o"); },
  /* run end (live only). cleared = reached the target. Called BEFORE any post-run animation touches the state. */
  end(cleared) {
    if (S.dailyEnded || S.simMode || S.runMode !== "daily") return;
    S.dailyEnded = true;
    const info = S.dailyInfo;
    const ratio = S.dailyWall > 0.5 ? Math.min(1.5, S.ptime / S.dailyWall) : 1;
    const r = { date: info.date, salt: info.salt, target: info.target, score: S.score, cleared: !!cleared,
      ticks: S.liveStep | 0, marks: (S.dailyMarks || []).join(""), slow: ratio < this.SLOW_RATIO, ratio: +ratio.toFixed(3) };
    const receipt = { v: 1, fmt: "dipwing-daily-receipt", build: window.GAME_VERSION || "?", date: info.date, salt: info.salt,
      dl: info.dl, target: info.target, steps: (S.dailyFlaps || []).slice(0, 20000), score: S.score, cleared: !!cleared,
      ticks: S.liveStep | 0, hash: Sim.hash() };
    Econ.flush();
    const d = this.forDate(info.date);
    d.attempts++; d.last = r;
    let isBest = false;
    if (this.better(r, d.best)) { d.best = r; isBest = true; try { SafeStorage.set(this.RKEY, JSON.stringify(receipt)); } catch (e) {} }
    d.days[info.date] = { best: d.best.score, target: info.target, cleared: !!d.best.cleared, attempts: d.attempts };
    // first clear of the day pays once. Keyed on the session-guarded economy day; nothing on clock skew.
    let paid = 0;
    if (cleared && d.paid !== info.date) {
      let day = null; try { day = Econ.econDay().day; } catch (e) {}
      if (day === info.date && !Econ.clockSkew() && (!d.paid || info.date > d.paid)) {
        d.paid = info.date; this.save(d); // write the claim first: a crash between can only lose 25, never double-pay
        const amt = (window.ECON && ECON.rewards && ECON.rewards.dailyCourse) | 0;
        if (amt > 0 && window.SaveV2) { SaveV2.addFeathers(amt); paid = amt; Econ.refreshFeatherUI(); }
      }
    }
    this.save(d);
    S.dailyResult = { r, isBest, paid };
    if (window.Analytics) Analytics.emit("daily_course_end", { cleared: !!cleared, score: S.score, target: info.target, attempts: d.attempts });
  },
  /* ---------- receipt replay (E2): local only, proves nothing to anyone else ---------- */
  receipt() { try { return JSON.parse(SafeStorage.get(this.RKEY) || "null"); } catch (e) { return null; } },
  verify(rc) {
    if (!rc || rc.v !== 1 || !Array.isArray(rc.steps)) return { ok: false, why: "format" };
    const info = this.info(rc.date, rc.salt);
    if (info.dl !== rc.dl || info.target !== rc.target) return { ok: false, why: "course" };
    const set = new Set(rc.steps);
    Sim.begin(info.seed, info.dl, 800); this.apply(info);
    let t = 0, out;
    try { for (; t < 120 * 600 && !S.simResult && S.state === "playing"; t++) Sim.tick(set.has(t));
      out = { score: S.score, result: S.simResult, ticks: t, hash: Sim.hash() }; }
    finally { Sim.end(); }
    out.ok = out.score === rc.score && out.hash === rc.hash && (out.result === "clear") === !!rc.cleared;
    return out;
  },
  /* ---------- share (spoiler-free; never rewarded) ---------- */
  EMOJI: { ok: "🟩", warn: "🟨", crash: "🟧", none: "⬜" },
  shareText(r, attempts) {
    const sq = this.squares(r).map(s => this.EMOJI[s]).join("");
    return [I18N.t("share_head", { date: r.date }), sq, I18N.t(attempts === 1 ? "share_score_one" : "share_score", { s: r.score, n: r.target, t: attempts }) + (r.slow ? " · " + I18N.t("share_slow") : ""),
      I18N.t("share_unverified")].join("\n");
  },
  card(r, attempts) { // 1080×1350 PNG canvas, Dipwing palette. No seed, layout, name or device id.
    const W = 1080, H = 1350, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const c = cv.getContext("2d"), C = (window.IDENTITY && IDENTITY.C) || {};
    const ink = C.ink || "#1A1433", cream = "#FFF8EC", col = { ok: "#2FB59A", warn: "#FFC23D", crash: C.coral || "#FF6B4A", none: "#D9D3E6" };
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, C.tornis || "#3B4CC0"); g.addColorStop(1, C.tornisDeep || "#232B7A");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const rr = (x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
    c.fillStyle = cream; c.strokeStyle = ink; c.lineWidth = 10; rr(70, 150, W - 140, H - 300, 56); c.fill(); c.stroke();
    c.textAlign = "center"; c.fillStyle = cream; c.font = "800 92px 'Baloo 2', system-ui, sans-serif"; c.fillText("dipwing", W / 2, 118);
    c.fillStyle = ink; c.font = "800 58px 'Baloo 2', system-ui, sans-serif"; c.fillText(I18N.t("card_title"), W / 2, 260);
    c.font = "600 40px Nunito, system-ui, sans-serif"; c.fillText(r.date + " (UTC)", W / 2, 320);
    const sq = this.squares(r), S0 = 170, gap = 28, gx = (W - (4 * S0 + 3 * gap)) / 2;
    sq.forEach((s, i) => { const x = gx + (i % 4) * (S0 + gap), y = 380 + Math.floor(i / 4) * (S0 + gap);
      c.fillStyle = col[s]; c.lineWidth = 8; c.strokeStyle = ink; rr(x, y, S0, S0, 30); c.fill(); c.stroke(); });
    c.fillStyle = ink; c.font = "800 120px 'Baloo 2', system-ui, sans-serif"; c.fillText(r.score + "/" + r.target, W / 2, 1060);
    c.font = "600 42px Nunito, system-ui, sans-serif";
    c.fillText(I18N.t(attempts === 1 ? "card_tries_one" : "card_tries", { t: attempts }) + (r.cleared ? " · ✓" : "") + (r.slow ? " · " + I18N.t("share_slow") : ""), W / 2, 1125);
    c.fillStyle = C.coral || "#FF6B4A"; rr(W / 2 - 330, 1158, 660, 70, 35); c.fill();
    c.fillStyle = "#fff"; c.font = "800 34px Nunito, system-ui, sans-serif"; c.fillText(I18N.t("card_unverified"), W / 2, 1205);
    c.fillStyle = cream; c.font = "600 30px Nunito, system-ui, sans-serif"; c.fillText(I18N.t("card_foot"), W / 2, 1300);
    return cv;
  },
  /* ---------- course panel (menu entry + after every run) ---------- */
  open() {
    if (!this.ON || !courseOv) return;
    AudioFX.ensure(); hideAll(); hud.hidden = true;
    this.render(); courseOv.hidden = false;
  },
  render() {
    const info = this.info(this.today()), d = this.forDate(info.date), res = S.dailyResult;
    const showRes = res && res.r.date === info.date && S.runMode === "daily" && S.dailyEnded;
    $("courseSub").textContent = I18N.t("course_sub", { date: info.date, kind: I18N.t("course_kind_" + info.kind), n: info.target });
    $("courseCheck").textContent = !info.checked ? I18N.t("course_unchecked") : info.hard ? I18N.t("course_hard") : "";
    $("courseCheck").hidden = !$("courseCheck").textContent;
    $("courseResult").hidden = !showRes;
    if (showRes) $("courseResult").textContent = (res.r.cleared ? I18N.t("course_result_clear", { s: res.r.score, n: res.r.target }) : I18N.t("course_result_crash", { s: res.r.score, n: res.r.target })) +
      (res.isBest && d.attempts > 1 ? " · " + I18N.t("course_newbest") : "") + (res.paid ? " · +" + res.paid + " 🪶" : "");
    const show = showRes ? res.r : d.best;
    const sqEl = $("courseSquares"); sqEl.innerHTML = "";
    if (show) for (const s of this.squares(show)) { const b = document.createElement("span"); b.className = "csq " + s; sqEl.appendChild(b); }
    sqEl.setAttribute("aria-label", show ? this.shareText(show, d.attempts).split("\n")[2] : I18N.t("course_none"));
    $("courseBest").textContent = d.best ? d.best.score + "/" + d.best.target + (d.best.cleared ? " ✓" : "") : "—";
    $("courseTries").textContent = d.attempts;
    const amt = (window.ECON && ECON.rewards && ECON.rewards.dailyCourse) | 0;
    $("courseReward").textContent = d.paid === info.date ? I18N.t("course_reward_done", { n: amt }) : I18N.t("course_reward", { n: amt });
    $("courseSlow").hidden = !(show && show.slow);
    $("coursePlayBtn").innerHTML = I18N.t(d.attempts ? "course_again" : "course_play");
    for (const id of ["courseShareBtn", "courseCopyBtn", "courseDlBtn"]) $(id).disabled = !d.best;
    $("courseShareText").value = d.best ? this.shareText(d.best, d.attempts) : "";
    $("courseShareText").hidden = true; $("courseStatus").textContent = "";
  },
  menuButton() {
    const slot = $("dailyCourseSlot"); if (!slot) return;
    if (!this.ON) { slot.innerHTML = ""; return; }
    const info = this.info(this.today()), d = this.forDate(info.date);
    let b = $("dailyCourseBtn");
    if (!b) { b = document.createElement("button"); b.id = "dailyCourseBtn"; b.className = "btn secondary"; b.type = "button";
      b.onclick = () => { AudioFX.click(); this.open(); }; slot.appendChild(b); }
    b.innerHTML = I18N.t("course_btn", { n: info.target }) + (d.best ? " · " + d.best.score + "/" + info.target + (d.best.cleared ? " ✓" : "") : "");
  },
  async share() {
    const d = this.forDate(this.today()); if (!d.best) return;
    const text = this.shareText(d.best, d.attempts);
    try {
      if (navigator.share) {
        let files = null;
        try { const blob = await new Promise(res => this.card(d.best, d.attempts).toBlob(res, "image/png"));
          const f = new File([blob], "dipwing-daily-" + d.best.date + ".png", { type: "image/png" });
          if (navigator.canShare && navigator.canShare({ files: [f] })) files = [f]; } catch (e) {}
        await navigator.share(files ? { text, files } : { text });
        $("courseStatus").textContent = I18N.t("course_shared"); return;
      }
    } catch (e) { if (e && e.name === "AbortError") return; }
    return this.copy();
  },
  async copy() {
    const d = this.forDate(this.today()); if (!d.best) return;
    const text = this.shareText(d.best, d.attempts), ta = $("courseShareText");
    ta.value = text;
    try { await navigator.clipboard.writeText(text); $("courseStatus").textContent = I18N.t("course_copied"); return true; }
    catch (e) { ta.hidden = false; ta.focus(); ta.select(); $("courseStatus").textContent = I18N.t("course_copy_fail"); return false; }
  },
  download() {
    const d = this.forDate(this.today()); if (!d.best) return;
    const cv = this.card(d.best, d.attempts);
    cv.toBlob(blob => { if (!blob) return; const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = "dipwing-daily-" + d.best.date + ".png"; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }, "image/png");
    $("courseStatus").textContent = I18N.t("course_downloaded");
  }
};
if ($("coursePlayBtn")) {
  $("coursePlayBtn").onclick = () => { AudioFX.click(); Daily.showReady(); };
  $("courseShareBtn").onclick = () => { AudioFX.click(); Daily.share(); };
  $("courseCopyBtn").onclick = () => { AudioFX.click(); Daily.copy(); };
  $("courseDlBtn").onclick = () => { AudioFX.click(); Daily.download(); };
  $("courseMenuBtn").onclick = () => { AudioFX.click(); showMenu(); };
}
/* ---------- nivåväljare (per värld) + världskarta ----------
   Allt här är UI/sparande. Låsregler: level > unlocked ⇒ låst.
   Replay sänker aldrig unlock. Bästa/cleared visas per läge (Classic/Sky). */
function magicRange() {
  const hi = Math.min(Math.max(30, store.unlocked + 1), 60);
  const out = [];
  for (let l = 21; l <= hi; l++) out.push(l);
  return out;
}
function renderLevelGrid() {
  const g = $("levelGrid");
  if (!g) return;
  g.innerHTML = "";
  const def = S.levelFilterWorld
    ? WORLD_ORDER[Progress.worldIndexForId(S.levelFilterWorld)]
    : Progress.worldDefForLevel(Math.min(S.selectedLevel, store.unlocked));
  if (!S.levelFilterWorld) S.levelFilterWorld = def.id;
  const wi = WORLD_INFO[def.id];
  if ($("levelWorldTag")) $("levelWorldTag").textContent = wi.icon + " " + wi.name;
  const rangeTxt = Number.isFinite(def.end)
    ? I18N.t("range_finite", { a: def.start, b: def.end })
    : I18N.t("range_endless", { a: def.start });
  if ($("levelWorldTitle")) $("levelWorldTitle").textContent = I18N.t("level_title", { name: wi.name, range: rangeTxt });
  if ($("levelWorldSub")) $("levelWorldSub").textContent = I18N.t("level_sub", {
    tag: wi.tag, mode: S.mode === "sky" ? "SKY" : "Classic" });
  const levels = Number.isFinite(def.end)
    ? Array.from({ length: def.end - def.start + 1 }, (_, i) => def.start + i)
    : magicRange();
  for (const i of levels) {
    const b = document.createElement("button");
    const locked = i > store.unlocked;
    const st = locked ? "locked" : Progress.levelState(i, S.mode);
    b.className = "lvl" + (locked ? " locked" : "") + (i === S.selectedLevel ? " current" : "") +
      (st === "done" ? " done" : "");
    const best = store.bestFor(S.mode, i);
    if (locked) {
      b.innerHTML = I18N.t("locked_level", { i });
    } else {
      b.innerHTML = i + "<small>" + wi.icon + (best > 0 ? " " + best : "") + "</small>" +
        (st === "done" ? '<span class="rec">' + I18N.t("level_rec_done", { b: starStr(store.medal(S.mode, i)) + " " + best }) + "</span>" : (i === store.unlocked ? '<span class="rec">' + I18N.t("level_rec_now") + "</span>" : ""));
      b.title = I18N.t("level_btn_title", { i, m: S.mode, b: best, t: levelConfig(i).target });
      b.onclick = () => { AudioFX.ensure(); AudioFX.click(); S.selectedLevel = i; renderLevelGrid(); refreshMenu(); showReady(i); };
    }
    g.appendChild(b);
  }
  if ($("worldLegend")) {
    $("worldLegend").textContent = Number.isFinite(def.end)
      ? I18N.t("level_legend", { icon: wi.icon, name: wi.name, range: rangeTxt })
      : I18N.t("level_legend_endless");
  }
}
function buildGrid() { renderLevelGrid(); } // bakåtkompatibel (boot + äldre anrop)
function openLevels(worldId) {
  const idx = Progress.worldIndexForId(worldId);
  S.levelFilterWorld = idx >= 0 ? worldId : Progress.worldDefForLevel(Math.min(S.selectedLevel, store.unlocked)).id;
  hideAll(); renderLevelGrid(); levelsOv.hidden = false;
}
function statusPill(st, isNext) {
  if (st.key === "done") return '<span class="wstat done">' + I18N.t("status_done") + "</span>";
  if (st.key === "current") return '<span class="wstat current">' + I18N.t("status_current") + "</span>" +
    (st.isNew ? ' <span class="wstat new">' + I18N.t("status_new") + "</span>" : "");
  if (isNext) return '<span class="wstat next">' + I18N.t("status_next") + "</span>";
  return '<span class="wstat locked">' + I18N.t("status_locked") + "</span>";
}
function renderWorlds() {
  const g = $("worldGrid");
  if (!g) return;
  g.innerHTML = "";
  const un = store.unlocked;
  const firstLockedIdx = WORLD_ORDER.findIndex(d => un < d.start); // nästa värld att låsa upp
  WORLD_ORDER.forEach((def, idx) => {
    const wi = WORLD_INFO[def.id];
    const st = Progress.worldStatus(def, S.mode);
    const pr = Progress.worldProgress(def, S.mode);
    const playable = un >= def.start;
    const isNext = idx === firstLockedIdx;
    const card = document.createElement("div");
    card.className = "world-card" + (st.key === "done" ? " done" : "") +
      (st.key === "current" ? " current" : "") + (!playable ? " locked" : "");
    const rangeTxt = Number.isFinite(def.end)
      ? I18N.t("world_range", { r: I18N.t("range_finite", { a: def.start, b: def.end }) })
      : I18N.t("world_range_endless");
    const progTxt = pr.endless
      ? I18N.t("world_prog_endless", { m: S.mode, b: store.bestFor(S.mode, 21) || 0 })
      : I18N.t("world_prog", { d: pr.done, t: pr.total, b: (() => {
          let b = 0; for (let l = def.start; l <= def.end; l++) b = Math.max(b, store.bestFor(S.mode, l)); return b;
        })() });
    // VERKLIG miljökonst som miniatyr (renderad offscreen); fallback = gradient.
    let artExtra = "";
    try {
      const W = window.Worlds;
      if (W && W.showcaseFor) {
        const env = W.showcaseFor(def.id);
        if (env) { const t = W.thumbnail(env, W.showcaseLevel(def.id), 148, 148); if (t) artExtra = "background-image:url('" + t + "');"; }
      }
    } catch (e) {}
    const reqTxt = !playable
      ? I18N.t("world_req_locked", { w: WORLD_INFO[WORLD_ORDER[idx - 1].id].name })
      : (st.key === "done" ? I18N.t("world_req_done") : wi.tag);
    card.innerHTML =
      '<div class="world-art' + (!playable ? " locked-art" : "") + '" style="' + worldArtStyle(def.id) + artExtra + '">' +
        wi.icon + (!playable ? '<span class="lock">🔒</span>' : "") + "</div>" +
      '<div class="world-meta"><b>' + wi.name + "</b><small>" + rangeTxt + "</small>" +
        '<div class="world-prog">' + progTxt + "</div>" + statusPill(st, isNext) +
        '<div class="world-prog" style="font-weight:700;color:#8a755a;">' + reqTxt + "</div></div>";
    const go = document.createElement("div");
    go.className = "world-go";
    if (playable) {
      const lv = document.createElement("button");
      lv.className = "wbtn ghost";
      lv.textContent = I18N.t("world_levels_btn");
      lv.onclick = () => { AudioFX.ensure(); AudioFX.click(); openLevels(def.id); };
      const pl = document.createElement("button");
      pl.className = "wbtn";
      pl.textContent = I18N.t("world_play_btn");
      pl.onclick = () => {
        AudioFX.ensure(); AudioFX.click();
        const target = Math.max(def.start, Math.min(un, Number.isFinite(def.end) ? def.end : un));
        S.selectedLevel = target; S.levelFilterWorld = def.id;
        refreshMenu(); showReady(target);
      };
      go.appendChild(pl); go.appendChild(lv);
    } else {
      const lb = document.createElement("button");
      lb.className = "wbtn"; lb.disabled = true; lb.textContent = I18N.t("world_locked_btn");
      go.appendChild(lb);
    }
    card.appendChild(go);
    g.appendChild(card);
  });
  if ($("worldsSub")) {
    const cur = Progress.worldDefForLevel(Math.min(Math.max(1, un), 999));
    const cw = WORLD_INFO[cur.id];
    $("worldsSub").textContent = I18N.t("worlds_sub_here", { w: cw.name, i: cw.icon, u: un });
  }
}
function openWorlds() { hideAll(); renderWorlds(); worldsOv.hidden = false; }
function showWorlds() { openWorlds(); } // alias
function openSettings() { hideAll(); syncSettingsUI(); settingsOv.hidden = false; }

/* ============================================================
   Phase 1A — dagbelöning + fågelsamling (enbart UI/sparande).
   Regler: ingen autostart, inga fejkade köp, allt via SaveV2-hjälpare.
   Rör ALDRIG fysik/RNG/hinder/svårighet eller Classic/Sky-regler.
   ============================================================ */
let _confirmBird = null, _confirmTimer = 0, _birdsReturn = "menu";
function openDaily() { AudioFX.ensure(); hideAll(); renderDaily(); if (dailyOv) dailyOv.hidden = false; }
/* Gate C: samlingen kan öppnas mitt i en pausad/redo runda utan att
   rundan förloras — tillbaka-knappen återvänder dit spelaren var. */
function openBirds(returnTo) {
  AudioFX.ensure();
  _birdsReturn = (returnTo === "pause" || returnTo === "ready") ? returnTo : "menu";
  if (_birdsReturn !== "menu" && S.state !== "playing" && S.state !== "ready" && S.state !== "paused") _birdsReturn = "menu";
  hideAll(); renderBirds(); if (birdsOv) birdsOv.hidden = false;
}
function backBirds() {
  AudioFX.ensure(); AudioFX.click();
  hideAll();
  if (_birdsReturn === "pause" && (S.state === "paused" || S.state === "playing")) {
    S.state = "paused"; pauseOv.hidden = false; hud.hidden = false;
  } else if (_birdsReturn === "ready" && S.state === "ready") {
    readyOv.hidden = false; hud.hidden = false;
  } else showMenu();
}
function renderDaily() {
  const g = $("dailyGrid"); if (!g) return;
  g.innerHTML = "";
  const track = Econ.dailyTrack();
  let st = { canClaim: false, claimedTotal: 0 };
  try { st = SaveV2.dailyState(); st.canClaim = st.canClaim && Econ.sessionAllowsClaim(); } catch (e) {}
  const pos = st.claimedTotal % track.length;
  const title = $("dailyTitle"); if (title) title.textContent = I18N.t("daily_title");
  const sub = $("dailySub"); if (sub) sub.textContent = I18N.t("daily_sub");
  for (let i = 0; i < track.length; i++) {
    const card = document.createElement("div");
    const claimed = i < pos, isToday = i === pos;
    card.className = "daycard" + (claimed ? " claimed" : "") + (isToday ? " today" : "") + (!claimed && !isToday ? " locked" : "");
    card.innerHTML = '<div class="daynum">' + I18N.t("daily_day", { n: i + 1 }) + "</div>" +
      '<div class="dayreward">' + track[i] + "🪶</div>" +
      '<div class="daystate">' + (claimed ? I18N.t("daily_claimed") : (isToday ? I18N.t("daily_today") : I18N.t("daily_next"))) + "</div>";
    g.appendChild(card);
  }
  const btn = $("dailyClaimBtn"), done = $("dailyDone");
  if (btn && done) {
    if (st.canClaim) {
      btn.hidden = false; done.hidden = true;
      btn.innerHTML = I18N.t("daily_claim_btn", { n: track[pos] });
      btn.onclick = () => {
        AudioFX.ensure();
        const r = Econ.claimDaily();
        if (r.ok) {
          AudioFX.unlock();
          burst(S.W / 2, S.H * 0.3, 22, true); // fjäderskur (visas bakom kortet; skip i reduced-motion via burst-guard)
          if (window.Analytics) {} // daily_claim loggas redan i Econ.claimDaily
        } else AudioFX.click();
        renderDaily();
        try {
          const cards = g.querySelectorAll(".daycard");
          const just = cards[(st.claimedTotal) % track.length];
          if (just) { just.classList.add("just"); setTimeout(() => just.classList.remove("just"), 900); }
          const got = $("dailyGot");
          if (got && r.ok) { got.hidden = false; got.textContent = I18N.t("daily_got", { n: r.reward }); }
        } catch (e) {}
      };
    } else {
      btn.hidden = true; done.hidden = false;
      done.textContent = I18N.t("daily_done");
    }
  }
}
/* Mini-förhandsvisning av fågelskinn (SVG — samma palett som canvas, statisk). */
function birdSVG(def, px) {
  const d = Object.assign({ body: ["#ffe27a", "#ffc93f", "#f59a2e"], belly: "#fff3d0",
    wing: ["#ff9a3c", "#e86a1e"], tail: "#e88a2e", tuft: "#ff9a3c" }, def || {});
  const s = px || 84, id = "g" + d.id + Math.floor(Math.random() * 1e6);
  return '<svg width="' + s + '" height="' + Math.round(s * 0.72) + '" viewBox="0 0 84 60">' +
    '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="' + d.body[0] + '"/><stop offset=".55" stop-color="' + d.body[1] + '"/>' +
    '<stop offset="1" stop-color="' + d.body[2] + '"/></linearGradient></defs>' +
    '<ellipse cx="22" cy="32" rx="12" ry="7" fill="' + d.tail + '" stroke="#2b2118" stroke-width="2"/>' +
    '<ellipse cx="44" cy="30" rx="20" ry="16" fill="url(#' + id + ')" stroke="#2b2118" stroke-width="2.5"/>' +
    '<ellipse cx="49" cy="37" rx="10" ry="6" fill="' + d.belly + '"/>' +
    '<ellipse cx="38" cy="32" rx="11" ry="7" fill="' + d.wing[0] + '" stroke="#2b2118" stroke-width="2" transform="rotate(-18 38 32)"/>' +
    '<circle cx="55" cy="24" r="7" fill="#fff" stroke="#2b2118" stroke-width="2"/>' +
    '<circle cx="56.5" cy="24" r="3.2" fill="#232323"/>' +
    '<path d="M62 29 L73 32 L62 36 Z" fill="#ff6b4a" stroke="#2b2118" stroke-width="2"/>' +
    '<circle cx="36" cy="13" r="3" fill="' + d.tuft + '" stroke="#2b2118" stroke-width="1.6"/>' +
    '<circle cx="45" cy="12" r="3" fill="' + d.tuft + '" stroke="#2b2118" stroke-width="1.6"/></svg>';
}
/* Identity V1: real Tornis render (same code as in-game) as an <img> thumbnail, cached per look. */
const _tornisThumbs = {};
function tornisThumb(pal, size, extra) {
  const key = pal + "|" + size + "|" + JSON.stringify(extra || {});
  if (_tornisThumbs[key]) return _tornisThumbs[key];
  try {
    const cv = document.createElement("canvas"); const k = 2;
    cv.width = size * k; cv.height = Math.round(size * 0.7) * k;
    const c = cv.getContext("2d"); c.scale(k, k);
    c.translate(size * 0.52, size * 0.38);
    IDENTITY.drawTornis(c, Object.assign({ pal, palId: pal, wingDeg: -6, t: 0.3, scale: size / 66, reduced: true }, extra || {}));
    return (_tornisThumbs[key] = cv.toDataURL("image/png"));
  } catch (e) { return ""; }
}
function birdArt(def, size) {
  if (window.IDENTITY && IDENTITY.V1 && IDENTITY.BIRD_PAL[def.id]) return '<img alt="" width="' + size + '" src="' + tornisThumb(def.id, size) + '">';
  return birdSVG(def.body ? def : Econ.birdDefs().filter(d => d.id === "sunny")[0], size);
}
/* Courier Closet (idea 3, C7): tabs bird / scarf / hat / trail. With IDENTITY_V1 off only the legacy
   bird list is shown. Two-step confirm for purchases (4 s), prestige items show their requirement. */
let _closetTab = "bird";
function closetPreview(slot, def, size) {
  const eq = (() => { try { return SaveV2.cosmetics().equipped; } catch (e) { return {}; } })();
  let bird = "tornis"; try { bird = SaveV2.equippedBird(); } catch (e) {}
  if (!IDENTITY.BIRD_PAL[bird]) bird = "tornis";
  const scarfDef = Econ.cosmeticDef("scarf", eq.scarf || "coral");
  const ex = { scarf: scarfDef && scarfDef.col, scarf2: scarfDef && scarfDef.col2, hat: eq.hat || null };
  if (slot === "bird") { bird = def.id; ex.scarf = null; ex.scarf2 = null; }
  if (slot === "scarf") { ex.scarf = def.col; ex.scarf2 = def.col2 || null; }
  if (slot === "hat") ex.hat = def.id;
  if (slot === "trail") {
    const col = def.col || ex.scarf || "#FF6B4A";
    return '<svg width="' + size + '" height="' + Math.round(size * 0.7) + '" viewBox="0 0 84 58" aria-hidden="true"><path d="M8,36 Q26,18 44,30 T80,24" fill="none" stroke="#1B1F3B" stroke-width="9" stroke-linecap="round"/>' +
      '<path d="M8,36 Q26,18 44,30 T80,24" fill="none" stroke="' + col + '" stroke-width="5" stroke-linecap="round"/>' +
      (def.dots ? '<circle cx="22" cy="20" r="3" fill="' + def.dots + '"/><circle cx="48" cy="40" r="3" fill="' + def.dots + '"/><circle cx="66" cy="16" r="3" fill="' + def.dots + '"/>' : "") + "</svg>";
  }
  return '<img alt="" width="' + size + '" src="' + tornisThumb(bird, size, ex) + '">';
}
function renderBirds() {
  const g = $("birdsGrid"); if (!g) return;
  g.innerHTML = "";
  const v1 = !!(window.IDENTITY && IDENTITY.V1);
  const title = $("birdsTitle"); if (title) title.textContent = I18N.t(v1 ? "closet_title" : "birds_title");
  const sub = $("birdsSub"); if (sub) sub.textContent = I18N.t(v1 ? "closet_sub" : "birds_sub");
  let owned = ["sunny"], equipped = "sunny", bal = 0, cos = { owned: {}, equipped: {} };
  try { owned = SaveV2.ownedBirds(); equipped = SaveV2.equippedBird(); bal = Econ.bal; if (SaveV2.cosmetics) cos = SaveV2.cosmetics(); } catch (e) {}
  const bb = $("birdsBal"); if (bb) bb.textContent = "🪶 " + bal;
  let idNew = false; try { idNew = !!SaveV2.get("idNew"); } catch (e) {}
  // tabs
  const tabs = $("closetTabs");
  if (tabs) {
    tabs.hidden = !v1;
    if (!v1) _closetTab = "bird";
    tabs.innerHTML = "";
    for (const t of ["bird", "scarf", "hat", "trail"]) {
      const b = document.createElement("button");
      b.className = "ctab" + (t === _closetTab ? " on" : ""); b.type = "button";
      b.setAttribute("role", "tab"); b.setAttribute("aria-selected", t === _closetTab ? "true" : "false");
      b.textContent = I18N.t("closet_tab_" + t); b.dataset.tab = t;
      b.onclick = () => { AudioFX.ensure(); AudioFX.click(); _closetTab = t; _confirmBird = null; renderBirds(); };
      tabs.appendChild(b);
    }
  }
  const slot = _closetTab;
  let defs;
  if (slot === "bird") {
    defs = Econ.birdDefs().filter(def => {
      if (def.legacy && idNew && equipped !== def.id) return false; // Identity V1: legacy Sunny only for players who had it
      if (def.v1 && !v1) return false;                                // IDENTITY_V1 = false: legacy shop
      if (v1 && !def.v1 && !def.legacy && !IDENTITY.BIRD_PAL[def.id]) return false;
      return true;
    });
  } else defs = Econ.cosmeticDefs(slot);
  const isOwnedF = def => slot === "bird" ? owned.indexOf(def.id) >= 0 : ((cos.owned[slot] || []).indexOf(def.id) >= 0);
  const eqId = slot === "bird" ? equipped : (cos.equipped || {})[slot];
  // order: free/default, owned, then by price; prestige last
  defs.sort((x, y) => (!!x.prestige - !!y.prestige) || ((x.cost | 0) - (y.cost | 0)));
  if (slot === "hat") defs.unshift({ id: null, cost: 0, none: true });
  for (const def of defs) {
    const isOwned = def.none ? true : isOwnedF(def);
    const isEq = def.none ? !eqId : eqId === def.id;
    const card = document.createElement("div");
    card.className = "bird-card" + (isEq ? " equipped" : "") + (def.prestige ? " prestige" : "");
    const nk = slot === "bird" ? "bird_" + def.id : "cos_" + def.id;
    const name = def.none ? I18N.t("hat_none") : I18N.t(nk + "_name");
    const desc = def.none ? "" : I18N.t(nk + "_desc");
    let action = "", req = "";
    if (def.prestige) req = def.prestige.type === "clear" ? I18N.t("prestige_req_clear", { n: def.prestige.level }) : I18N.t("prestige_req_endless", { n: def.prestige.n });
    if (isEq) action = (slot === "hat" && !def.none) ? '<button class="wbtn" data-act="off">' + I18N.t("hat_off_btn") + "</button>" : '<span class="wstat current">' + I18N.t("bird_equipped") + "</span>";
    else if (isOwned) action = '<button class="wbtn" data-act="equip">' + I18N.t("bird_equip_btn") + "</button>";
    else if (def.prestige) action = Econ.prestigeMet(def.prestige) ? '<button class="wbtn" data-act="claim">' + I18N.t("prestige_claim_btn") + "</button>" : '<button class="wbtn" disabled>' + I18N.t("prestige_locked") + "</button>";
    else if (bal >= def.cost) {
      const key = slot + ":" + def.id;
      action = _confirmBird === key
        ? '<button class="wbtn" data-act="confirm">' + I18N.t("bird_confirm_btn", { n: def.cost }) + "</button>"
        : '<button class="wbtn" data-act="unlock">' + I18N.t("bird_unlock_btn", { n: def.cost }) + "</button>";
    } else action = '<button class="wbtn" disabled>' + I18N.t("bird_need", { n: def.cost - bal }) + "</button>";
    const art = def.none ? closetPreview("bird", { id: (IDENTITY.BIRD_PAL[equipped] ? equipped : "tornis") }, 84) : (v1 ? closetPreview(slot, def, 84) : birdArt(def, 84));
    card.innerHTML = '<div class="bird-art">' + art + "</div>" +
      '<div class="bird-meta"><b>' + name + "</b><small>" + desc + "</small>" +
      (req ? '<div class="bird-sub">' + req + "</div>" : (isOwned && !def.none ? '<div class="bird-sub">' + I18N.t("bird_owned") + "</div>" : "")) +
      '<div class="bird-go">' + action + "</div></div>";
    const btn = card.querySelector("[data-act]");
    if (btn) {
      const act = btn.getAttribute("data-act");
      btn.onclick = () => {
        AudioFX.ensure();
        if (act === "equip") {
          AudioFX.click();
          const ok = slot === "bird" ? Econ.equipBird(def.id) : Econ.equipCosmetic(slot, def.none ? null : def.id);
          if (ok) renderBirds();
        } else if (act === "off") { AudioFX.click(); if (Econ.equipCosmetic("hat", null)) renderBirds(); }
        else if (act === "unlock") {
          AudioFX.click();
          _confirmBird = slot + ":" + def.id;
          if (_confirmTimer) clearTimeout(_confirmTimer);
          _confirmTimer = setTimeout(() => { _confirmBird = null; try { if (birdsOv && !birdsOv.hidden) renderBirds(); } catch (e) {} }, 4000);
          renderBirds();
        } else if (act === "confirm" || act === "claim") {
          if (_confirmTimer) clearTimeout(_confirmTimer);
          _confirmBird = null;
          const r = act === "claim" ? Econ.claimPrestige(slot, def.id) : (slot === "bird" ? Econ.unlockBird(def.id) : Econ.buyCosmetic(slot, def.id));
          if (r.ok) {
            AudioFX.unlock();
            if (slot === "bird") Econ.equipBird(def.id); else Econ.equipCosmetic(slot, def.id); // unlock equips directly
          } else AudioFX.hit();
          renderBirds();
          try { const note = $("birdsNote"); if (note && r.ok) { note.hidden = false; note.textContent = I18N.t("bird_unlocked", { n: name }); } } catch (e) {}
        }
      };
    }
    g.appendChild(card);
  }
}

/* ---------- input ---------- */
function resetBird() {
  S.bird.y = S.H * 0.44;
  S.bird.vy = 0; S.bird.rot = 0; S.bird.alive = true;
}
function flap() {
  if (S.flapLock > 0) return;
  S.bird.vy = TUNE.flapVelocity;
  S.bird.wing = -0.9;
  S.bird.flapAt = S.time; // Identity V1: visual wing timing only (not hashed, not physics)
  if (S.runMode === "daily") Daily.onFlap(); // idea 5 / E2: flap logged against the physics-step index
  AudioFX.flap();
  puff(S.bird.x - 14, S.bird.y + 8, 4);
}
function onPress() {
  AudioFX.ensure();
  if (S.rotateBlocked) return; // A2: inget spel bakom rotationsspärren
  if (S.state === "ready") { startPlaying(); return; }
  if (S.state === "playing") { flap(); tutorial.hidden = true; }
}
canvas.addEventListener("pointerdown", e => { e.preventDefault(); onPress(); });
window.addEventListener("keydown", e => {
  if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
    e.preventDefault();
    if (!e.repeat) onPress();
  } else if (e.code === "KeyP" || e.code === "Escape") {
    // Esc stänger öppna kart-/inställningsvyer först (a11y), annars pausväxlar
    if (e.code === "Escape" && (levelsOv.hidden === false || worldsOv.hidden === false ||
        (typeof settingsOv !== "undefined" && settingsOv && settingsOv.hidden === false) ||
        (typeof dailyOv !== "undefined" && dailyOv && dailyOv.hidden === false) ||
        (typeof birdsOv !== "undefined" && birdsOv && birdsOv.hidden === false) ||
        (typeof courseOv !== "undefined" && courseOv && courseOv.hidden === false)) &&
        S.state !== "playing" && S.state !== "paused") { showMenu(); return; }
    if (S.state === "paused") doResume(); else doPause();
  } else if (e.code === "KeyM") { toggleMute(); }
});
window.addEventListener("contextmenu", e => { if (e.target === canvas) e.preventDefault(); });

$("playBtn").onclick = () => { AudioFX.click(); showReady(S.selectedLevel); };
if ($("endlessBtn")) $("endlessBtn").onclick = () => { AudioFX.click(); showEndless(); };
$("levelsBtn").onclick = () => { AudioFX.click(); openWorlds(); };
$("levelsBackBtn").onclick = () => { AudioFX.click(); openWorlds(); };
if ($("levelsMenuBtn")) $("levelsMenuBtn").onclick = () => { AudioFX.click(); showMenu(); };
if ($("worldsBackBtn")) $("worldsBackBtn").onclick = () => { AudioFX.click(); showMenu(); };
$("readyBtn").onclick = () => { AudioFX.ensure(); AudioFX.click(); startPlaying(); };
$("readyMenuBtn").onclick = () => { AudioFX.click(); showMenu(); };
$("pauseBtn").onclick = () => { AudioFX.click(); doPause(); };
$("resumeBtn").onclick = () => { AudioFX.click(); doResume(); };
$("pauseRestartBtn").onclick = () => { AudioFX.click(); if (S.runMode === "daily") Daily.showReady(); else if (S.runMode === "endless") showEndless(); else showReady(S.level); };
$("pauseMenuBtn").onclick = () => { AudioFX.click(); showMenu(); };
$("retryBtn").onclick = () => { AudioFX.click(); if (S.runMode === "daily") Daily.showReady(); else if (S.runMode === "endless") showEndless(); else showReady(S.level); }; // Gate D: endless startar om direkt
$("overMenuBtn").onclick = () => { AudioFX.click(); showMenu(); };
$("overLevelsBtn").onclick = () => { AudioFX.click(); openWorlds(); };
/* Phase 1A: dagbelöning + samling (från menyn + HUD-pillen under spel). */
if ($("dailyBtn")) $("dailyBtn").onclick = () => { AudioFX.click(); openDaily(); };
if ($("birdsBtn")) $("birdsBtn").onclick = () => { AudioFX.click(); openBirds("menu"); };
if ($("dailyBackBtn")) $("dailyBackBtn").onclick = () => { AudioFX.click(); showMenu(); };
if ($("birdsBackBtn")) $("birdsBackBtn").onclick = () => { backBirds(); };
if ($("featherPill")) $("featherPill").onclick = () => {
  AudioFX.ensure(); AudioFX.click();
  if (S.state === "playing") { doPause(); openBirds("pause"); } // rundan pausas, inte förlorad
  else if (S.state === "ready" || S.state === "paused") openBirds(S.state);
  else openBirds("menu");
};
/* CONTINUE: spelaren väljer själv — ingen autostart. Låser aldrig bakåt. */
$("nextBtn").onclick = () => { AudioFX.click(); S.selectedLevel = S.level + 1; S.levelFilterWorld = Progress.worldDefForLevel(S.level + 1).id; refreshMenu(); showReady(S.level + 1); };
$("clearRetryBtn").onclick = () => { AudioFX.click(); showReady(S.level); }; // PLAY AGAIN — rör aldrig unlock
if ($("clearWorldsBtn")) $("clearWorldsBtn").onclick = () => { AudioFX.click(); openWorlds(); };
$("clearMenuBtn").onclick = () => { AudioFX.click(); showMenu(); };

function toggleMute() {
  AudioFX.muted = !AudioFX.muted;
  try { AudioFX.syncMusic(); } catch (e) {}
  store.muted = AudioFX.muted;
  muteBtn.textContent = AudioFX.muted ? "🔇" : "🔊";
}
muteBtn.onclick = toggleMute;
muteBtn.textContent = AudioFX.muted ? "🔇" : "🔊";
$("modeClassicBtn").onclick = () => { AudioFX.click(); setMode("classic"); };
$("modeSkyBtn").onclick = () => { AudioFX.click(); setMode("sky"); };
$("modeClassicBtn2").onclick = () => { AudioFX.click(); setMode("classic"); };
$("modeSkyBtn2").onclick = () => { AudioFX.click(); setMode("sky"); };
/* Stage C: inställningar (språk + reducerad rörelse) — sparas lokalt i v2. */
if ($("langSvBtn")) $("langSvBtn").onclick = () => { AudioFX.click(); setLang("sv"); refreshMenu(); };
if ($("langEnBtn")) $("langEnBtn").onclick = () => { AudioFX.click(); setLang("en"); refreshMenu(); };
if ($("motionBtn")) $("motionBtn").onclick = () => { AudioFX.click(); toggleMotion(); };
if ($("volSlider")) $("volSlider").oninput = () => {
  const v = Number($("volSlider").value) / 100;
  AudioFX.setVolume(v);
  try { if (window.SaveV2) SaveV2.set("soundVol", AudioFX.volume); } catch (e) {}
  if (window.Analytics) Analytics.emit("sound_change", { vol: AudioFX.volume });
};
if ($("musicSlider")) $("musicSlider").oninput = () => {
  AudioFX.setMusicVolume(Number($("musicSlider").value) / 100);
  try { if (window.SaveV2) SaveV2.set("musicVol", AudioFX.musicVol); } catch (e) {}
};
if ($("settingsBtn")) $("settingsBtn").onclick = () => { AudioFX.click(); openSettings(); };
if ($("rotateDismiss")) $("rotateDismiss").onclick = () => {
  _veilDismiss = true; // gäller till nästa vyändring
  try { document.getElementById("rotateVeil").hidden = true; } catch (e) {}
  setTimeout(() => { _veilDismiss = false; syncRotateVeil(); }, 60000);
};
if ($("settingsBackBtn")) $("settingsBackBtn").onclick = () => { AudioFX.click(); showMenu(); };

function flash(a) {
  if (reducedMotion()) return; // a11y: ingen blixt i reducerat läge
  flashEl.style.opacity = a; setTimeout(() => flashEl.style.opacity = 0, 90);
}

/* ---------- partiklar ---------- */
function puff(x, y, n) {
  if (reducedMotion() || S.particles.length > 240) return; // a11y + partikeltak (visual only)
  for (let i = 0; i < n; i++)
    S.particles.push({ x, y: y + rand(-4, 4), vx: rand(-90, -20), vy: rand(-40, 40),
      life: rand(0.25, 0.5), t: 0, r: rand(2, 5), col: "255,255,255", kind: "puff" });
}
function burst(x, y, n, feather) {
  if (reducedMotion() || S.particles.length > 240) return; // a11y + partikeltak (visual only)
  for (let i = 0; i < n; i++)
    S.particles.push({ x, y, vx: rand(-220, 220), vy: rand(-320, 80),
      life: rand(0.5, 1.1), t: 0, r: rand(3, 7), feather: !!feather,
      rot: rand(0, TAU), vr: rand(-9, 9), col: feather ? "255,200,80" : "255,220,100", kind: "bit" });
}
function sparkle(x, y) {
  if (reducedMotion() || S.particles.length > 240) return; // a11y + partikeltak (visual only)
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    S.particles.push({ x, y, vx: Math.cos(a) * rand(60, 170), vy: Math.sin(a) * rand(60, 170),
      life: rand(0.35, 0.7), t: 0, r: rand(2, 4), col: "255,225,120", kind: "spark" });
  }
}
function confetti() {
  if (reducedMotion() || S.particles.length > 240) return; // a11y + partikeltak (visual only)
  const cols = ["255,107,74", "255,184,48", "126,224,160", "124,192,238", "200,127,196"];
  for (let i = 0; i < 90; i++)
    S.particles.push({ x: rand(40, S.W - 40), y: rand(-40, S.H * 0.4), vx: rand(-60, 60), vy: rand(60, 220),
      life: rand(1.2, 2.2), t: 0, r: rand(3, 6), col: cols[i % cols.length],
      rot: rand(0, TAU), vr: rand(-8, 8), kind: "conf" });
}


/* E7: local save export / import (no network). Import is two-step and reversible (Undo import). */
(function saveTransferUI() {
  const T = window.SaveTransfer; if (!T) return;
  const msg = t => { const m = $("saveMsg"); if (m) m.textContent = t || ""; };
  const syncUndo = () => { const u = $("saveUndoBtn"); if (u) u.hidden = !T.hasUndo(); };
  let pending = null;
  if ($("saveExportBtn")) $("saveExportBtn").onclick = () => {
    AudioFX.click(); Econ.flush();
    const text = T.exportText();
    try {
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      a.download = "dipwing-save-" + new Date().toISOString().slice(0, 10) + ".json"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(a.href); } catch (e) {} }, 2000);
    } catch (e) {}
    try { if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {}); } catch (e) {}
    msg(I18N.t("save_export_ok", { n: Econ.bal }));
  };
  if ($("saveImportBtn")) $("saveImportBtn").onclick = () => { AudioFX.click(); const f = $("saveImportFile"); if (f) { f.value = ""; f.click(); } };
  if ($("saveImportFile")) $("saveImportFile").onchange = () => {
    const f = $("saveImportFile").files && $("saveImportFile").files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      const text = String(rd.result || ""); const c = T.check(text);
      const btn = $("saveImportConfirm");
      if (!c.ok) { pending = null; if (btn) btn.hidden = true; msg(I18N.t("save_import_bad", { e: c.error })); return; }
      pending = text; if (btn) { btn.hidden = false; btn.textContent = I18N.t("save_import_confirm", { n: c.feathers, l: c.unlocked }); }
      msg("");
    };
    rd.readAsText(f);
  };
  if ($("saveImportConfirm")) $("saveImportConfirm").onclick = () => {
    if (!pending) return; Econ.flush();
    const r = T.importText(pending); pending = null; $("saveImportConfirm").hidden = true;
    if (!r.ok) { msg(I18N.t("save_import_bad", { e: r.error })); return; }
    msg(I18N.t("save_import_ok")); syncUndo();
    if (!window.__DW_NO_RELOAD) setTimeout(() => location.reload(), 600);
  };
  if ($("saveUndoBtn")) $("saveUndoBtn").onclick = () => {
    const r = T.undoImport(); if (!r.ok) return; msg(I18N.t("save_undo_ok")); syncUndo();
    if (!window.__DW_NO_RELOAD) setTimeout(() => location.reload(), 600);
  };
  syncUndo();
})();
/* ---------- hinder-spawn (Phase 0: Director i src/obstacles.js) ----------
   All gameplay-slump går via RNG-strömmen (seedad per försök).
   Samma seed ⇒ samma hinderföljd (replays, dagliga utmaningar). */
const PIPE_W = 78, CAP_H = 34, CAP_OV = 6;

/* ============================================================
   UPPDATERING
   ============================================================ */
function update(dt) {
  S.time += dt;
  if (S.envBlend < 1) S.envBlend = Math.min(1, S.envBlend + dt / 1.6); // mjuk världsövertoning
  if (S.flapLock > 0) S.flapLock -= dt;
  if (S.shakeT > 0) { S.shakeT -= dt; if (S.shakeT <= 0) S.shake = 0; }

  // moln driver alltid (levande meny-bakgrund)
  for (const cl of S.clouds) {
    cl.x -= (cl.v + (S.state === "playing" ? S.cfg.speed * 0.06 : 4)) * dt;
    if (cl.x < -160) { cl.x = S.W + rand(0, 120); cl.y = rand(30, 300); }
  }
  for (const cl of S.cloudsFront) {
    cl.x -= (cl.v + (S.state === "playing" ? S.cfg.speed * 0.12 : 8)) * dt;
    if (cl.x < -240) { cl.x = S.W + rand(0, 160); cl.y = rand(140, 440); }
  }
  updateAmbient(dt);

  // partiklar + popups alltid
  for (let i = S.particles.length - 1; i >= 0; i--) {
    const p = S.particles[i];
    p.t += dt;
    if (p.t >= p.life) { S.particles.splice(i, 1); continue; }
    p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt;
    if (p.kind === "bit" || p.kind === "conf") p.vy += 900 * dt;
    if (p.rot != null) p.rot += p.vr * dt;
  }
  for (let i = S.popups.length - 1; i >= 0; i--) {
    const p = S.popups[i];
    p.t += dt; p.y -= 46 * dt;
    if (p.t > 0.9) S.popups.splice(i, 1);
  }

  if (S.state === "menu" || S.state === "gameover") {
    S.camX += 40 * dt;
    S.bird.y = S.H * 0.44 + Math.sin(S.time * 2.2) * 10;
    S.bird.wing += dt * 7;
    return;
  }
  if (S.state === "paused" || S.state === "gameover") return;

  if (S.state === "ready") {
    S.camX += 45 * dt;
    S.bird.y = S.H * 0.44 + Math.sin(S.time * 3) * 8;
    S.bird.wing += dt * 9;
    S.bird.rot = lerp(S.bird.rot, 0, dt * 8);
    return;
  }

  if (S.state === "clear") {
    S.clearT += dt;
    S.camX += S.cfg.speed * 0.5 * dt;
    S.bird.y += Math.sin(S.time * 4) * 20 * dt;
    S.bird.wing += dt * 14;
    S.bird.rot = lerp(S.bird.rot, -0.15, dt * 5);
    for (const p of S.pipes) p.x -= S.cfg.speed * 0.5 * dt;
    if (S.runMode === "daily") { if (S.clearT > 1.35 && courseOv && courseOv.hidden) Daily.open(); }
    else if (S.clearT > 1.35 && clearOv.hidden) showClearPanel();
    return;
  }

  if (S.state === "dying") {
    S.deathT += dt;
    S.bird.vy = Math.min(S.bird.vy + TUNE.gravity * dt, 900);
    S.bird.y += S.bird.vy * dt;
    S.bird.rot = lerp(S.bird.rot, Math.PI / 2, dt * 6);
    S.bird.wing += dt * 3;
    const gy = S.H - S.groundH;
    if (S.bird.y >= gy - 12) {
      S.bird.y = gy - 12;
      if (S.deathT > 0.35 && overOv.hidden) showGameOver();
    } else if (S.deathT > 1.4 && overOv.hidden) showGameOver();
    return;
  }

  if (S.state === "countdown") { // A8: fryst värld under 3-2-1
    S.countdownT -= dt;
    if (S.countdownT <= 0) { S.state = "playing"; LIVE_ACC.acc = 0; hideCountdown(); }
    else showCountdownNum(Math.ceil(S.countdownT));
    return;
  }
  // ---- playing (Gate B: fast tidssteg via ackumulator — samma kod som Sim) ----
  LIVE_ACC.acc = Math.min(LIVE_ACC.acc + dt, LIVE_ACC.STEP * 5); // shed: slow-mo i stället för spiral
  let n = 0;
  while (LIVE_ACC.acc >= LIVE_ACC.STEP && S.state === "playing" && n < 5) {
    stepPlaying(LIVE_ACC.STEP);
    LIVE_ACC.acc -= LIVE_ACC.STEP;
    n++;
  }
}

/* Ett fysiksteg. Live: N anrop per frame via ackumulator (fast STEP).
   Sim/test: N anrop med fast dt (1/120) ⇒ fullt reproducerbart. */
function stepPlaying(dt) {
  const c = S.cfg;
  S.ptime += dt; // fysiktid — enda tiden som hashas (visuell S.time är fri)
  if (!S.simMode) S.liveStep = (S.liveStep | 0) + 1; // idea 5 / E2: physics-step counter for receipts (not hashed)
  // Gate B testhake: policystyrd flax per fysiksteg (samma kodväg live + Sim).
  // A4 (audit B P0-2): finns BARA i dev (källfiler) och testbygget; tools/build.mjs tar bort blocket i
  // produktion och Perchance-paketet (och vägrar bygga om något blir kvar).
  if (!S.simMode && !tutorial.hidden && (S.score >= 3 || S.time - (S.playStartT || 0) > 8)) tutorial.hidden = true;
  // A1: ramp kapas vid målet (identiskt i adventure; overdrive behåller maxfart i stället för att tappa 13 %)
  const rampF = 1 + c.ramp * Math.min(1, S.score / Math.max(1, c.target));
  const speed = c.speed * rampF;
  S.curSpeed = speed; // A6: tajminghinder (sten) planerar mot aktuell fart
  S.camX += speed * dt;

  // 1) scrolla + uppdatera hinder (ob.t driver alla tajmingfaser deterministiskt)
  for (const ob of S.pipes) {
    ob.x -= speed * dt;
    window.OBSTACLES[ob.fam].update(ob, dt, S);
  }

  // 2) vindkraft: zoner som överlappar fågeln i x-led adderar acceleration
  let windA = 0;
  for (const ob of S.pipes) {
    if (ob.fam === "wind" && S.bird.x > ob.x && S.bird.x < ob.x + ob.w) windA += ob.accel;
  }

  // 3) fågel
  S.bird.vy = Math.min(S.bird.vy + (TUNE.gravity + windA) * dt, TUNE.maxFallSpeed);
  S.bird.y += S.bird.vy * dt;
  S.bird.wing += dt * (S.bird.vy < 0 ? 22 : 12);
  const targetRot = clamp(S.bird.vy / 700, -0.45, 1.35);
  S.bird.rot = lerp(S.bird.rot, targetRot, Math.min(1, dt * (S.bird.vy < 0 ? 18 : 8)));

  if (S.bird.y < 14) { S.bird.y = 14; S.bird.vy = 0; }

  // 4) spawn via Director (seedad sekvens — samma seed ⇒ samma hinder)
  const lastOb = S.pipes[S.pipes.length - 1];
  if (!lastOb) window.Director.spawnNext(window.RNG, S);
  // A5 (P1-1): nästa hinder skapas när det senaste når högerkanten (+90 px marginal) och placeras
  // exakt cfg.spacing (± var) efter det — utanför bild, så det konfigurerade avståndet gäller.
  else if (lastOb.x < S.W + 90) window.Director.spawnNext(window.RNG, S);

  // 5) poäng vid passage
  for (const ob of S.pipes) {
    if (!ob.passed && ob.x + ob.w < S.bird.x - 12) {
      ob.passed = true;
      S.score++;
      if (S.runMode === "daily") Daily.onPassed(ob);
      if (!S.simMode) {
        updateHUD();
        AudioFX.score();
        sparkle(S.bird.x + 30, S.bird.y - 20);
        S.popups.push({ x: ob.x + ob.w / 2, y: ob.gapY - ob.gap / 2 - 14, t: 0, txt: "+1" });
        Econ.awardPipe(); // Gate D: även endless ger fjädrar (samma takt, ingen bonus)
        if (S.runMode === "endless" && S.score > 0 && S.score % 25 === 0) {
          S.popups.push({ x: S.W / 2, y: S.H * 0.3, t: 0, txt: S.score + "!" });
          AudioFX.milestone();
        }
      }
      if (S.runMode === "endless") { refreshEndless(); if (!S.simMode) updateHUD(); }
      else if (!S.overdrive && S.score >= c.target) { levelClear(); return; }
    }
  }
  while (S.pipes.length && S.pipes[0].x + S.pipes[0].w < -30) S.pipes.shift();

  // 6) kollision (förlåtande hitbox; varje familj definierar sin egen)
  const br = 11;
  const groundY = S.H - S.groundH;
  if (S.bird.y + br >= groundY) { S.bird.y = groundY - br; gameOver(true); return; }
  for (const ob of S.pipes) {
    if (window.OBSTACLES[ob.fam].collide(ob, S.bird.x, S.bird.y, br, S)) { gameOver(false); return; }
  }
  if (S.runMode === "daily") Daily.track(br); // near-miss marks for the share squares (render/share only)
}

function updateAmbient(dt) {
  const kind = S.world.ambient;
  for (const a of S.ambient) {
    if (kind === "snow") { a.y += (a.sp + 30) * dt; a.x += Math.sin(S.time * 1.5 + a.ph) * 22 * dt; if (a.y > S.H) { a.y = -6; a.x = Math.random() * S.W; } }
    else if (kind === "petals" || kind === "pollen") { a.x -= (14 + a.sp * 0.4) * dt; a.y += Math.sin(S.time * 2 + a.ph) * 14 * dt - 6 * dt; if (a.x < -8) { a.x = S.W + 6; a.y = Math.random() * S.H; } }
    else if (kind === "fireflies" || kind === "sparkle") { a.x += Math.sin(S.time * 0.9 + a.ph) * 16 * dt; a.y += Math.cos(S.time * 0.7 + a.ph) * 12 * dt; }
    else { a.x -= 12 * dt; }
  }
}

/* ============================================================
   RENDER
   ============================================================ */
const _zenith = { k: null, g: null };
const _skyG = { k: null, g: null };
function render() {
  const w = S.W, h = S.H;
  // bälte-och-hängslen: fyll hela canvasen (ifall logisk H klippts)
  const offX = S.offX || 0;
  const topCol = skyTopColor();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = topCol;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(S.scale, 0, 0, S.scale, 0, 0);
  ctx.translate(offX, -S.camY); // Gate B: bottenankrad kamera (logiska koordinater); A2: centrerad i x
  // A2 (P1-2): extra himmel ovanför planen fortsätter miljöns ÖVERSTA himmelsfärg (förut: platt
  // bottenfärg ⇒ synligt band). Mjuk zenit-ton uppåt.
  if (S.camY < 0) {
    // A9: gradienten cachas per (färg, kamera) i stället för att skapas varje bildruta
    const zk = topCol + "|" + Math.round(S.camY);
    if (_zenith.k !== zk) {
      const zg = ctx.createLinearGradient(0, S.camY - 40, 0, -30);
      zg.addColorStop(0, shadeHex(topCol, -0.18));
      zg.addColorStop(1, topCol);
      _zenith.k = zk; _zenith.g = zg;
    }
    ctx.fillStyle = _zenith.g;
  } else ctx.fillStyle = topCol;
  ctx.fillRect(-40 - offX, S.camY - 40, w + 80 + 2 * offX, S.viewH + 80);

  // screen shake
  if (S.shake > 0) {
    const m = S.shake * (S.shakeT > 0 ? S.shakeT / 0.45 : 0);
    ctx.translate(rand(-m, m), rand(-m, m));
  }

  // premiumsceneri eller klassisk bakgrund (samma hinder/rör oavsett)
  if (window.Worlds && Worlds.isPremium(S.envId)) {
    Worlds.drawBackground(ctx, S, w, h);
    drawScarfTrail();
    drawObstacles(w, h);
    Worlds.drawForeground(ctx, S, w, h);
  } else {
    drawSky(w, h);
    drawSun(w, h);
    drawLightRays(w, h);
    drawDistantBirds(w);
    drawCloudsBehind();
    drawMountains(w, h);
    drawHills(w, h);
    drawTrees(w, h);
    drawScarfTrail();
    drawObstacles(w, h);
    drawCloudsFront();
    drawGround(w, h);
    drawForeground(w, h);
  }
  drawAmbientFront(w, h);
  drawBird();
  drawParticles();
  drawPopups();
  drawLighting(w, h);
  // A2: sidomarginaler (bredare skärm än planen) maskas — hinder spawnar utanför planen och får inte synas
  if (offX > 0.5) {
    ctx.fillStyle = "rgba(10,14,32,0.92)";
    ctx.fillRect(-offX - 2, S.camY - 2, offX + 2, S.viewH + 4);
    ctx.fillRect(w, S.camY - 2, offX + 2, S.viewH + 4);
  }
}
/* A2: miljöns översta himmelsfärg (premiumscen via Worlds.skyTop, annars klassisk palett). */
function skyTopColor() {
  try { if (window.Worlds && Worlds.skyTop && Worlds.isPremium(S.envId)) { const c = Worlds.skyTop(S.envId); if (c) return c; } } catch (e) {}
  return S.world.sky[0];
}
function shadeHex(hex, f) {
  const n = parseInt(String(hex).slice(1, 7), 16);
  if (!Number.isFinite(n)) return hex;
  const ch = s => { const v = (n >> s) & 255; return Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f); };
  return "rgb(" + ch(16) + "," + ch(8) + "," + ch(0) + ")";
}

function skyGradient(w, h) {
  const cols = S.world.sky, k = cols.join(",") + "|" + h; // A9: cachad
  if (_skyG.k === k) return _skyG.g;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  cols.forEach((c, i) => g.addColorStop(i / (cols.length - 1), c));
  _skyG.k = k; _skyG.g = g;
  return g;
}
function drawSky(w, h) {
  ctx.fillStyle = skyGradient(w, h);
  ctx.fillRect(-30, S.camY - 30, w + 60, S.viewH + 60); // täck hela den synliga kameraremsan
  if (S.worldKey === "magic" || S.worldKey === "sunset") drawStars(w, h);
}
function drawStars(w, h) {
  ctx.save();
  const n = S.worldKey === "magic" ? 90 : 30;
  for (let i = 0; i < n; i++) {
    const x = hash(i * 3.7) * w, y = hash(i * 9.1) * h * 0.55;
    const tw = 0.35 + 0.65 * Math.abs(Math.sin(S.time * 1.4 + i));
    ctx.globalAlpha = (S.worldKey === "magic" ? 0.9 : 0.4) * tw;
    ctx.fillStyle = "#fff";
    const s = hash(i * 5.3) * 1.8 + 0.6;
    ctx.fillRect(x, y, s, s);
  }
  ctx.restore();
  // norrsken för magi
  if (S.worldKey === "magic") {
    ctx.save();
    ctx.globalAlpha = 0.22 + 0.08 * Math.sin(S.time * 0.8);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, "#00ffcc"); g.addColorStop(0.5, "#7df9ff"); g.addColorStop(1, "#ff6ec7");
    ctx.fillStyle = g;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 12) {
      const y = 120 + Math.sin(x * 0.02 + S.time * 0.7) * 26 + Math.sin(x * 0.05 - S.time * 0.4) * 10;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    for (let x = w; x >= 0; x -= 12) {
      const y = 190 + Math.sin(x * 0.02 + S.time * 0.7) * 26;
      ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
function drawSun(w, h) {
  const s = S.world.sun;
  const x = s.x * w, y = s.y * h;
  const pulse = 1 + 0.04 * Math.sin(S.time * 1.2);
  const gl = ctx.createRadialGradient(x, y, 4, x, y, s.r * 3.2 * pulse);
  gl.addColorStop(0, s.glow); gl.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gl;
  ctx.fillRect(x - s.r * 3.2 * pulse, y - s.r * 3.2 * pulse, s.r * 6.4 * pulse, s.r * 6.4 * pulse);
  ctx.fillStyle = s.core;
  ctx.beginPath(); ctx.arc(x, y, s.r, 0, TAU); ctx.fill();
  // mjuk kärna (2.5D-glöd)
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.beginPath(); ctx.arc(x - s.r * 0.18, y - s.r * 0.2, s.r * 0.42, 0, TAU); ctx.fill();
  if (S.worldKey === "magic") { // kratrar på månen
    ctx.fillStyle = "rgba(160,200,220,0.5)";
    ctx.beginPath(); ctx.arc(x - 10, y - 6, 7, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 9, y + 8, 5, 0, TAU); ctx.fill();
  }
}
function drawCloudsBehind() {
  for (const cl of S.clouds) drawCloud(cl.x - S.camX * 0.08 % 700, cl.y, cl.s);
}
function drawCloud(x, y, s) {
  x = ((x % (S.W + 320)) + S.W + 320) % (S.W + 320) - 160;
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = S.world.cloudShade;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.ellipse(0, 8, 46, 16, 0, 0, TAU);
  ctx.ellipse(-30, 10, 26, 12, 0, 0, TAU);
  ctx.ellipse(32, 10, 28, 13, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = S.world.cloud;
  ctx.beginPath();
  ctx.ellipse(0, 0, 44, 17, 0, 0, TAU);
  ctx.ellipse(-28, 3, 24, 12, 0, 0, TAU);
  ctx.ellipse(30, 3, 26, 13, 0, 0, TAU);
  ctx.ellipse(4, -10, 24, 13, 0, 0, TAU);
  ctx.fill();
  // mjuk underbelysning (2.5D-volym)
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.ellipse(2, -8, 26, 8, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}
/* Mjuka ljusstrålar från solen (solnedgång/magi — subtil stämning). */
function drawLightRays(w, h) {
  if (S.worldKey !== "sunset" && S.worldKey !== "magic") return;
  const s = S.world.sun;
  const x = s.x * w, y = s.y * h;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.05 + 0.015 * Math.sin(S.time * 0.6);
  ctx.fillStyle = "#ffe9a8";
  for (let i = 0; i < 3; i++) {
    const a = 0.5 + i * 0.38 + Math.sin(S.time * 0.12 + i) * 0.03;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(h * 1.2, -70 - i * 26); ctx.lineTo(h * 1.2, 70 + i * 26);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}
/* Fjärran fågelsilhuetter (levande himmel — enbart dekor). */
function drawDistantBirds(w) {
  if (S.worldKey !== "meadow" && S.worldKey !== "sunset" && S.worldKey !== "tropic") return;
  ctx.save();
  ctx.strokeStyle = "rgba(43,33,24,0.45)"; ctx.lineWidth = 2; ctx.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    const bx = ((hash(i * 13.7 + S.level) * (w + 400) - S.camX * 0.05 - S.time * 9) % (w + 400) + w + 400) % (w + 400) - 200;
    const by = 90 + hash(i * 7.3) * 130 + Math.sin(S.time * 0.9 + i * 2) * 8;
    const f = Math.sin(S.time * 7 + i * 2.1) * 4;
    ctx.beginPath();
    ctx.moveTo(bx - 9, by - f); ctx.quadraticCurveTo(bx - 3, by + 1, bx, by);
    ctx.quadraticCurveTo(bx + 3, by + 1, bx + 9, by - f);
    ctx.stroke();
  }
  ctx.restore();
}
function drawCloudsFront() {
  ctx.save();
  ctx.globalAlpha = 0.38;
  for (const cl of S.cloudsFront) drawCloud(cl.x - S.camX * 0.2 % 700, cl.y, cl.s);
  ctx.restore();
}
function ridge(baseY, amp, f1, f2, off, col) {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(-30, S.H);
  for (let x = -30; x <= S.W + 30; x += 10) {
    const wx = x + off;
    const y = baseY - (Math.abs(Math.sin(wx * f1)) * amp + Math.abs(Math.sin(wx * f2 + 1.7)) * amp * 0.5);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(S.W + 30, S.H);
  ctx.closePath(); ctx.fill();
}
function drawMountains(w, h) {
  const gy = h - S.groundH;
  ridge(gy - 150, 120, 0.004, 0.011, S.camX * 0.08, S.world.farMount);
  // atmosfäriskt dis mellan bergslagren (djup)
  const hz = ctx.createLinearGradient(0, gy - 280, 0, gy - 30);
  hz.addColorStop(0, "rgba(255,255,255,0)");
  hz.addColorStop(1, "rgba(255,255,255,0.16)");
  ctx.fillStyle = hz;
  ctx.fillRect(-30, gy - 280, w + 60, 250);
  if (S.world.mountSnow) {
    ctx.fillStyle = S.world.mountSnow;
    // enkla snötoppar: vita trianglar där berget är högt
    for (let x = -20; x < w + 20; x += 90) {
      const wx = x + S.camX * 0.08;
      const peak = gy - 150 - (Math.abs(Math.sin(wx * 0.004)) * 120 + 30);
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(x - 26, peak + 34); ctx.lineTo(x, peak); ctx.lineTo(x + 26, peak + 34);
      ctx.lineTo(x + 12, peak + 28); ctx.lineTo(x, peak + 34); ctx.lineTo(x - 12, peak + 28);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ridge(gy - 90, 80, 0.006, 0.017, S.camX * 0.16 + 500, S.world.nearMount);
}
function drawHills(w, h) {
  const gy = h - S.groundH;
  ctx.fillStyle = S.world.hillBack;
  ctx.beginPath(); ctx.moveTo(-30, gy + 4);
  for (let x = -30; x <= w + 30; x += 12) {
    const y = gy - 60 - Math.sin((x + S.camX * 0.3) * 0.012) * 26 - Math.sin((x + S.camX * 0.3) * 0.03 + 2) * 8;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w + 30, gy + 4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = S.world.hillFront;
  ctx.beginPath(); ctx.moveTo(-30, gy + 4);
  for (let x = -30; x <= w + 30; x += 12) {
    const y = gy - 26 - Math.sin((x + S.camX * 0.45) * 0.014 + 1) * 20;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w + 30, gy + 4); ctx.closePath(); ctx.fill();
}

function drawTrees(w, h) {
  const gy = h - S.groundH;
  const span = 2600;
  for (const t of S.trees) {
    let x = (t.x - S.camX * 0.55) % span;
    if (x < -120) x += span;
    if (x > w + 120) continue;
    const y = gy - 26 + (t.v - 0.5) * 14;
    drawTree(x, y, t.s, t.v, Math.sin(S.time * 1.3 + t.x * 0.05) * 0.035);
  }
}
function drawTree(x, y, s, v, sway) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.rotate(sway || 0);
  const kind = S.world.tree;
  if (kind === "palm") {
    ctx.strokeStyle = "#7a5230"; ctx.lineWidth = 9; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(8, -34, 16, -52); ctx.stroke();
    ctx.strokeStyle = "#2fa36b"; ctx.lineWidth = 8;
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI * 0.15 - i * 0.5;
      ctx.beginPath(); ctx.moveTo(16, -52);
      ctx.quadraticCurveTo(16 + Math.cos(a) * 30, -52 + Math.sin(a) * 18 - 8, 16 + Math.cos(a) * 46, -52 + Math.sin(a) * 22 + 8);
      ctx.stroke();
    }
    ctx.fillStyle = "#6b4423";
    ctx.beginPath(); ctx.arc(12, -48, 5, 0, TAU); ctx.arc(22, -47, 5, 0, TAU); ctx.fill();
  } else if (kind === "pine") {
    ctx.fillStyle = "#6b4a33";
    ctx.fillRect(-4, -18, 8, 18);
    const layers = [["#2e7d4f", -58, 30], ["#35945e", -40, 38], ["#3faa6c", -22, 46]];
    for (const [c, ty, hw] of layers) {
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.moveTo(0, ty - 14); ctx.lineTo(-hw / 2, ty + 12); ctx.lineTo(hw / 2, ty + 12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath(); ctx.moveTo(0, ty - 14); ctx.lineTo(-hw / 4, ty + 2); ctx.lineTo(0, ty - 2); ctx.lineTo(hw / 4, ty + 2); ctx.closePath(); ctx.fill();
    }
  } else if (kind === "silhouette") {
    ctx.fillStyle = "#2e1f38";
    ctx.fillRect(-4, -46, 8, 46);
    ctx.beginPath(); ctx.arc(0, -56, 26 + v * 8, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(-18, -46, 16, 0, TAU); ctx.arc(18, -46, 16, 0, TAU); ctx.fill();
  } else if (kind === "crystal") {
    ctx.fillStyle = "#241c4e";
    ctx.fillRect(-5, -30, 10, 30);
    const cols = ["#7df9ff", "#c44f9e", "#b47fe8"];
    for (let i = -1; i <= 1; i++) {
      ctx.fillStyle = cols[i + 1];
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(i * 14 - 7, -30); ctx.lineTo(i * 14, -58 - v * 14); ctx.lineTo(i * 14 + 7, -30);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fillRect(i * 14 - 1, -52, 2, 18);
    }
  } else { // round — sommar
    ctx.fillStyle = "#6b4423";
    ctx.beginPath();
    ctx.moveTo(-6, 0); ctx.quadraticCurveTo(-4, -30, 2, -40); ctx.lineTo(8, -40);
    ctx.quadraticCurveTo(4, -28, 6, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#3f8f2f";
    ctx.beginPath(); ctx.arc(-16, -48, 22, 0, TAU); ctx.arc(16, -50, 24, 0, TAU); ctx.arc(0, -62, 24, 0, TAU); ctx.fill();
    ctx.fillStyle = "#5cb845";
    ctx.beginPath(); ctx.arc(-10, -56, 15, 0, TAU); ctx.arc(12, -58, 14, 0, TAU); ctx.fill();
    ctx.fillStyle = "#ff7d9e";
    if (v > 0.4) { ctx.beginPath(); ctx.arc(-18, -52, 3, 0, TAU); ctx.arc(14, -44, 3, 0, TAU); ctx.fill(); }
  }
  ctx.restore();
}

/* --- rör --- */
function drawPipeBody(x, y, wdt, hgt, isTop) {
  if (hgt <= 0) return;
  const pw = S.world.pipe;
  const g = ctx.createLinearGradient(x, 0, x + wdt, 0);
  g.addColorStop(0, S.world.pipeEdge);
  g.addColorStop(0.12, pw[0]);
  g.addColorStop(0.42, pw[1]);
  g.addColorStop(0.62, pw[2]);
  g.addColorStop(0.88, pw[0]);
  g.addColorStop(1, S.world.pipeEdge);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, wdt, hgt);
  // highlight-rand
  ctx.fillStyle = S.world.capLight;
  ctx.fillRect(x + wdt * 0.32, y + 2, wdt * 0.13, hgt - 4);
  // ljuskant från vänster (premium-rim)
  ctx.fillStyle = "rgba(255,255,255,0.30)";
  ctx.fillRect(x + 2, y + 2, 2.5, hgt - 4);
  // skugga mot gapet
  const sg = ctx.createLinearGradient(0, isTop ? y + hgt - 14 : y, 0, isTop ? y + hgt : y + 14);
  sg.addColorStop(0, "rgba(0,0,0,0)");
  sg.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = sg;
  ctx.fillRect(x, isTop ? y + hgt - 14 : y, wdt, 14);
  // kontur
  ctx.strokeStyle = "rgba(20,20,20,0.55)"; ctx.lineWidth = 2.5;
  ctx.strokeRect(x + 1, y - 2, wdt - 2, hgt + 4);
}
function drawPipeCap(x, y, isTop) {
  const wdt = PIPE_W + CAP_OV * 2;
  const cx = x - CAP_OV;
  const pw = S.world.pipe;
  const g = ctx.createLinearGradient(cx, 0, cx + wdt, 0);
  g.addColorStop(0, S.world.pipeEdge);
  g.addColorStop(0.15, pw[0]);
  g.addColorStop(0.45, pw[1]);
  g.addColorStop(0.65, pw[2]);
  g.addColorStop(1, S.world.pipeEdge);
  ctx.fillStyle = g;
  roundRect(cx, y, wdt, CAP_H, 7); ctx.fill();
  ctx.fillStyle = S.world.capLight;
  roundRect(cx + wdt * 0.3, y + 4, wdt * 0.14, CAP_H - 8, 4); ctx.fill();
  ctx.strokeStyle = "#1d1d1d"; ctx.lineWidth = 3;
  roundRect(cx, y, wdt, CAP_H, 7); ctx.stroke();
  // överkant-glans på manschetten
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  roundRect(cx + 4, y + 2, wdt - 8, 3, 2); ctx.fill();
  // nitar
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath(); ctx.arc(cx + 12, y + CAP_H / 2, 3, 0, TAU); ctx.arc(cx + wdt - 12, y + CAP_H / 2, 3, 0, TAU); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath(); ctx.arc(cx + 11, y + CAP_H / 2 - 1, 1.2, 0, TAU); ctx.arc(cx + wdt - 13, y + CAP_H / 2 - 1, 1.2, 0, TAU); ctx.fill();

  // världsdetalj på kanten
  if (S.worldKey === "winter") {
    ctx.fillStyle = "rgba(255,255,255,0.95)"; // snö på ovansidan av caps
    const sy = isTop ? y + CAP_H - 5 : y;
    ctx.fillRect(cx + 2, sy, wdt - 4, 5);
    if (isTop) { // istappar under övre röret
      ctx.fillStyle = "rgba(220,240,255,0.9)";
      for (let ix = cx + 8; ix < cx + wdt - 6; ix += 14) {
        const len = 6 + hash(ix) * 8;
        ctx.beginPath(); ctx.moveTo(ix, y + CAP_H); ctx.lineTo(ix + 4, y + CAP_H); ctx.lineTo(ix + 2, y + CAP_H + len); ctx.closePath(); ctx.fill();
      }
    }
  } else if (S.worldKey === "meadow") {
    ctx.fillStyle = "#2e7d3a"; // liten murgröna
    const vy = isTop ? y + 2 : y + CAP_H - 8;
    ctx.beginPath(); ctx.ellipse(cx + 10, vy + 3, 6, 3.4, 0.4, 0, TAU); ctx.ellipse(cx + wdt - 10, vy + 3, 6, 3.4, -0.4, 0, TAU); ctx.fill();
  } else if (S.worldKey === "magic") {
    // glödande runor (skiktad glöd — ingen shadowBlur, billigt på mobil)
    for (let ix = cx + 16; ix < cx + wdt - 8; ix += 18) {
      ctx.fillStyle = "rgba(125,249,255,0.35)";
      ctx.beginPath(); ctx.arc(ix, y + CAP_H / 2, 5, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(225,255,255,0.95)";
      ctx.beginPath(); ctx.arc(ix, y + CAP_H / 2, 2.2, 0, TAU); ctx.fill();
    }
  } else if (S.worldKey === "sunset") {
    ctx.fillStyle = "rgba(255,200,120,0.5)"; // varm kantbelysning
    ctx.fillRect(isTop ? cx + 2 : cx + 2, isTop ? y + 2 : y + 2, wdt - 4, 3);
  }
}
function drawObstacles(w, h) {
  for (const ob of S.pipes) {
    const fam = window.OBSTACLES[ob.fam] || window.OBSTACLES.classic;
    fam.draw(ctx, ob, S);
  }
}
/* Delade rit-hjälpmedel för hindermodulerna (sätts efter definitionerna). */
function roundRect(x, y, wdt, hgt, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + wdt, y, x + wdt, y + hgt, r);
  ctx.arcTo(x + wdt, y + hgt, x, y + hgt, r);
  ctx.arcTo(x, y + hgt, x, y, r);
  ctx.arcTo(x, y, x + wdt, y, r);
  ctx.closePath();
}

/* Rörpar-ritning som återanvänds av rörfamiljerna (classic/drift/pulse). */
function drawPipePair(c, ob, S) {
  if (window.IDENTITY && IDENTITY.V1) return IDENTITY.drawGatePair(c, ob, S); // Dipwing gate language
  const gy = S.H - S.groundH;
  const wdt = ob.w || PIPE_W;
  const gapTop = ob.gapY - ob.gap / 2, gapBot = ob.gapY + ob.gap / 2;
  // mjuk skugga bakom röret
  c.fillStyle = "rgba(0,0,0,0.14)";
  c.fillRect(ob.x + 5, 0, wdt, Math.max(0, gapTop));
  c.fillRect(ob.x + 5, gapBot, wdt, Math.max(0, gy - gapBot));
  // extra djupskugga (2.5D)
  c.fillStyle = "rgba(0,0,0,0.08)";
  c.fillRect(ob.x + 10, 0, wdt, Math.max(0, gapTop));
  c.fillRect(ob.x + 10, gapBot, wdt, Math.max(0, gy - gapBot));
  // mjukt ljus som spiller ut ur gapet
  const gl = c.createLinearGradient(0, gapTop - 10, 0, gapTop);
  gl.addColorStop(0, "rgba(255,255,255,0)");
  gl.addColorStop(1, "rgba(255,255,255,0.20)");
  c.fillStyle = gl; c.fillRect(ob.x, Math.max(0, gapTop - 10), wdt, Math.min(10, gapTop));
  const gl2 = c.createLinearGradient(0, gapBot, 0, gapBot + 10);
  gl2.addColorStop(0, "rgba(255,255,255,0.20)");
  gl2.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = gl2; c.fillRect(ob.x, gapBot, wdt, 10);
  // övre + undre rör med manschetter
  drawPipeBody(ob.x, -4, wdt, gapTop - CAP_H + 4, true);
  drawPipeCap(ob.x, gapTop - CAP_H, true);
  drawPipeBody(ob.x, gapBot + CAP_H, wdt, gy - gapBot - CAP_H + 4, false);
  drawPipeCap(ob.x, gapBot, false);
}
/* Liten vimpel (vindriktning m.m.). dir: -1 = upp, +1 = ner. */
function drawFlag(c, x, y, color, dir) {
  c.save();
  c.fillStyle = color;
  c.strokeStyle = "#2b2118"; c.lineWidth = 1.5;
  c.beginPath();
  if (dir < 0) { c.moveTo(x, y + 12); c.lineTo(x + 18, y + 12); c.lineTo(x, y); }
  else { c.moveTo(x, y); c.lineTo(x + 18, y); c.lineTo(x, y + 12); }
  c.closePath(); c.fill(); c.stroke();
  c.restore();
}

/* Grindstolpar för farofamiljerna (Gate A): smala sidoskenor i världens
   rörpalett som ramar in det säkra gapet. Samma geometri som
   corridorHit i obstacles.js — det ögat ser är det som gäller. */
function drawGate(c, ob, S) {
  if (window.IDENTITY && IDENTITY.V1) return IDENTITY.drawGateRails(c, ob, S);
  const gy = S.H - S.groundH;
  const top = ob.gapY - ob.gap / 2, bot = ob.gapY + ob.gap / 2;
  const pal = S.world.pipe, edge = S.world.pipeEdge;
  for (const rx of [ob.x + 1, ob.x + ob.w - 7]) {
    const g = c.createLinearGradient(rx, 0, rx + 6, 0);
    g.addColorStop(0, edge); g.addColorStop(0.5, pal[0]); g.addColorStop(1, pal[1]);
    c.fillStyle = g;
    c.globalAlpha = 0.9;
    if (top > 0) c.fillRect(rx, 0, 6, top);
    if (bot < gy) c.fillRect(rx, bot, 6, gy - bot);
    c.globalAlpha = 1;
    // ljuslist vid gapets läppar (visar var passagen är)
    c.fillStyle = S.world.capLight;
    c.fillRect(rx, Math.max(0, top - 3), 6, 6);
    c.fillRect(rx, Math.min(gy, bot) - 3, 6, 6);
  }
}
/* Exponeras till hindermodulerna (src/obstacles.js). Sätt efter definition. */
window.FX = { roundRect, drawPipeBody, drawPipeCap, drawPipePair, drawGate, flag: drawFlag, PIPE_W, CAP_H, CAP_OV };

function drawGround(w, h) {
  const gy = h - S.groundH;
  // jord
  const g = ctx.createLinearGradient(0, gy, 0, h);
  g.addColorStop(0, S.world.dirt); g.addColorStop(1, S.world.dirtDark);
  ctx.fillStyle = g;
  ctx.fillRect(-30, gy, w + 60, S.groundH + 30);
  // prickar i jorden (scrollande)
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  const off = S.camX % 56;
  for (let x = -off; x < w + 30; x += 56) {
    ctx.beginPath(); ctx.ellipse(x + 14, gy + 52, 7, 4, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 40, gy + 68, 5, 3, 0, 0, TAU); ctx.fill();
  }
  // gräsremsa
  const gg = ctx.createLinearGradient(0, gy - 4, 0, gy + 24);
  gg.addColorStop(0, S.world.ground); gg.addColorStop(1, S.world.groundDark);
  ctx.fillStyle = gg;
  ctx.fillRect(-30, gy - 4, w + 60, 28);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(-30, gy - 4, w + 60, 4);
  // grässtrån (scrollande)
  ctx.strokeStyle = S.world.groundDark; ctx.lineWidth = 2.5; ctx.lineCap = "round";
  const off2 = S.camX % 34;
  ctx.beginPath();
  for (let x = -off2; x < w + 30; x += 34) {
    const sway = Math.sin(S.time * 2 + x) * 2;
    ctx.moveTo(x, gy - 2); ctx.lineTo(x - 3 + sway, gy - 12);
    ctx.moveTo(x + 7, gy - 2); ctx.lineTo(x + 8 + sway, gy - 14);
    ctx.moveTo(x + 14, gy - 2); ctx.lineTo(x + 18 + sway, gy - 10);
  }
  ctx.stroke();
  // mörk linje överst
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(-30, gy - 5, w + 60, 2.5);
}
function drawForeground(w, h) {
  const gy = h - S.groundH;
  const off = S.camX % 130;
  for (let x = -off; x < w + 40; x += 130) {
    const v = hash(Math.round((x + S.camX) / 130));
    if (S.worldKey === "meadow" || S.worldKey === "tropic") {
      if (v > 0.35) {
        const fx = x + v * 60;
        ctx.fillStyle = v > 0.7 ? "#ff7d9e" : "#ffffff";
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * TAU;
          ctx.beginPath(); ctx.ellipse(fx + Math.cos(a) * 4, gy - 12 + Math.sin(a) * 4, 3.4, 3.4, 0, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = "#ffcf3f";
        ctx.beginPath(); ctx.arc(fx, gy - 12, 3, 0, TAU); ctx.fill();
        ctx.strokeStyle = "#3f8f2f"; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(fx, gy - 8); ctx.lineTo(fx, gy - 2); ctx.stroke();
      }
    } else if (S.worldKey === "winter") {
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath(); ctx.ellipse(x + 30, gy - 4, 12, 4, 0, 0, TAU); ctx.fill();
    }
  }
  // mörka förgrundsstrån (närmast kameran, snabb parallax = 2.5D-djup)
  ctx.strokeStyle = "rgba(20,30,20,0.32)"; ctx.lineWidth = 3; ctx.lineCap = "round";
  const off3 = (S.camX * 0.9) % 46;
  ctx.beginPath();
  for (let x = -off3; x < w + 40; x += 46) {
    const hh = 14 + hash(Math.round((x + S.camX * 0.9) / 46)) * 16;
    const sway = Math.sin(S.time * 2.4 + x) * 2;
    ctx.moveTo(x, h + 4); ctx.quadraticCurveTo(x + 4 + sway, h - hh * 0.6, x + 10 + sway, h - hh);
  }
  ctx.stroke();
}
function drawAmbientFront(w, h) {
  ctx.save();
  for (const a of S.ambient) {
    const k = S.world.ambient;
    if (k === "snow") {
      ctx.globalAlpha = 0.9; ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(a.x, a.y, a.s, 0, TAU); ctx.fill();
    } else if (k === "petals") {
      ctx.globalAlpha = 0.85; ctx.fillStyle = "#ffb3d1";
      ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.ph + S.time);
      ctx.beginPath(); ctx.ellipse(0, 0, a.s + 1.5, a.s * 0.6, 0, 0, TAU); ctx.fill();
      ctx.restore();
    } else if (k === "pollen") {
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(S.time * 3 + a.ph); ctx.fillStyle = "#fffbe0";
      ctx.beginPath(); ctx.arc(a.x, a.y, a.s * 0.8, 0, TAU); ctx.fill();
    } else if (k === "fireflies" || k === "sparkle") {
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(S.time * 2.4 + a.ph));
      const glowCol = k === "sparkle" ? "#aef6ff" : "#ffe27a";
      ctx.globalAlpha = tw * 0.35; ctx.fillStyle = glowCol; // skiktad glöd, ingen shadowBlur
      ctx.beginPath(); ctx.arc(a.x, a.y, a.s * 2.2, 0, TAU); ctx.fill();
      ctx.globalAlpha = tw; ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(a.x, a.y, a.s * 0.8, 0, TAU); ctx.fill();
    }
  }
  ctx.restore();
}

/* --- fågeln (maskot med personlighet) --- */
/* Identity V1: Tornis (purely visual — the hitbox stays the r = 11 circle at S.bird). */
const _scarfTrail = { pts: [], last: -1 };
function v1Skin() {
  const id = S.birdSkin || "tornis";
  const pal = (window.IDENTITY.BIRD_PAL[id]) ? id : "tornis";
  // render never touches storage: equipped cosmetics are cached in Econ (refreshed on boot/equip/buy)
  const eq = Econ.cosEquipped();
  let scarf = null, trail = null;
  try { scarf = eq.scarf ? Econ.cosmeticDef("scarf", eq.scarf) : null; trail = eq.trail ? Econ.cosmeticDef("trail", eq.trail) : null; } catch (e) {}
  const hat = eq.hat && IDENTITY.HATS[eq.hat] ? eq.hat : null;
  return { pal, scarf: scarf && scarf.col, scarf2: scarf && scarf.col2, hat, trail: trail && trail.col ? trail : null };
}
function drawScarfTrail() {
  if (!(window.IDENTITY && IDENTITY.V1)) return;
  const b = S.bird, rm = reducedMotion();
  if (S.state !== "playing" && S.state !== "countdown" && S.state !== "clear") { _scarfTrail.pts.length = 0; return; }
  if (S.state === "playing" && S.time - _scarfTrail.last >= 0.016) {
    _scarfTrail.last = S.time;
    _scarfTrail.pts.unshift({ y: b.y - 6, cam: S.camX });
    if (_scarfTrail.pts.length > 4) _scarfTrail.pts.length = 4;
  }
  const pts = _scarfTrail.pts; if (pts.length < 2 || rm) return;
  const sk = v1Skin();
  const col = (sk.trail && sk.trail.col) || (sk.scarf) || IDENTITY.BIRD_PAL[sk.pal][5];
  const lowY = S.H * 0.66;
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.globalAlpha = b.y > lowY ? 0.22 : 0.35; // spec §8: alpha ≤ 0.35, lower in the bottom third
  ctx.strokeStyle = col; ctx.lineWidth = 5;
  ctx.beginPath();
  const px = p => b.x - 18 - (S.camX - p.cam);
  ctx.moveTo(b.x - 18, b.y - 6);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], q = pts[i];
    ctx.quadraticCurveTo(px(a), a.y, (px(a) + px(q)) / 2, (a.y + q.y) / 2);
  }
  ctx.stroke();
  if (sk.trail && sk.trail.dots) {
    ctx.fillStyle = sk.trail.dots;
    for (let i = 1; i < pts.length; i++) { ctx.beginPath(); ctx.arc(px(pts[i]), pts[i].y + (i % 2 ? 4 : -4), 2.2, 0, TAU); ctx.fill(); }
  }
  ctx.restore();
}
function drawBirdV1() {
  const b = S.bird, I = window.IDENTITY, rm = reducedMotion();
  const sk = v1Skin();
  const dead = !b.alive || S.state === "dying" || S.state === "gameover";
  const happy = S.state === "clear";
  const menu = S.state === "menu";
  ctx.save();
  const gy = S.H - S.groundH;
  if (!menu) {
    const hFrac = clamp(1 - (gy - b.y) / 500, 0, 1);
    if (hFrac > 0.02) {
      ctx.globalAlpha = 0.2 * hFrac; ctx.fillStyle = "#1A1433";
      ctx.beginPath(); ctx.ellipse(b.x, gy + 8, lerp(30, 10, hFrac), 6, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    }
  }
  // title screen: a big Tornis gliding in the middle of the scene (visual only)
  let x = b.x, y = b.y, rot = b.rot, scale = 1;
  if (menu) { x = S.W * 0.46; y = S.camY + (S.viewH || S.H) * 0.4 + (rm ? 0 : Math.sin(S.time * TAU / 2.2) * 8); rot = -0.06; scale = 2.3; }
  ctx.translate(x, y);
  ctx.rotate(rot);
  const since = b.flapAt != null ? S.time - b.flapAt : null;
  const wingDeg = dead ? 10 : menu ? (rm ? 0 : Math.sin(S.time * 2.2 * TAU) * 3) : I.wingAngle(since, b.vy, S.time, rm);
  const blink = !dead && !rm && (S.time % 3.7) < 0.12;
  I.drawTornis(ctx, { pal: sk.pal, palId: sk.pal, scarf: sk.scarf, scarf2: sk.scarf2, hat: sk.hat, wingDeg, vy: menu ? 0 : b.vy, t: S.time,
    state: dead ? "dead" : happy ? "happy" : "fly", blink, scale, reduced: rm });
  ctx.restore();
}
function drawBird() {
  if (window.IDENTITY && IDENTITY.V1) return drawBirdV1();
  const b = S.bird;
  /* Phase 1A: kosmetiskt skinn (ENDAST färger/markering — geometri, fysik
     och hitbox r=11 identiska för alla fåglar). */
  const SKIN_DEF = { body: ["#ffe27a", "#ffc93f", "#f59a2e"], belly: "#fff3d0",
    wingBack: "#c85a1a", wing: ["#ff9a3c", "#e86a1e"], tail: "#e88a2e",
    tuft: "#ff9a3c", mark: "arc", markCol: "rgba(200,110,20,0.55)" };
  let sk = SKIN_DEF;
  try { const d = Econ.birdDef(S.birdSkin); if (d && d.body) sk = Object.assign({}, SKIN_DEF, d); } catch (e) {} // IDENTITY_V1=false: non-legacy skins render as Sunny
  ctx.save();
  // mjuk skugga på marken
  const gy = S.H - S.groundH;
  const hFrac = clamp(1 - (gy - b.y) / 500, 0, 1);
  if (hFrac > 0.02) {
    ctx.globalAlpha = 0.22 * hFrac;
    ctx.fillStyle = "#000";
    const sw = lerp(34, 10, hFrac);
    ctx.beginPath(); ctx.ellipse(b.x, gy + 8, sw, 7, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.translate(b.x, b.y);
  ctx.rotate(b.rot);
  // squash-and-stretch (enbart visuellt — hitbox förblir r=11)
  const rise = clamp(-b.vy / 2600, -0.14, 0.22);
  const bounce = S.state === "clear" ? 1 + 0.05 * Math.sin(S.time * 9) : 1;
  ctx.scale(1.14 * (1 - rise * 0.55) * bounce, 1.14 * (1 + rise) * bounce);
  // svans
  const wag = Math.sin(b.wing * 0.9) * 3;
  ctx.fillStyle = sk.tail;
  ctx.strokeStyle = "#2b2118"; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-14, -2); ctx.lineTo(-26, -8 + wag); ctx.lineTo(-23, 0); ctx.lineTo(-26, 6 + wag); ctx.lineTo(-14, 5);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // kropp
  const bg = ctx.createLinearGradient(0, -16, 0, 16);
  bg.addColorStop(0, sk.body[0]); bg.addColorStop(0.55, sk.body[1]); bg.addColorStop(1, sk.body[2]);
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.ellipse(0, 0, 17, 13.5, 0, 0, TAU); ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = "#2b2118"; ctx.stroke();
  // mage
  ctx.fillStyle = sk.belly;
  ctx.beginPath(); ctx.ellipse(3, 6.5, 9.5, 5.5, 0.1, 0, TAU); ctx.fill();
  // fjäderdetaljer på ryggen (arc = sunny-bågar, wave = lagun-vågor)
  ctx.strokeStyle = sk.markCol; ctx.lineWidth = 1.3;
  if (sk.mark === "wave") {
    for (const dy of [-4, -1]) {
      ctx.beginPath();
      for (let x = -13; x <= 5; x += 2) {
        const y = dy + Math.sin((x + 13) * 0.55) * 1.8;
        if (x === -13) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else {
    ctx.beginPath(); ctx.arc(-3, -4, 10, Math.PI * 1.1, Math.PI * 1.65); ctx.stroke();
    ctx.beginPath(); ctx.arc(-5, -1, 10, Math.PI * 1.1, Math.PI * 1.65); ctx.stroke();
  }
  // vinge (flaxar) — bakre + främre fjäderlager
  const wa = Math.sin(b.wing) * 0.75 - 0.15;
  ctx.save();
  ctx.translate(-3, 1); ctx.rotate(wa * 0.7);
  ctx.fillStyle = sk.wingBack;
  ctx.beginPath(); ctx.ellipse(-8, 4, 10, 5, -0.35, 0, TAU); ctx.fill();
  ctx.lineWidth = 1.8; ctx.strokeStyle = "#2b2118"; ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.translate(-3, 1); ctx.rotate(wa);
  const wg = ctx.createLinearGradient(0, -8, 0, 10);
  wg.addColorStop(0, sk.wing[0]); wg.addColorStop(1, sk.wing[1]);
  ctx.fillStyle = wg;
  ctx.beginPath(); ctx.ellipse(-6, 2, 12, 6.5, -0.25, 0, TAU); ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = "#2b2118"; ctx.stroke();
  ctx.strokeStyle = "rgba(43,33,24,0.65)"; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(-14, -1); ctx.quadraticCurveTo(-7, 3, -1, 1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-13, 3); ctx.quadraticCurveTo(-6, 6, 1, 4); ctx.stroke();
  ctx.restore();
  // kindrodnad
  ctx.fillStyle = "rgba(255,120,120,0.55)";
  ctx.beginPath(); ctx.arc(6, 4, 3.6, 0, TAU); ctx.fill();
  // öga — uttryck efter tillstånd (död = X, clear = glad)
  const dead = !b.alive || S.state === "dying" || S.state === "gameover";
  const happy = S.state === "clear";
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(7.5, -5.5, 6, 0, TAU); ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = "#2b2118"; ctx.stroke();
  if (dead) {
    ctx.strokeStyle = "#232323"; ctx.lineWidth = 2; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(5, -8); ctx.lineTo(10.5, -3); ctx.moveTo(10.5, -8); ctx.lineTo(5, -3);
    ctx.stroke();
  } else if (happy) {
    ctx.strokeStyle = "#232323"; ctx.lineWidth = 2; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(8.5, -4.5, 3, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  } else {
    const blink = (S.time % 3.7) < 0.12 ? 0.15 : 1; // blinkning = personlighet
    ctx.fillStyle = "#232323";
    ctx.beginPath(); ctx.arc(9, -5.5, 3.1 * blink + 0.4, 0, TAU); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(10, -6.6, 1.3, 0, TAU); ctx.fill();
  }
  // näbb
  ctx.fillStyle = "#ff6b4a";
  ctx.strokeStyle = "#2b2118"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(13, -1); ctx.lineTo(23, 1.5); ctx.lineTo(13, 4.5); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#ff8c69";
  ctx.beginPath(); ctx.moveTo(13, -1); ctx.lineTo(19, 0.4); ctx.lineTo(13, 1.2); ctx.closePath(); ctx.fill();
  // tofs
  ctx.strokeStyle = "#2b2118"; ctx.lineWidth = 2.2; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-2, -12); ctx.quadraticCurveTo(-4, -18, -8, -19); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(3, -12.5); ctx.quadraticCurveTo(4, -19, 1, -21); ctx.stroke();
  ctx.fillStyle = sk.tuft;
  ctx.beginPath(); ctx.arc(-8, -19, 2.6, 0, TAU); ctx.arc(1, -21, 2.6, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawParticles() {
  for (const p of S.particles) {
    const k = 1 - p.t / p.life;
    if (p.kind === "puff") {
      ctx.globalAlpha = 0.5 * k;
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + p.t * 2), 0, TAU); ctx.fill();
    } else if (p.kind === "feather" || p.feather) {
      ctx.save(); ctx.globalAlpha = k;
      ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
      ctx.fillStyle = "rgb(" + p.col + ")";
      ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * 0.45, 0, 0, TAU); ctx.fill();
      ctx.restore();
    } else if (p.kind === "conf") {
      ctx.save(); ctx.globalAlpha = Math.min(1, k * 1.5);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
      ctx.fillStyle = "rgb(" + p.col + ")";
      ctx.fillRect(-p.r, -p.r * 0.6, p.r * 2, p.r * 1.2);
      ctx.restore();
    } else {
      ctx.globalAlpha = k * 0.45; // yttre glöd utan shadowBlur
      ctx.fillStyle = "rgb(" + p.col + ")";
      ctx.beginPath(); ctx.arc(p.x, p.y, (p.r * k + 0.5) * 2, 0, TAU); ctx.fill();
      ctx.globalAlpha = k;
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * k * 0.6 + 0.4, 0, TAU); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}
function drawPopups() {
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = "900 26px Nunito, sans-serif";
  for (const p of S.popups) {
    const k = 1 - p.t / 0.9;
    ctx.globalAlpha = k;
    if (p.feather) { // Phase 1A: liten turkos fjädernotis (diskret, ingen överlast)
      ctx.font = "900 17px Nunito, sans-serif";
      ctx.lineWidth = 4; ctx.strokeStyle = "#123b34";
      ctx.strokeText(p.txt, p.x, p.y);
      ctx.fillStyle = "#8df2dc";
      ctx.fillText(p.txt, p.x, p.y);
      continue;
    }
    ctx.font = "900 26px Nunito, sans-serif";
    ctx.lineWidth = 5; ctx.strokeStyle = "#2b2118";
    ctx.strokeText(p.txt, p.x, p.y);
    ctx.fillStyle = "#ffe27a";
    ctx.fillText(p.txt, p.x, p.y);
  }
  ctx.restore();
}
function drawLighting(w, h) {
  // vinjett
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(10,10,30,0.28)");
  ctx.fillStyle = v;
  ctx.fillRect(-30, S.camY - 30, w + 60, S.viewH + 60);
  // mjukt överljus uppifrån (2.5D-ljussättning)
  const tl = ctx.createLinearGradient(0, S.camY - 30, 0, h * 0.42);
  tl.addColorStop(0, "rgba(255,255,240,0.10)");
  tl.addColorStop(1, "rgba(255,255,240,0)");
  ctx.fillStyle = tl;
  ctx.fillRect(-30, S.camY - 30, w + 60, S.viewH + 60);
  if (S.world.night) {
    ctx.fillStyle = "rgba(20,10,50," + S.world.night * 0.35 + ")";
    ctx.fillRect(-30, S.camY - 30, w + 60, S.viewH + 60);
  }
}

/* ============================================================
   SIM — deterministisk testsele (Phase 0).
   Kör samma stepPlaying-kod med fast dt (1/120) och seedad RNG.
   Rör ALDRIG lagring/DOM-sidoeffekter (simMode) och återställer
   allt live-tillstånd efteråt. Används av scratch/tests/phase0-tests.js.
   ============================================================ */
const Sim = {
  FIXED: 1 / 120,

  _saved: null,
  save() {
    this._saved = {
      state: S.state, level: S.level, cfg: S.cfg, score: S.score,
      pipes: JSON.stringify(S.pipes), camX: S.camX, time: S.time, ptime: S.ptime,
      viewH: S.viewH, camY: S.camY,
      bird: { ...S.bird }, prevGapY: S.prevGapY,
      spawnLastFam: S.spawnLastFam, spawnCount: S.spawnCount,
      attempt: S.attempt, runSeed: S.runSeed,
      envId: S.envId, prevEnvId: S.prevEnvId, envBlend: S.envBlend,
      shake: S.shake, shakeT: S.shakeT, deathT: S.deathT, clearT: S.clearT,
      particlesN: S.particles.length, popupsN: S.popups.length,
      H: S.H, simMode: S.simMode, simResult: S.simResult,
      runMode: S.runMode, diff: S.diff, overdrive: S.overdrive, // Gate D
      flag: window.__DW_SIM
    };
  },
  restore() {
    const s = this._saved;
    S.state = s.state; S.level = s.level; S.cfg = s.cfg; S.score = s.score;
    S.pipes = JSON.parse(s.pipes); S.camX = s.camX; S.time = s.time; S.ptime = s.ptime;
    S.viewH = s.viewH; S.camY = s.camY;
    S.bird = { ...s.bird }; S.prevGapY = s.prevGapY;
    S.spawnLastFam = s.spawnLastFam; S.spawnCount = s.spawnCount;
    S.attempt = s.attempt; S.runSeed = s.runSeed;
    S.envId = s.envId; S.prevEnvId = s.prevEnvId; S.envBlend = s.envBlend;
    S.shake = s.shake; S.shakeT = s.shakeT; S.deathT = s.deathT; S.clearT = s.clearT;
    S.particles.length = s.particlesN; S.popups.length = s.popupsN;
    S.H = s.H; S.simMode = s.simMode; S.simResult = s.simResult;
    S.runMode = s.runMode; S.diff = s.diff; S.overdrive = s.overdrive; // Gate D
    window.__DW_SIM = s.flag;
  },

  // Starta en isolerad körning: {seed, level}. H ignoreras för gameplay
  // (Gate B: logisk spelplan 480x800 gäller överallt) men accepteras av bakåtkompatibilitet.
  begin(seed, level, H) {
    this.save();
    window.__DW_SIM = true;
    S.simMode = true; S.simResult = null;
    S.runMode = "adventure"; S.diff = level; S.overdrive = false; // Gate D
    S.H = 800; S.viewH = 800; S.camY = 0; // logisk spelplan (rendering används aldrig i Sim)
    S.ptime = 0; S.__stepIdx = 0;
    S.bird.x = S.W * TUNE.birdXfrac;
    setLevel(level);
    S.state = "playing";
    S.score = 0; S.pipes = []; S.camX = 0; S.shake = 0;
    S.prevGapY = null; S.spawnLastFam = null; S.spawnCount = 0; // Gate A: null = mittenstart
    S.runSeed = seed >>> 0;
    window.RNG.reset(S.runSeed);
    resetBird();
    S.bird.y = S.H * 0.44;
    return this;
  },

  // Ett fysiksteg med ev. flax (samma värden som flap(), utan sidoeffekter).
  // Gate B: S.ptime sköts av stepPlaying (enda källan) — inte här.
  tick(doFlap) {
    if (doFlap) { S.bird.vy = TUNE.flapVelocity; S.bird.wing = -0.9; }
    stepPlaying(this.FIXED);
  },

  end() { this.restore(); },

  // Kör en fullständig policy-styrd simulering. policy(S) -> bool (flaxa?).
  // Returnerar {result, score, ticks, hash}.
  run(seed, level, H, ticks, policy) {
    this.begin(seed, level, H);
    let t = 0;
    for (; t < ticks; t++) {
      if (S.simResult || S.state !== "playing") break;
      let f = false;
      try { f = !!policy(S); } catch (e) { this.end(); throw e; }
      this.tick(f);
    }
    const out = { result: S.simResult || (S.state === "playing" ? "timeout" : S.state),
      score: S.score, ticks: t, hash: this.hash() };
    this.end();
    return out;
  },

  hash() {
    // Gate B: endast fysiktid (ptime) hashas — visuell S.time är fri att
    // driva ambient/animationer med verklig dt utan att bryta determinism.
    const obs = S.pipes.map(o => [o.fam, r2(o.x), r2(o.gapY), r2(o.gap),
      r2(o.baseY == null ? -1 : o.baseY), r2(o.t), o.passed ? 1 : 0,
      r2(o.amp || 0), r2(o.warn || 0), r2(o.toff || 0), o.state || "-",
      r2(o.by == null ? -9999 : o.by)].join(",")).join("|");
    const s = [r2(S.bird.x), r2(S.bird.y), r2(S.bird.vy), S.score, r2(S.camX),
      r2(S.ptime), S.spawnCount, S.prevGapY == null ? -1 : r2(S.prevGapY)].join(";") + "#" + obs;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16) + ":" + s.length;
    function r2(v) { return Math.round(v * 100) / 100; }
  }
};

/* ============================================================
   HUVUDLOOP (Gate B: fast fysiksteg 1/120 via ackumulator)
   ============================================================ */
const LIVE_ACC = { STEP: 1 / 120, acc: 0 };
let lastT = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  if (!lastT) lastT = ts;
  let dt = (ts - lastT) / 1000;
  lastT = ts;
  if (S.state === "playing" && S.runMode === "daily" && dt > 0) S.dailyWall = (S.dailyWall || 0) + Math.min(dt, 1); // idea 5: slow-mo check
  if (dt > 0.05) dt = 0.05;
  if (dt <= 0) return;
  if (S.state !== "paused") update(dt);
  render();
  perfGovernor(ts);
}
/* A9: adaptiv upplösning. Mäter verkliga bildrutor under spel; om medianen över ~2 s (120 bildrutor eller 2 s) ligger över
   26 ms (<38 fps) sänks DPR-taket ett steg (2 → 1.5 → 1) och canvasen byggs om. Höjs aldrig under
   sessionen (ingen pendling). Påverkar bara skärpa — aldrig fysik/tajming (fast 1/120-steg). */
const PERF = { last: 0, t0: 0, buf: [], steps: 0 };
function perfGovernor(ts) {
  const d = PERF.last ? ts - PERF.last : 0; PERF.last = ts;
  if (S.state !== "playing" || !d || d > 250) return;
  if (!PERF.buf.length) PERF.t0 = ts;
  PERF.buf.push(d);
  /* beslut efter 120 bildrutor ELLER ~2 s (minst 20 bildrutor) — en riktigt seg enhet (10 fps)
     ska inte behöva vänta 12 s innan skärpan sänks */
  if (PERF.buf.length < 120 && !(ts - PERF.t0 >= 2000 && PERF.buf.length >= 20)) return;
  const b = PERF.buf.sort((a, c) => a - c), med = b[b.length >> 1];
  PERF.buf.length = 0;
  const cur = S.dprCap || 2;
  if (med > 26 && cur > 1 && (window.devicePixelRatio || 1) > 1) {
    S.dprCap = cur >= 2 ? 1.5 : 1; PERF.steps++;
    resize();
  }
}

/* ============================================================
   Stage C — inställningar, coach, tillgänglighet (enbart UI/sparande).
   Rör ALDRIG fysik/RNG/hinder/svårighet eller Classic/Sky-regler.
   ============================================================ */
/* A8 (P2-3) + A9 (P2-2): reducerad rörelse = eget val om spelaren gjort ett, annars systemets
   prefers-reduced-motion. Resultatet cachas (anropas per partikel/flax) och nollställs vid ändring. */
let _rmCache = null;
const _rmMq = (() => { try { return window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : null; } catch (e) { return null; } })();
try { if (_rmMq) (_rmMq.addEventListener ? _rmMq.addEventListener("change", () => { _rmCache = null; applyMotionClass(); }) : _rmMq.addListener(() => { _rmCache = null; applyMotionClass(); })); } catch (e) {}
window.DW_reducedMotion = function () { return reducedMotion(); }; // idé 4: Vävarens ledlinje (endast rendering)
function reducedMotion() {
  if (_rmCache !== null) return _rmCache;
  let v = false;
  try {
    const saved = window.SaveV2 ? SaveV2.get("reducedMotion") : false;
    const explicit = window.SaveV2 ? SaveV2.get("reducedMotionExplicit") === true : false;
    v = (explicit || saved === true) ? saved === true : !!(_rmMq && _rmMq.matches);
  } catch (e) { v = false; }
  _rmCache = v; return v;
}
function applyMotionClass() {
  try { document.body.classList.toggle("reduced-motion", reducedMotion()); } catch (e) {}
}
/* Språkbyte: applicera statiskt + rita om aktuell vy. */
function setLang(l) {
  if (!window.I18N) return "sv";
  const lang = I18N.setLang(l);
  try { if (window.SaveV2) SaveV2.set("lang", lang); } catch (e) {}
  try { syncSettingsUI(); } catch (e) {}
  // rita om aktuell vy på det nya språket
  try {
    if (S.state === "menu") { refreshMenu(); if (!menuOv.hidden) showMenu(); }
    else if (S.state === "ready") { if (S.runMode === "endless") showEndless(); else showReady(S.level); }
    else if (!overOv.hidden) showGameOver();
    else if (!clearOv.hidden) showClearPanel();
    if (!worldsOv.hidden) renderWorlds();
    if (!levelsOv.hidden) renderLevelGrid();
    try { if (dailyOv && !dailyOv.hidden) renderDaily(); } catch (e) {}
    try { if (birdsOv && !birdsOv.hidden) renderBirds(); } catch (e) {}
  } catch (e) {}
  try { const el = document.getElementById("storageNotice"); if (el && !el.hidden && storageNoticeKey) { storageNoticeDismissed = false; const k = storageNoticeKey; storageNoticeKey = null; showStorageNotice(k); } } catch (e) {}
  if (window.Analytics) Analytics.emit("lang_change", { lang });
  return lang;
}
/* Phase 0: synlig version (inställningar) — från build-manifestet via window.GAME_BUILD. */
function versionText() {
  const b = window.GAME_BUILD || {};
  const v = window.GAME_VERSION || b.version || "?";
  const c = b.commit && b.commit !== "dev" ? " · " + String(b.commit).slice(0, 12) : "";
  const ch = b.channel && b.channel !== "production" ? " · " + b.channel : "";
  return (window.I18N ? I18N.t("version_label") : "Version") + " " + v + c + ch;
}
function syncSettingsUI() {
  try { const vl = document.getElementById("versionLine"); if (vl) vl.textContent = versionText(); } catch (e) {}
  try {
    const lang = (window.I18N ? I18N.lang : "sv");
    const sv = $("langSvBtn"), en = $("langEnBtn");
    if (sv) { sv.style.opacity = lang === "sv" ? "1" : "0.6"; sv.style.borderColor = lang === "sv" ? "#2b2118" : ""; }
    if (en) { en.style.opacity = lang === "en" ? "1" : "0.6"; en.style.borderColor = lang === "en" ? "#2b2118" : ""; }
    const mb = $("motionBtn");
    if (mb) mb.textContent = reducedMotion() ? ("🎞️ " + I18N.t("motion_reduced")) : ("🎞️ " + I18N.t("motion_full"));
    const vs = $("volSlider");
    if (vs) { try { vs.value = String(Math.round(AudioFX.volume * 100)); } catch (e) {} }
    const ms = $("musicSlider");
    if (ms) { try { ms.value = String(Math.round(AudioFX.musicVol * 100)); } catch (e) {} }
    // music row only when the active sound pack has music (legacy pack: none; draft pack: behind ?audio=v1-draft)
    const mr = $("musicRow"); if (mr) mr.hidden = !AudioFX.hasMusic();
  } catch (e) {}
}
function toggleMotion() {
  const v = !reducedMotion();
  try { if (window.SaveV2) { SaveV2.set("reducedMotion", v); SaveV2.set("reducedMotionExplicit", true); } } catch (e) {}
  _rmCache = null;
  applyMotionClass();
  try { syncSettingsUI(); } catch (e) {}
  if (window.Analytics) Analytics.emit("motion_change", { reduced: v });
}
/* Coach-tips per familj: visas en gång per familj, auto-dismiss,
   sett-flaggor sparas i v2 (lokalt, ingen nätverk). */
let _coachTimer = 0;
function familiesIntroducedAt(level) {
  try { return Object.keys(window.OBSTACLE_INTRO || {}).filter(id => window.OBSTACLE_INTRO[id] === level); }
  catch (e) { return []; }
}
function showCoachTip(level) {
  hideCoachTip(false);
  try {
    if (window.__DW_SIM || S.simMode) return;
    const seen = (window.SaveV2 && SaveV2.get("seenTips")) || {};
    const fresh = familiesIntroducedAt(level).filter(id => !seen[id]);
    if (!fresh.length) return;
    const id = fresh[0];
    const el = $("coachTip");
    if (!el) return;
    el.textContent = I18N.t("coach_" + id);
    el.hidden = false;
    if (window.Analytics) Analytics.emit("coach_show", { fam: id, level });
    _coachTimer = setTimeout(() => hideCoachTip(true), 6000);
  } catch (e) {}
}
function hideCoachTip(markSeen) {
  try {
    if (_coachTimer) { clearTimeout(_coachTimer); _coachTimer = 0; }
    const el = $("coachTip");
    if (!el || el.hidden) return;
    el.hidden = true;
    if (markSeen && window.__DW_SIM !== true && !S.simMode) {
      const txt = el.textContent;
      // matcha mot alla coach-strängar (språkoberoende via båda språken)
      for (const L of ["sv", "en"]) {
        const tab = I18N.STRINGS[L] || {};
        for (const k of Object.keys(tab)) {
          if (k.indexOf("coach_") === 0 && tab[k] === txt && window.SaveV2) SaveV2.markTipSeen(k.slice(6));
        }
      }
    }
  } catch (e) {}
}

/* ---------- A3: lagringsnotis ---------- */
let storageNoticeKey = null, storageNoticeDismissed = false;
function showStorageNotice(key) {
  try {
    if (!key || (storageNoticeDismissed && key === storageNoticeKey)) return;
    storageNoticeKey = key; storageNoticeDismissed = false;
    const el = document.getElementById("storageNotice"), tx = document.getElementById("storageNoticeText");
    if (!el || !tx) return;
    tx.textContent = (window.I18N ? I18N.t(key) : key);
    const cb = document.getElementById("storageNoticeClose");
    if (cb) cb.setAttribute("aria-label", (window.I18N && I18N.lang === "en") ? "Close" : "Stäng");
    el.hidden = false;
  } catch (e) {}
}
function storageNoticeKeyNow(saveInfo) {
  const st = window.SafeStorage ? SafeStorage.status() : { mode: "local" };
  if (st.mode !== "local") return "storage_off";
  if (saveInfo && saveInfo.migrationFailed) return "storage_migrate";
  if (st.quotaHit || (st.failedKeys && st.failedKeys.length)) return "storage_quota";
  return null;
}
function initStorageNotice(saveInfo) {
  try {
    const cb = document.getElementById("storageNoticeClose");
    if (cb) cb.addEventListener("click", () => { storageNoticeDismissed = true; const el = document.getElementById("storageNotice"); if (el) el.hidden = true; });
    showStorageNotice(storageNoticeKeyNow(saveInfo));
    if (window.SafeStorage) SafeStorage.onIssue(() => showStorageNotice(storageNoticeKeyNow(saveInfo)));
  } catch (e) {}
}

/* ---------- boot ---------- */
function isFreshPlayer() {
  if (!window.SaveV2) return false;
  try {
    return SaveV2.get("idNew") === true && store.unlocked <= 1 && !store.best(1) && !store.isCleared("classic", 1) &&
      (SaveV2.getFeathers() | 0) === 0 && !Object.keys(SaveV2.get("seenTips") || {}).length;
  } catch (e) { return false; }
}
function boot() {
  // Identity V1: one class switches the whole Dipwing look (flag off ⇒ legacy look, same game)
  try { if (window.IDENTITY && IDENTITY.V1) { document.body.classList.add("id-v1"); const bb = $("birdsBtn"); if (bb) bb.setAttribute("data-i18n", "closet_btn"); } } catch (e) {}
  resize();
  // Stage C: versionerad sparning — migrera v1 → v2, återställ vid korruption
  let saveInfo = null;
  try { if (window.SaveV2) saveInfo = SaveV2.load(); } catch (e) {}
  try { store.migrateProgress(); } catch (e) {}
  // språk + rörelse + volym från v2 (sv/full/100 som standard)
  try {
    if (window.I18N && window.SaveV2) I18N.setLang(SaveV2.get("lang") || "en");
    else if (window.I18N) I18N.setLang("en");
  } catch (e) {}
  try { if (window.SaveV2) AudioFX.setVolume(SaveV2.get("soundVol") != null ? SaveV2.get("soundVol") : 1); } catch (e) {}
  try { const mv = window.SaveV2 ? Number(SaveV2.get("musicVol")) : NaN; AudioFX.setMusicVolume(Number.isFinite(mv) ? mv : 0.5); } catch (e) {}
  applyMotionClass();
  try { validateProgressMapping(); } catch (e) {}
  try { if (window.SaveV2) S.birdSkin = Econ.skin(); } catch (e) {} // Phase 1A: utrustad fågel
  try { Econ.cosEquipped(); } catch (e) {} // v0.4: cache equipped cosmetics once (render never reads storage)
  setLevel(1);
  S.selectedLevel = 1;
  S.levelFilterWorld = Progress.worldDefForLevel(1).id;
  resetBird();
  buildGrid();
  showMenu();
  // F2 launch-fit: a brand-new player lands on the level-1 ready card (one tap to fly). The storage
  // notice, rotation veil and first-gesture audio still apply; "Menu" on the card skips it.
  try { if (isFreshPlayer() && !/[?&]land=0(&|$)/.test(location.search)) showReady(1); } catch (e) {}
  syncSettingsUI();
  initStorageNotice(saveInfo);
  if (saveInfo && (saveInfo.migrated || saveInfo.recovered) && window.Analytics)
    Analytics.emit("save_boot", saveInfo.recovered ? { recovered: true } : { migrated: true });
  setTimeout(resize, 60);
  requestAnimationFrame(loop);
}
if (document.readyState === "complete" || document.readyState === "interactive") boot();
else document.addEventListener("DOMContentLoaded", boot);

// exponera för test/felsökning.
// E1 (production lock): the full writable surface exists only in dev and dist-test. tools/build.mjs strips this
// block from dist/ and the Perchance package, which get the minimal frozen object below instead.
// This is hygiene, NOT anti-cheat: SaveV2 etc. still live in the same JS heap.
if (!window.__dipwing) window.__dipwing = Object.freeze({ prod: true, version: window.GAME_VERSION,
  verifyReceipt: rc => { try { return Daily.verify(rc); } catch (e) { return { ok: false, why: "error" }; } } });

})();
