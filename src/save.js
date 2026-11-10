/* ============================================================
   DIPWING — src/save.js (Stage C + Phase 1A: versionerad sparning)
   Centralt sparformat v2 (schema utökat i Phase 1A — v kvarstår 2).
   Regler:
   - v1-nycklar (pfb_unlocked/best/cleared/muted) förblir LIVE speglar:
     alla legacy-skrivningar skriver både v1 och v2. Gamla tester och
     återvändande spelare påverkas aldrig.
   - pfb_save_v2 är sanningen för NYA fält (lang, reducedMotion,
     seenTips + Phase 1A: feathers, birdsOwned, birdEquipped, daily,
     bonus) + en samlad dokumentspegel av legacy-fälten.
   - validate() bygger ALLTID om dokumentet från en whitelist och
     normaliserar varje ekonomifält (ogiltiga värden ⇒ säkra
     standardvärden, aldrig krasch, aldrig NaN i lagring). Därför MÅSTE
     nya fält valideras här — generisk set() på okända nycklar tappas
     vid nästa load/mirror (medvetet).
   - Korrupt v2 ⇒ säkerhetskopiera råtexten (max 3 kopior), bygg om
     från v1-speglarna, fortsätt utan att krascha.
   - Ingen nätverk, inga konton (medvetet — se SKY_MODE_PROPOSAL).
   - Daily-datum: lokal kalenderdag "YYYY-MM-DD" (enhetens tidszon).
     Enhetens klocka kan flyttas av användaren — utan backend går det
     inte att skydda belöningar mot manuella klockändringar (medvetet,
     dokumenterat i README).
   ============================================================ */
(function () {
"use strict";

const V2_KEY = "pfb_save_v2";
const BACKUP_KEY = "pfb_save_v2_backup"; // Gate C: senaste giltiga v2 (skrivs före varje ersättning)
const CORRUPT_PREFIX = "pfb_save_v2_corrupt_";
/* A3: versioner. READ_MIN = äldsta format vi läser (v2, live 2026-11-10). CURRENT = det vi skriver.
   v3 = v2 + integritetsfält (_seq, _writer, _sum). Nyare versioner (> CURRENT) accepteras och
   bevaras (v sänks aldrig, okända fält behålls). */
const SAVE_VERSION = 2; // READ_MIN (namnet behålls för bakåtkompatibilitet)
const CURRENT_VERSION = 3;
/* v0.4 extension level (additive, no version bump so the imported Perchance gate C3 and every older
   build keep reading the file): ext 1 = cosmetics.v1 + fcLevel (first clear once per level) + econDay.
   Upgraded once in load() with a pristine snapshot (pfb_save_premigration_v3x1) and rollback on error. */
const CURRENT_EXT = 1;
const PREMIGRATION_PREFIX = "pfb_save_premigration_v"; // orörd kopia före varje migrering (raderas aldrig)
const V1 = {
  unlocked: "pfb_unlocked_v1",
  best: "pfb_best_v1",
  bestSky: "pfb_best_sky_v1",
  cleared: "pfb_cleared_v1",
  clearedSky: "pfb_cleared_sky_v1",
  endless: "pfb_endless_v1",       // Gate D: endless-rekord (classic)
  endlessSky: "pfb_endless_sky_v1", // Gate D: endless-rekord (sky)
  medals: "pfb_medals_v1",          // Gate D: medaljer {classic:{lvl:1-3},sky:{}}
  muted: "pfb_muted_v1"
};

/* A3: all lagring via SafeStorage (blockerad/full lagring ⇒ minnesläge, aldrig undantag). */
function rawGet(k) {
  try { return window.SafeStorage ? SafeStorage.get(k) : localStorage.getItem(k); }
  catch (e) { return null; }
}
function rawSet(k, v) {
  try { return window.SafeStorage ? SafeStorage.set(k, v) : (localStorage.setItem(k, v), true); } catch (e) { return false; }
}
function rawKeys() {
  try { if (window.SafeStorage) return SafeStorage.keys(); } catch (e) {}
  const out = []; try { for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)); } catch (e) {}
  return out;
}
function rawRemove(k) { try { if (window.SafeStorage) SafeStorage.remove(k); else localStorage.removeItem(k); } catch (e) {} }
/* A3: kontrollsumma (FNV-1a 32 bit över dokumentet utan _sum). Upptäcker korrupt/ändrad text —
   INTE ett fuskskydd (allt lokalt går att ändra). */
function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ("0000000" + (h >>> 0).toString(16)).slice(-8); }
function sumOf(obj) { const c = {}; for (const k of Object.keys(obj)) if (k !== "_sum") c[k] = obj[k]; return fnv(JSON.stringify(c)); }
function verifyChecksum(obj) { return !!obj && typeof obj._sum === "string" && obj._sum === sumOf(obj); }
function testHooks() { try { const b = window.GAME_BUILD || {}; return b.testHooks === true || b.channel === "dev"; } catch (e) { return false; } }
function parseObj(raw) {
  if (raw == null) return { found: false };
  try {
    const v = JSON.parse(raw);
    return { found: true, value: v };
  } catch (e) { return { found: true, corrupt: true, raw }; }
}
function int1(v) { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 1 ? n : 1; }
function objMap(v) { return (v && typeof v === "object" && !Array.isArray(v)) ? v : {}; }

/* --- Phase 1A: ekonomifält (strikt normaliserade — korrupt data ⇒ säkra
   standardvärden, aldrig krasch, aldrig dataförlust av övriga fält). --- */
const FEATHER_MAX = 999999;
const BIRD_FALLBACK = ["tornis", "sunny", "lagoon"];
function birdIds() {
  try {
    const b = window.ECON && window.ECON.BIRDS;
    if (Array.isArray(b) && b.length && b.every(x => x && typeof x.id === "string")) return b.map(x => x.id);
  } catch (e) {}
  return BIRD_FALLBACK.slice();
}
function int0(v, cap) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, cap == null ? FEATHER_MAX : cap);
}
function map01(v) { // {nyckel:1}-ledger (bonus/cleared-liknande)
  const o = objMap(v), out = {};
  for (const k of Object.keys(o)) { if (o[k] === 1 || o[k] === true) out[k] = 1; }
  return out;
}
/* Gate D: medaljer 1–3 stjärnor per (läge, nivå). Ogiltiga värden ⇒ säkra defaults. */
function medalMap(v) {
  const o = objMap(v), out = {};
  for (const k of Object.keys(o)) {
    const n = Math.floor(Number(o[k]));
    if (Number.isFinite(n) && n >= 1 && n <= 3 && /^\d+$/.test(k)) out[k] = Math.min(3, Math.max(1, n));
  }
  return out;
}
/* Gate E: dagens bästa + ghost (per-pipe-steg). Steglistor kapas (max 5000). */
function ghostNorm(v) {
  const o = objMap(v), out = { date: dateStr(o.date), score: 0, steps: [] };
  out.score = Math.max(0, Math.min(1000000, Math.floor(Number(o.score)) || 0));
  if (Array.isArray(o.steps)) {
    for (const s of o.steps.slice(0, 5000)) {
      const n = Math.floor(Number(s));
      if (Number.isFinite(n) && n >= 0) out.steps.push(n);
    }
  }
  return out;
}
/* v4: Courier Closet (cosmetics.v1). Birds stay in birdsOwned/birdEquipped (unchanged, backward
   compatible); cosmetics holds the other slots. Unknown ids are preserved (forward-compat). */
const COS_SLOTS = ["scarf", "hat", "trail"];
const COS_DEFAULT_OWNED = { scarf: ["coral"], hat: [], trail: ["ribbon"] };
const COS_DEFAULT_EQ = { scarf: "coral", hat: null, trail: "ribbon" };
function cosNorm(v) {
  const o = objMap(v), own = objMap(o.owned), eq = objMap(o.equipped), out = { v: 1, owned: {}, equipped: {} };
  for (const sl of COS_SLOTS) {
    const list = [];
    for (const id of COS_DEFAULT_OWNED[sl]) list.push(id);
    if (Array.isArray(own[sl])) for (const id of own[sl]) if (typeof id === "string" && BIRD_ID_RE.test(id) && list.indexOf(id) < 0) list.push(id);
    out.owned[sl] = list;
    const e = eq[sl];
    out.equipped[sl] = (e === null && sl === "hat") ? null
      : (typeof e === "string" && list.indexOf(e) >= 0) ? e : COS_DEFAULT_EQ[sl];
  }
  return out;
}
/* levels already paid in Classic OR Sky count as paid (no clawback, no double pay) */
function seedFc(bonus) { const fc = {}; const bo = objMap(bonus); for (const m of ["classic", "sky"]) for (const k of Object.keys(objMap(bo[m]))) if (bo[m][k]) fc[k] = 1; return fc; }
function upgradeExt(d) { // pure: v3 doc without ext ⇒ ext 1
  const o = clone(d); o.ext = CURRENT_EXT; o.fcLevel = Object.assign(seedFc(o.bonus), map01(o.fcLevel));
  o.cosmetics = cosNorm(o.cosmetics); o.econDay = econDayNorm(o.econDay);
  if (testHooks() && window.__testFailMigration) throw new Error("test: forced ext upgrade failure");
  const v = validate(o); if (!v.doc) throw new Error("ext upgrade invalid: " + v.error); return v.doc;
}
function econDayNorm(v) {
  const o = objMap(v);
  return { day: dateStr(o.day), n: int0(o.n, 1000000) };
}
function dateStr(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const m = Number(v.slice(5, 7)), d = Number(v.slice(8, 10));
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return v;
}
/* A3 (P2-7): okända fågel-ID:n (t.ex. från en nyare version) BEVARAS — de visas inte och kan inte
   utrustas via UI, men raderas aldrig. Endast skräp (fel typ/format) filtreras bort. */
const BIRD_ID_RE = /^[a-z0-9_-]{1,40}$/i;
function normOwned(v, ids) {
  const out = [];
  if (Array.isArray(v)) for (const id of v) {
    if (typeof id === "string" && (ids.indexOf(id) >= 0 || BIRD_ID_RE.test(id)) && out.indexOf(id) < 0) out.push(id);
  }
  if (out.indexOf("sunny") < 0) out.unshift("sunny"); // standardfågeln kan aldrig förloras
  if (out.indexOf("tornis") < 0) out.push("tornis");  // Identity V1: Tornis is free for everyone (a gift, never a removal)
  return out;
}
/* Lokal kalenderdag "YYYY-MM-DD" (enhetens tidszon). */
function localDateStr(d) {
  try {
    const t = d instanceof Date ? d : new Date();
    const m = String(t.getMonth() + 1).padStart(2, "0");
    const day = String(t.getDate()).padStart(2, "0");
    return t.getFullYear() + "-" + m + "-" + day;
  } catch (e) { return null; }
}
/* Gate C: UTC-dag "YYYY-MM-DD" — EN konsekvent konvention för dagbelöningar
   (oavsiktliga tidszonsbyten ger inte dubbla claims). */
function utcDateStr(d) {
  try {
    const t = d instanceof Date ? d : new Date();
    return t.toISOString().slice(0, 10);
  } catch (e) { return null; }
}

/* Validera/normalisera ett spar-dokument. Returnerar {doc} eller {error}.
   Gate C: okända fält bevaras (forward-compat — en framtida version tappar
   aldrig data hos en äldre klient); nyare versioner accepteras. */
function validate(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return { error: "not-object" };
  const vnum = Math.floor(Number(d.v));
  if (!Number.isFinite(vnum) || vnum < SAVE_VERSION) return { error: "version" };
  // (A3: vnum > CURRENT_VERSION accepteras — framtida format, se load())
  const out = { v: vnum };
  for (const k of Object.keys(d)) { // bevara okända/framtida fält oförändrade
    if (!(k in out)) {
      try { out[k] = JSON.parse(JSON.stringify(d[k])); } catch (e) { out[k] = d[k]; }
    }
  }
  out.v = vnum;
  out.unlocked = int1(d.unlocked);
  out.best = objMap(d.best);
  out.bestSky = objMap(d.bestSky);
  out.cleared = objMap(d.cleared);
  out.clearedSky = objMap(d.clearedSky);
  out.muted = d.muted === true || d.muted === 1 || d.muted === "1";
  out.soundVol = Math.max(0, Math.min(1, Number(d.soundVol != null ? d.soundVol : 1)));
  if (!Number.isFinite(out.soundVol)) out.soundVol = 1;
  out.lang = (d.lang === "en" || d.lang === "sv") ? d.lang : "sv";
  out.reducedMotion = d.reducedMotion === true;
  out.seenTips = objMap(d.seenTips);
  /* Phase 1A — ekonomi (alla fält valideras, aldrig okända nycklar): */
  const ids = birdIds();
  out.feathers = int0(d.feathers, FEATHER_MAX);
  out.birdsOwned = normOwned(d.birdsOwned, ids);
  out.idNew = d.idNew === true; // Identity V1: profile created after the Dipwing identity (no legacy Sunny in the shop)
  out.birdEquipped = (typeof d.birdEquipped === "string" && out.birdsOwned.indexOf(d.birdEquipped) >= 0)
    ? d.birdEquipped : (out.idNew ? "tornis" : "sunny");
  const dy = objMap(d.daily);
  out.daily = { lastClaim: dateStr(dy.lastClaim), claimedTotal: int0(dy.claimedTotal, 100000),
    lastSeen: dateStr(dy.lastSeen) }; // Gate C: senaste sedda UTC-dag (klockskydd)
  const bo = objMap(d.bonus);
  out.bonus = { classic: map01(bo.classic), sky: map01(bo.sky) };
  /* Gate D: endless-rekord + medaljer (nya v1-speglar, aldrig migrerade bakåt). */
  out.endlessBest = int0(d.endlessBest, 1000000);
  out.endlessBestSky = int0(d.endlessBestSky, 1000000);
  const md = objMap(d.medals);
  out.medals = { classic: medalMap(md.classic), sky: medalMap(md.sky) };
  /* Gate E: dagens bästa + ghost (alltid per UTC-datum, aldrig global ranking). */
  const db = objMap(d.dailyBest);
  out.dailyBest = { date: dateStr(db.date), score: int0(db.score, 1000000) };
  out.ghostDaily = ghostNorm(d.ghostDaily);
  /* v4 fields (defaults for older docs; written by MIGRATIONS[3]) */
  out.cosmetics = cosNorm(d.cosmetics);
  out.fcLevel = d.fcLevel ? map01(d.fcLevel) : seedFc(out.bonus); // E5: first-clear paid once per LEVEL (any mode)
  out.econDay = econDayNorm(d.econDay);  // daily obstacle bonus counter {day (UTC), n}
  return { doc: out };
}

function v1best(k) {
  const p = parseObj(rawGet(k));
  if (!p.found || p.corrupt) return {};
  return objMap(p.value);
}

/* Bygg v2-dokument från v1-speglar + standardvärden för nya fält. */
/* A8 (P1-5): språk för NYA spelare följer webbläsaren (sv* ⇒ sv, annars en). Spelare med gammal
   data (v1-nycklar) behåller svenska som tidigare; ett sparat val ändras aldrig automatiskt. */
function detectLang() {
  try {
    const list = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ""];
    for (const l of list) { const c = String(l || "").toLowerCase(); if (c.indexOf("sv") === 0) return "sv"; if (c) return "en"; }
  } catch (e) {}
  return "en"; // Identity V1 / F2: English is the default when the browser gives no hint
}
function hasV1Data() { try { return Object.keys(V1).some(k => rawGet(V1[k]) != null); } catch (e) { return false; } }
function fromV1() {
  const legacy = hasV1Data();
  return {
    v: 2,
    unlocked: int1(rawGet(V1.unlocked)),
    best: v1best(V1.best),
    bestSky: v1best(V1.bestSky),
    cleared: v1best(V1.cleared),
    clearedSky: v1best(V1.clearedSky),
    muted: rawGet(V1.muted) === "1",
    soundVol: 1,
    lang: legacy ? "sv" : detectLang(),
    reducedMotion: false,
    seenTips: {},
    /* Phase 1A — nya spelare börjar med 0 fjädrar, standardfågel ägd+utrustad. */
    feathers: 0,
    /* Identity V1: NEW players start as Tornis; players with legacy data keep Sunny equipped. */
    birdsOwned: ["sunny", "tornis"],
    birdEquipped: legacy ? "sunny" : "tornis",
    idNew: !legacy,
    daily: { lastClaim: null, claimedTotal: 0, lastSeen: null },
    bonus: { classic: {}, sky: {} },
    /* Gate D — nya spelare börjar utan endless-rekord och medaljer. */
    endlessBest: 0,
    endlessBestSky: 0,
    medals: { classic: {}, sky: {} },
    /* Gate E — ingen dagshistorik ännu. */
    dailyBest: { date: null, score: 0 },
    ghostDaily: { date: null, score: 0, steps: [] }
  };
}

/* A3: minnescache (P2-2) + skrivlås vid misslyckad migrering.
   _cache.raw = senast lästa/skrivna råtext; träff ⇒ ingen JSON.parse/validate per anrop. */
const _cache = { raw: null, doc: null, info: null };
let _writeLock = false; // true efter misslyckad migrering: originalfilen lämnas orörd (rollback)
function clone(o) { try { return typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o)); } catch (e) { return JSON.parse(JSON.stringify(o)); } }

function saveDoc(doc) {
  try {
    // A3: v sänks aldrig; integritetsfält; skriv huvudnyckeln, läs tillbaka och verifiera,
    // först därefter blir samma text ny backup (backup = senaste VERIFIERADE dokument).
    // localStorage.setItem är atomisk per nyckel; en avbruten skrivning lämnar gammalt värde.
    if (!(doc.v >= CURRENT_VERSION)) doc.v = CURRENT_VERSION;
    doc._seq = (Math.floor(Number(doc._seq)) || 0) + 1;
    doc._writer = String(window.GAME_VERSION || "?");
    delete doc._sum;
    doc._sum = sumOf(doc);
    const text = JSON.stringify(doc);
    _cache.raw = _writeLock ? _cache.raw : text; _cache.doc = clone(doc);
    if (_writeLock) return false;
    const ok = rawSet(V2_KEY, text);
    if (ok && rawGet(V2_KEY) === text) {
      try { if (validate(JSON.parse(text)).doc) rawSet(BACKUP_KEY, text); } catch (e) {}
    }
    _cache.raw = rawGet(V2_KEY); // minnesöverlägg vid kvotfel ⇒ samma text
    return ok;
  } catch (e) { return false; }
}

/* Spegla aktuella v1-värden in i v2 (bevara nya fält). Anropas efter
   varje legacy-skrivning — billig (nivåavslut/mute), aldrig i heta loopar. */
function mirror() {
  try {
    let base;
    if (_writeLock && _cache.doc) base = clone(_cache.doc); // rollback-läge: arbeta i minnet
    else {
      const cur = parseObj(rawGet(V2_KEY));
      base = (cur.found && !cur.corrupt && validate(cur.value).doc) || fromV1();
    }
    base.unlocked = int1(rawGet(V1.unlocked));
    base.best = v1best(V1.best);
    base.bestSky = v1best(V1.bestSky);
    base.cleared = v1best(V1.cleared);
    base.clearedSky = v1best(V1.clearedSky);
    base.endlessBest = int0(rawGet(V1.endless), 1000000); // Gate D
    base.endlessBestSky = int0(rawGet(V1.endlessSky), 1000000);
    base.medals = { classic: medalMap(v1best(V1.medals).classic), sky: medalMap(v1best(V1.medals).sky) };
    base.muted = rawGet(V1.muted) === "1";
    saveDoc(base);
    return base;
  } catch (e) { return null; }
}

function pruneCorrupt() {
  try {
    const keys = rawKeys().filter(k => k && k.indexOf(CORRUPT_PREFIX) === 0).sort();
    while (keys.length > 3) { rawRemove(keys.shift()); }
  } catch (e) {}
}
/* A3: rädda ekonomifält ur text som inte går att JSON-parsa (trunkerad/avbruten skrivning). */
function salvageText(raw) {
  const out = {};
  const num = re => { const m = raw.match(re); return m ? Math.floor(Number(m[1])) : null; };
  const str = re => { const m = raw.match(re); return m ? m[1] : null; };
  const f = num(/"feathers"\s*:\s*(\d+)/); if (f != null) out.feathers = f;
  const un = num(/"unlocked"\s*:\s*(\d+)/); if (un != null) out.unlocked = un;
  const eb = num(/"endlessBest"\s*:\s*(\d+)/); if (eb != null) out.endlessBest = eb;
  const ebs = num(/"endlessBestSky"\s*:\s*(\d+)/); if (ebs != null) out.endlessBestSky = ebs;
  const ob = raw.match(/"birdsOwned"\s*:\s*\[([^\]]*)\]/);
  if (ob) out.birdsOwned = (ob[1].match(/"([^"\\]{1,40})"/g) || []).map(s => s.slice(1, -1));
  const eq = str(/"birdEquipped"\s*:\s*"([^"\\]{1,40})"/); if (eq) out.birdEquipped = eq;
  const dm = raw.match(/"daily"\s*:\s*\{([^}]*)/);
  if (dm) { const d = {}; const t = dm[1];
    const lc = t.match(/"lastClaim"\s*:\s*"(\d{4}-\d{2}-\d{2})"/); if (lc) d.lastClaim = lc[1];
    const ct = t.match(/"claimedTotal"\s*:\s*(\d+)/); if (ct) d.claimedTotal = Number(ct[1]);
    const ls = t.match(/"lastSeen"\s*:\s*"(\d{4}-\d{2}-\d{2})"/); if (ls) d.lastSeen = ls[1];
    out.daily = d; }
  return out;
}

/* A3: migreringar (äldre giltigt format ⇒ CURRENT). Varje steg är ren funktion av dokumentet. */
const MIGRATIONS = {
  2: d => { d.v = 3; if (d._seq == null) d._seq = 0; return d; } // v2→v3: endast integritetsfält
};
function migrate(doc) {
  let d = clone(doc);
  while (d.v < CURRENT_VERSION) {
    const step = MIGRATIONS[d.v];
    if (!step) throw new Error("no migration from v" + d.v);
    if (testHooks() && window.__testFailMigration) throw new Error("test: forced migration failure");
    d = step(d);
  }
  const v = validate(d);
  if (!v.doc) throw new Error("migrated doc invalid: " + v.error);
  return ((v.doc.ext | 0) >= CURRENT_EXT) ? v.doc : upgradeExt(v.doc);
}

/* Ladda: giltig ⇒ använd (migrera vid behov, med orörd ögonblicksbild + rollback). Saknas ⇒ bygg
   från v1-speglar. Korrupt ⇒ SÄKER återställning:
   1) backup (senaste verifierade dokument) — ekonomi intakt.
   2) salvage: giltiga fält ur den korrupta texten (JSON eller, om trasig, textsökning) + v1-legacy.
   3) sist fromV1(). Råtexten arkiveras alltid (max 3 kopior).
   Returnerar {doc, migrated, recovered, via, integrity, migrationFailed}. */
function finish(info, raw) {
  _cache.info = info;
  if (!_writeLock || _cache.raw == null) _cache.raw = raw != null ? raw : rawGet(V2_KEY);
  _cache.doc = clone(info.doc);
  return info;
}
function load() {
  const raw0 = rawGet(V2_KEY);
  const cur = parseObj(raw0);
  if (!cur.found) {
    const doc = fromV1();
    saveDoc(doc);
    return finish({ doc: clone(doc), migrated: true, recovered: false, via: "v1", integrity: "new" });
  }
  if (!cur.corrupt) {
    const v = validate(cur.value);
    if (v.doc) {
      const integrity = typeof cur.value._sum === "string" ? (verifyChecksum(cur.value) ? "ok" : "mismatch") : "unsigned";
      if (integrity === "mismatch") { // A3: upptäckt men icke-destruktiv — arkivera kopia för felsökning
        try { rawSet(CORRUPT_PREFIX + Date.now() + "_mismatch", raw0); pruneCorrupt(); } catch (e) {}
      }
      if (v.doc.v < CURRENT_VERSION) {
        const snapKey = PREMIGRATION_PREFIX + v.doc.v;
        try { if (rawGet(snapKey) == null) rawSet(snapKey, raw0); } catch (e) {}
        try {
          const m = migrate(v.doc);
          _writeLock = false;
          saveDoc(m);
          return finish({ doc: clone(m), migrated: true, from: v.doc.v, recovered: false, via: "v2", integrity });
        } catch (e) {
          // ROLLBACK: lämna originalfilen orörd; spela vidare med gamla datan, inga skrivningar till huvudnyckeln.
          _writeLock = true;
          return finish({ doc: v.doc, migrated: false, migrationFailed: true, error: String(e && e.message || e), recovered: false, via: "v2", integrity }, raw0);
        }
      }
      if (!((v.doc.ext | 0) >= CURRENT_EXT)) { // v0.4 additive upgrade with snapshot + rollback
        const snapKey = PREMIGRATION_PREFIX + v.doc.v + "x" + CURRENT_EXT;
        try { if (rawGet(snapKey) == null) rawSet(snapKey, raw0); } catch (e) {}
        try {
          const m = upgradeExt(v.doc);
          saveDoc(m);
          return finish({ doc: clone(m), migrated: true, from: v.doc.v, recovered: false, via: "v2", integrity });
        } catch (e) {
          _writeLock = true;
          return finish({ doc: v.doc, migrated: false, migrationFailed: true, error: String(e && e.message || e), recovered: false, via: "v2", integrity }, raw0);
        }
      }
      return finish({ doc: v.doc, migrated: false, recovered: false, via: "v2", integrity }, raw0);
    }
  }
  // korrupt (trasig JSON eller fel form) — arkivera råtexten först
  const raw = String(cur.raw != null ? cur.raw : raw0);
  try { rawSet(CORRUPT_PREFIX + Date.now(), raw); } catch (e) {}
  pruneCorrupt();
  // 1) backup
  try {
    const b = parseObj(rawGet(BACKUP_KEY));
    if (b.found && !b.corrupt) {
      const v = validate(b.value);
      if (v.doc) {
        const d = v.doc.v < CURRENT_VERSION ? migrate(v.doc) : v.doc;
        saveDoc(d);
        return finish({ doc: clone(d), migrated: false, recovered: true, via: "backup", integrity: "recovered" });
      }
    }
  } catch (e) {}
  // 2) salvage: giltiga ekonomifält ur korrupt råtext (JSON eller textsökning) + v1-speglar
  try {
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = salvageText(raw); }
    if (parsed && typeof parsed === "object") {
      const doc = fromV1();
      const ids = birdIds();
      if (Number.isFinite(Math.floor(Number(parsed.feathers))) && parsed.feathers >= 0)
        doc.feathers = Math.min(FEATHER_MAX, Math.floor(Number(parsed.feathers)));
      if (Number.isFinite(Math.floor(Number(parsed.unlocked))) && parsed.unlocked > doc.unlocked)
        doc.unlocked = Math.floor(Number(parsed.unlocked)); // höj endast
      if (Array.isArray(parsed.birdsOwned)) {
        const kept = normOwned(parsed.birdsOwned, ids);
        if (kept.length) {
          doc.birdsOwned = kept;
          if (typeof parsed.birdEquipped === "string" && doc.birdsOwned.indexOf(parsed.birdEquipped) >= 0)
            doc.birdEquipped = parsed.birdEquipped;
        }
      }
      const pd = parsed.daily;
      if (pd && typeof pd === "object") {
        if (dateStr(pd.lastClaim)) doc.daily.lastClaim = pd.lastClaim;
        if (Number.isFinite(Math.floor(Number(pd.claimedTotal))) && pd.claimedTotal >= 0)
          doc.daily.claimedTotal = Math.min(100000, Math.floor(Number(pd.claimedTotal)));
        if (dateStr(pd.lastSeen)) doc.daily.lastSeen = pd.lastSeen;
      }
      const pb = parsed.bonus;
      if (pb && typeof pb === "object") {
        doc.bonus = { classic: map01(pb.classic), sky: map01(pb.sky) };
      }
      /* Gate D: salvage även endless + medaljer. */
      if (Number.isFinite(Math.floor(Number(parsed.endlessBest))) && parsed.endlessBest >= 0)
        doc.endlessBest = Math.min(1000000, Math.floor(Number(parsed.endlessBest)));
      if (Number.isFinite(Math.floor(Number(parsed.endlessBestSky))) && parsed.endlessBestSky >= 0)
        doc.endlessBestSky = Math.min(1000000, Math.floor(Number(parsed.endlessBestSky)));
      const pm = parsed.medals;
      if (pm && typeof pm === "object") {
        doc.medals = { classic: medalMap(pm.classic), sky: medalMap(pm.sky) };
      }
      /* Gate E: salvage även dagens bästa + ghost. */
      const pdb = parsed.dailyBest;
      if (pdb && typeof pdb === "object" && dateStr(pdb.date)) {
        doc.dailyBest = { date: pdb.date, score: int0(pdb.score, 1000000) };
      }
      if (parsed.ghostDaily && typeof parsed.ghostDaily === "object") {
        const g = ghostNorm(parsed.ghostDaily);
        if (g.date && g.steps.length) doc.ghostDaily = g;
      }
      const vd = validate(doc).doc || doc;
      // A3: v1-speglarna är källan för progression (mirror()) — höj dem till räddade värden så
      // att salvage inte skrivs över vid nästa spegling. Sänker aldrig.
      try {
        if (vd.endlessBest > int0(rawGet(V1.endless), 1000000)) rawSet(V1.endless, String(vd.endlessBest));
        if (vd.endlessBestSky > int0(rawGet(V1.endlessSky), 1000000)) rawSet(V1.endlessSky, String(vd.endlessBestSky));
        if (vd.unlocked > int1(rawGet(V1.unlocked))) rawSet(V1.unlocked, String(vd.unlocked));
      } catch (e) {}
      saveDoc(vd);
      return finish({ doc: clone(vd), migrated: false, recovered: true, via: "salvage", integrity: "recovered" });
    }
  } catch (e) {}
  // 3) sista utväg: bygg om från v1 (ekonomi förlorad — dokumenterad begränsning)
  const doc = fromV1();
  saveDoc(doc);
  return finish({ doc: clone(doc), migrated: false, recovered: true, via: "v1", integrity: "recovered" });
}

/* A3/P2-2: läs via minnescache. Träff = råtexten oförändrad sedan senaste läsning/skrivning
   (externa ändringar, t.ex. tester eller en annan flik, upptäcks eftersom råtexten jämförs). */
function cacheHit() { return _cache.doc != null && (_writeLock || rawGet(V2_KEY) === _cache.raw); }
function readDoc() {            // muterbar kopia (för read-modify-write)
  if (cacheHit()) return clone(_cache.doc);
  return clone(load().doc);
}
function peekDoc() {            // ENDAST läsning — returnerar cachens objekt utan kopiering
  if (cacheHit()) return _cache.doc;
  load(); return _cache.doc;
}

const api = {
  KEY: V2_KEY, V1, CURRENT_VERSION, CURRENT_EXT,
  load, validate, fromV1, mirror, verifyChecksum,
  lastLoadInfo() { const i = _cache.info; return i ? { via: i.via, migrated: !!i.migrated, recovered: !!i.recovered, integrity: i.integrity, migrationFailed: !!i.migrationFailed, error: i.error || null } : null; },
  writeLocked() { return _writeLock; },
  /* Nya fält (live read-modify-write — ingen minnescache, testsäker). */
  get(k) {
    const v = peekDoc()[k];
    return (v && typeof v === "object") ? clone(v) : v;
  },
  set(k, v) {
    const d = readDoc();
    d[k] = v;
    saveDoc(d);
    return d;
  },
  markTipSeen(id) {
    const d = readDoc();
    d.seenTips[id] = 1;
    saveDoc(d);
  },
  /* --- Phase 1A: ekonomi (alla skrivningar via validate ⇒ alltid
     normaliserade; korrupt input kan aldrig förstöra sparfilen). --- */
  FEATHER_MAX,
  localDateStr,
  getFeathers() { return peekDoc().feathers; },
  addFeathers(n) { // negativa/ogiltiga ignoreras; returnerar nya saldot
    const d = readDoc();
    const add = Math.floor(Number(n));
    if (Number.isFinite(add) && add > 0) d.feathers = Math.min(FEATHER_MAX, d.feathers + add);
    saveDoc(d);
    return d.feathers;
  },
  spendFeathers(n) { // false vid för lågt saldo — ändrar då ingenting
    const cost = Math.floor(Number(n));
    if (!Number.isFinite(cost) || cost <= 0) return false;
    const d = readDoc();
    if (d.feathers < cost) { saveDoc(d); return false; }
    d.feathers -= cost;
    saveDoc(d);
    return true;
  },
  ownedBirds() { return peekDoc().birdsOwned.slice(); },
  isOwned(id) { return peekDoc().birdsOwned.indexOf(id) >= 0; },
  ownBird(id) { // true om ny (köp/upplåsning), false om redan ägd/okänd
    if (typeof id !== "string" || birdIds().indexOf(id) < 0) return false;
    const d = readDoc();
    if (d.birdsOwned.indexOf(id) >= 0) { saveDoc(d); return false; }
    d.birdsOwned.push(id);
    saveDoc(d);
    return true;
  },
  equippedBird() { return peekDoc().birdEquipped; },
  equipBird(id) { // endast ägda fåglar; false ändrar ingenting
    if (typeof id !== "string" || birdIds().indexOf(id) < 0) return false;
    const d = readDoc();
    if (d.birdsOwned.indexOf(id) < 0) { saveDoc(d); return false; }
    d.birdEquipped = id;
    saveDoc(d);
    return true;
  },
  dailyState(today) { // {lastClaim, claimedTotal, canClaim, trackPos, clockSkew}
    const t = dateStr(today) || utcDateStr();
    const d = readDoc();
    // Gate C: spåra senast sedda dag — upptäcker tillbakavriden klocka.
    if (t && (!d.daily.lastSeen || t > d.daily.lastSeen)) {
      d.daily.lastSeen = t;
      saveDoc(d);
    }
    const skew = !!(t && d.daily.lastSeen && t < d.daily.lastSeen);
    return { lastClaim: d.daily.lastClaim, claimedTotal: d.daily.claimedTotal,
      canClaim: !skew && d.daily.lastClaim !== t, trackPos: d.daily.claimedTotal % 7,
      today: t, clockSkew: skew };
  },
  claimDaily(today) { // idempotent per datum; avvisar dubbletter OCH bakåtklocka
    const t = dateStr(today) || utcDateStr();
    const d = readDoc();
    if (!t) { saveDoc(d); return { ok: false, reason: "clock" }; }
    if (d.daily.lastSeen && t < d.daily.lastSeen) { saveDoc(d); return { ok: false, reason: "clock", day: t }; }
    if (d.daily.lastClaim === t) { saveDoc(d); return { ok: false, already: true, day: t }; }
    d.daily.lastClaim = t;
    d.daily.lastSeen = (!d.daily.lastSeen || t > d.daily.lastSeen) ? t : d.daily.lastSeen;
    d.daily.claimedTotal = Math.min(100000, d.daily.claimedTotal + 1);
    saveDoc(d);
    return { ok: true, day: t, claimIndex: d.daily.claimedTotal };
  },
  bonusClaimed(mode, level) {
    const d = peekDoc();
    const m = (mode === "sky") ? "sky" : "classic";
    return !!d.bonus[m][level];
  },
  claimBonus(mode, level) { // true exakt en gång per (läge, nivå)
    const m = (mode === "sky") ? "sky" : "classic";
    const d = readDoc();
    if (d.bonus[m][level]) { saveDoc(d); return false; }
    d.bonus[m][level] = 1;
    saveDoc(d);
    return true;
  },
  /* --- Gate D: endless-rekord + medaljer (skrivs till v1-spegel + v2 via mirror) --- */
  getEndlessBest(mode) {
    const d = peekDoc();
    return (mode === "sky" ? d.endlessBestSky : d.endlessBest) | 0;
  },
  setEndlessBest(mode, s) { // true om nytt rekord
    const k = mode === "sky" ? "endlessBestSky" : "endlessBest";
    const d = readDoc();
    if ((s | 0) > (d[k] | 0)) {
      d[k] = Math.min(1000000, s | 0);
      saveDoc(d);
      try { rawSet(mode === "sky" ? V1.endlessSky : V1.endless, String(d[k])); saveDoc(readDoc()); } catch (e) {}
      return true;
    }
    saveDoc(d);
    return false;
  },
  getMedal(mode, level) {
    const d = peekDoc();
    const m = (mode === "sky") ? "sky" : "classic";
    return (d.medals[m] && d.medals[m][level]) | 0;
  },
  setMedal(mode, level, stars) { // höjer endast (aldrig sänker); returnerar nya värdet
    const st = Math.min(3, Math.max(1, Math.floor(Number(stars)) || 0));
    if (!st || level == null) return this.getMedal(mode, level);
    const d = readDoc();
    const m = (mode === "sky") ? "sky" : "classic";
    if ((d.medals[m][level] | 0) < st) {
      d.medals[m][level] = st;
      saveDoc(d);
      try {
        const cur = v1best(V1.medals);
        cur[m] = cur[m] && typeof cur[m] === "object" ? cur[m] : {};
        if ((cur[m][level] | 0) < st) cur[m][level] = st;
        rawSet(V1.medals, JSON.stringify(cur));
        saveDoc(readDoc());
      } catch (e) {}
    } else saveDoc(d);
    return this.getMedal(mode, level);
  },
  /* --- Gate E: dagens bästa + ghost (per UTC-datum; raise-only, aldrig global) --- */
  getDailyBest() {
    const d = readDoc();
    return { date: d.dailyBest.date, score: d.dailyBest.score | 0 };
  },
  setDailyBest(date, score) { // true om nytt dagsbästa
    if (!dateStr(date)) return false;
    const d = readDoc();
    if (d.dailyBest.date !== date || (score | 0) > (d.dailyBest.score | 0)) {
      d.dailyBest = { date, score: Math.min(1000000, Math.max(0, score | 0)) };
      saveDoc(d);
      return true;
    }
    saveDoc(d);
    return false;
  },
  getGhostDaily() {
    const d = readDoc();
    return { date: d.ghostDaily.date, score: d.ghostDaily.score | 0, steps: d.ghostDaily.steps.slice() };
  },
  setGhostDaily(date, steps, score) { // sparar endast personbästa-ghost (aldrig nätverk)
    if (!dateStr(date) || !Array.isArray(steps) || !steps.length) return false;
    const d = readDoc();
    if (d.ghostDaily.date !== date || (score | 0) > (d.ghostDaily.score | 0)) {
      d.ghostDaily = ghostNorm({ date, steps, score });
      saveDoc(d);
      return true;
    }
    saveDoc(d);
    return false;
  },
  /* --- v4: Courier Closet --- */
  COS_SLOTS,
  cosmetics() { return clone(peekDoc().cosmetics || cosNorm(null)); },
  isCosOwned(slot, id) { const c = peekDoc().cosmetics || cosNorm(null); return !!(c.owned[slot] && c.owned[slot].indexOf(id) >= 0); },
  ownCosmetic(slot, id) { // true if new
    if (COS_SLOTS.indexOf(slot) < 0 || typeof id !== "string" || !BIRD_ID_RE.test(id)) return false;
    const d = readDoc();
    if (d.cosmetics.owned[slot].indexOf(id) >= 0) { saveDoc(d); return false; }
    d.cosmetics.owned[slot].push(id); saveDoc(d); return true;
  },
  equipCosmetic(slot, id) { // id null = take off (hat only)
    if (COS_SLOTS.indexOf(slot) < 0) return false;
    const d = readDoc();
    if (id === null) { if (slot !== "hat") { saveDoc(d); return false; } d.cosmetics.equipped.hat = null; saveDoc(d); return true; }
    if (d.cosmetics.owned[slot].indexOf(id) < 0) { saveDoc(d); return false; }
    d.cosmetics.equipped[slot] = id; saveDoc(d); return true;
  },
  /* atomic purchase: spend + own in ONE write (no state where feathers are gone but item missing) */
  buyCosmetic(slot, id, cost) {
    const c = Math.floor(Number(cost));
    if (COS_SLOTS.indexOf(slot) < 0 || typeof id !== "string" || !BIRD_ID_RE.test(id) || !Number.isFinite(c) || c <= 0) return { ok: false, reason: "bad" };
    const d = readDoc();
    if (d.cosmetics.owned[slot].indexOf(id) >= 0) { saveDoc(d); return { ok: false, reason: "owned" }; }
    if (d.feathers < c) { saveDoc(d); return { ok: false, reason: "funds" }; }
    d.feathers -= c; d.cosmetics.owned[slot].push(id); saveDoc(d); return { ok: true };
  },
  buyBird(id, cost) { // atomic spend + own (v4); same rules as ownBird
    const c = Math.floor(Number(cost));
    if (typeof id !== "string" || birdIds().indexOf(id) < 0 || !Number.isFinite(c) || c <= 0) return { ok: false, reason: "bad" };
    const d = readDoc();
    if (d.birdsOwned.indexOf(id) >= 0) { saveDoc(d); return { ok: false, reason: "owned" }; }
    if (d.feathers < c) { saveDoc(d); return { ok: false, reason: "funds" }; }
    d.feathers -= c; d.birdsOwned.push(id); saveDoc(d); return { ok: true };
  },
  /* --- v4: E5 first clear once per level (across modes); also records the per-mode ledger --- */
  firstClearPaid(level) { return !!(peekDoc().fcLevel || {})[level]; },
  claimFirstClearLevel(mode, level) {
    const m = (mode === "sky") ? "sky" : "classic";
    const d = readDoc();
    const paid = !!d.fcLevel[level];
    d.bonus[m][level] = 1; // keep the per-mode record (v0.3 compatibility)
    if (!paid) d.fcLevel[level] = 1;
    saveDoc(d);
    return !paid;
  },
  /* --- v4: daily obstacle counter. Clock behind lastSeen ⇒ stays on the stored day (never resets). --- */
  dayObstacles(today) {
    const t = dateStr(today) || utcDateStr();
    const d = peekDoc(), e = d.econDay || { day: null, n: 0 };
    const last = d.daily && d.daily.lastSeen;
    if (e.day && t < e.day) return { day: e.day, n: e.n, skew: true };     // clock went backwards
    if (last && t < last) return { day: e.day || t, n: e.day ? e.n : 0, skew: true };
    if (e.day === t) return { day: t, n: e.n, skew: false };
    return { day: t, n: 0, skew: false };
  },
  addDayObstacles(k, day) {
    const n = Math.floor(Number(k)); if (!(n > 0) || !dateStr(day)) return;
    const d = readDoc();
    if (d.econDay.day === day) d.econDay.n = Math.min(1000000, d.econDay.n + n);
    else if (!d.econDay.day || day > d.econDay.day) d.econDay = { day, n: Math.min(1000000, n) };
    saveDoc(d);
  },
  utcDateStr,
  corruptKeys() {
    try { return rawKeys().filter(k => k && k.indexOf(CORRUPT_PREFIX) === 0).sort(); } catch (e) { return []; }
  }
};

window.SaveV2 = api;
})();
