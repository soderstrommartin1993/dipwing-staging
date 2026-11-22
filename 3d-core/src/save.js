/* ============================================================
   DIPWING — src/save.js (additiv sparning, ext 2 – Omgång 5)
   Dokumentversion v3 behålls; ext 2 lägger till Coins, prestige-F, ledger,
   migreringsbackup, fortsättningsreservationer och ekonomins dagstillstånd.
   Regler:
   - v1-nycklar (pfb_unlocked/best/cleared/muted) förblir LIVE speglar:
     alla legacy-skrivningar skriver både v1 och v2. Gamla tester och
     återvändande spelare påverkas aldrig.
   - pfb_save_v2 är sanningen för nya fält och en samlad dokumentspegel av
     legacy-fälten. ext 2 bevarar `feathers` som bakåtkompatibel Coins-spegel.
   - validate() normaliserar kända fält och bevarar okända fält för
     forward compatibility. Generisk set() är begränsad till inställningar;
     ekonomifält skrivs via atomisk plånbok eller prestigegrant.
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
/* Additive extension level; document version v3 remains unchanged so older readers keep the
   existing version contract. ext 1 = cosmetics/fcLevel/econDay; ext 2 = Coins, prestige-F,
   econ mirror, grants, ledger, pending continue, ad state, placed-day cap, missions and records.
   The raw original is preserved under a unique pfb_save_premigration_v_econ2_* key before ext 2 is committed;
   this preserves the historical pfb_save_premigration_v3x1 alias and keeps restoreMigrationBackup() byte-exact. */
const CURRENT_EXT = 2;
const BASE_EXT = 1;
const PREMIGRATION_PREFIX = "pfb_save_premigration_v"; // orörd kopia före varje migrering (raderas aldrig)
const PREMIGRATION_V3X1_ALIAS = "pfb_save_premigration_v3x1"; // historisk aliasnyckel bevaras permanent
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
function money0(v, cap) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  const x = Math.min(n, cap == null ? 999999.99 : cap); return Math.round(x * 100) / 100;
}
function plainClone(v, fallback) { try { return JSON.parse(JSON.stringify(v)); } catch (e) { return fallback; } }
function ledgerNorm(v) {
  const out = [], seen = new Set();
  if (!Array.isArray(v)) return out;
  for (const x of v) {
    if (!x || typeof x.tx !== "string" || !x.tx || seen.has(x.tx)) continue;
    const delta = Number(x.delta);
    if (!Number.isFinite(delta)) continue;
    seen.add(x.tx); const row = { tx: x.tx.slice(0, 160), delta: Math.round(delta * 100) / 100,
      kind: typeof x.kind === "string" ? x.kind.slice(0, 40) : "unknown", at: int0(x.at, 9007199254740991) };
    if (x.currency === "F") row.currency = "F"; // Coin remains the default for legacy rows.
    out.push(row);
    if (out.length >= 100) break;
  }
  return out;
}
function missionNorm(v) {
  const o = objMap(v), list = [];
  if (Array.isArray(o.list)) for (const m of o.list.slice(0, 12)) {
    if (!m || typeof m.id !== "string") continue;
    list.push({ id: m.id.slice(0, 60), prog: int0(m.prog, 100000), done: m.done === true, paid: m.paid === true });
  }
  return { day: dateStr(o.day), list };
}
function levelCoinNorm(v) {
  const o = objMap(v), out = {};
  for (const k of Object.keys(o)) if (/^[a-z0-9:_-]{1,80}$/i.test(k)) out[k] = int0(o[k], 3);
  return out;
}
function map01(v) { // {nyckel:1}-ledger (bonus/cleared-liknande)
  const o = objMap(v), out = {};
  for (const k of Object.keys(o)) { if (o[k] === 1 || o[k] === true) out[k] = 1; }
  return out;
}
function isRunScopedWalletTx(tx) {
  return /^(?:run|placed):/.test(String(tx || "")) || /^(?:double-run|continue):/.test(String(tx || ""));
}
function walletTxBelongsToRun(tx, runId) {
  const id = String(runId || ""); if (!id) return false;
  const t = String(tx || "");
  return t.startsWith("run:" + id + ":") || t.startsWith("placed:" + id + ":") ||
    t === "double-run:" + id || t === "continue:" + id;
}
function normalizeWalletState(doc) {
  const active = typeof doc.activeRunId === "string" && doc.activeRunId ? doc.activeRunId.slice(0, 180) : null;
  doc.activeRunId = active;
  doc.ledger = ledgerNorm(doc.ledger).filter(item => !isRunScopedWalletTx(item.tx) || walletTxBelongsToRun(item.tx, active));
  const keys = map01(doc.walletKeys);
  for (const key of Object.keys(keys)) {
    const tx = key.charAt(0) === "$" ? key.slice(1) : key;
    if (isRunScopedWalletTx(tx) && !walletTxBelongsToRun(tx, active)) delete keys[key];
  }
  for (const item of doc.ledger) keys["$" + item.tx] = 1;
  doc.walletKeys = keys;
  return doc;
}
function pruneRunWalletState(doc, runId) {
  const id = String(runId || ""); if (!id) return doc;
  doc.ledger = ledgerNorm(doc.ledger).filter(item => !walletTxBelongsToRun(item.tx, id));
  const keys = map01(doc.walletKeys);
  for (const key of Object.keys(keys)) {
    const tx = key.charAt(0) === "$" ? key.slice(1) : key;
    if (walletTxBelongsToRun(tx, id)) delete keys[key];
  }
  doc.walletKeys = keys;
  if (doc.activeRunId === id) doc.activeRunId = null;
  return doc;
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
const COS_SLOTS = ["scarf", "hat", "trail", "effect", "theme"];
const COS_DEFAULT_OWNED = { scarf: ["coral"], hat: [], trail: ["ribbon"], effect: [], theme: [] };
const COS_DEFAULT_EQ = { scarf: "coral", hat: null, trail: "ribbon", effect: null, theme: null };
function cosNorm(v) {
  const o = objMap(v), own = objMap(o.owned), eq = objMap(o.equipped), out = { v: 1, owned: {}, equipped: {} };
  for (const sl of COS_SLOTS) {
    const list = [];
    for (const id of COS_DEFAULT_OWNED[sl]) list.push(id);
    if (Array.isArray(own[sl])) for (const id of own[sl]) if (typeof id === "string" && BIRD_ID_RE.test(id) && list.indexOf(id) < 0) list.push(id);
    out.owned[sl] = (sl === "effect" || sl === "theme") ? list.slice(0, 100) : list;
    const e = eq[sl];
    out.equipped[sl] = (e === null && sl === "hat") ? null
      : (typeof e === "string" && list.indexOf(e) >= 0) ? e : COS_DEFAULT_EQ[sl];
  }
  // Shop 1.0 visual slots are part of ext 2; unknown owned IDs remain forward-compatible.
  return out;
}
/* levels already paid in Classic OR Sky count as paid (no clawback, no double pay) */
function seedFc(bonus) { const fc = {}; const bo = objMap(bonus); for (const m of ["classic", "sky"]) for (const k of Object.keys(objMap(bo[m]))) if (bo[m][k]) fc[k] = 1; return fc; }
function upgradeExt(d) { // pure: v3 doc without ext ⇒ ext 1 (existing B-15 format)
  const o = clone(d); o.ext = BASE_EXT; o.fcLevel = Object.assign(seedFc(o.bonus), map01(o.fcLevel));
  o.cosmetics = cosNorm(o.cosmetics); o.econDay = econDayNorm(o.econDay);
  if (testHooks() && window.__testFailMigration) throw new Error("test: forced ext upgrade failure");
  const v = validate(o); if (!v.doc) throw new Error("ext 1 upgrade invalid: " + v.error); return v.doc;
}
function retroPrestigeAmounts(d) {
  const medals = objMap(d.medals), classic = objMap(medals.classic), sky = objMap(medals.sky);
  const gold = Object.values(classic).filter(x => Number(x) >= 3).length + Object.values(sky).filter(x => Number(x) >= 3).length;
  const cleared = objMap(d.cleared), clearedSky = objMap(d.clearedSky);
  const unlocked = int1(d.unlocked);
  const ends = (window.ECON && ECON.prestige && ECON.prestige.retroWorldEnds) || [3, 5, 10, 20];
  const worlds = ends.filter(level => !!(cleared[level] || clearedSky[level] || unlocked > level)).length;
  return { gold, worlds };
}
function upgradeExt2(d, backupKey) { // ext 1 → ext 2, additive currency/migration schema
  const o = clone(d); const oldCoins = money0(o.coins != null ? o.coins : o.feathers);
  const grants = objMap(o.grants); const alreadyGranted = grants.retroPrestige === true;
  const retro = retroPrestigeAmounts(o);
  const p5 = Number(window.ECON && ECON.prestige && ECON.prestige.retroGoldMedal) || 5;
  const p20 = Number(window.ECON && ECON.prestige && ECON.prestige.retroWorldClear) || 20;
  const bonus = alreadyGranted ? 0 : retro.gold * p5 + retro.worlds * p20;
  o.ext = 2; o.coins = oldCoins; o.feathers = oldCoins;
  o.prestigeFeathers = int0(o.prestigeFeathers, 999999) + bonus;
  o.grants = Object.assign({}, grants, { retroPrestige: true, retroPrestigeDetails: { goldMedals: retro.gold, clearedWorlds: retro.worlds, amount: bonus } });
  o.econ = { v: 2, mirror: oldCoins, migratedAt: o.econ && o.econ.migratedAt || new Date().toISOString(), backupKey: backupKey || (o.econ && o.econ.backupKey) || null };
  o.ledger = ledgerNorm(o.ledger);
  o.pendingCont = null;
  o.adState = { day: dateStr(o.adState && o.adState.day), dayBonusUsed: !!(o.adState && o.adState.dayBonusUsed) };
  const placedCap = Number(window.ECON && ECON.placedCoins && ECON.placedCoins.fullValueDailyCap) || 0;
  o.placedDay = { day: dateStr(o.placedDay && o.placedDay.day), fullPaid: money0(o.placedDay && o.placedDay.fullPaid, placedCap) };
  o.missions = missionNorm(o.missions);
  // Medal Coins are paid once per level across Classic/Sky (not once per mode).
  // Convert any preview-build mode-scoped keys additively to the shared level key.
  const priorLevelCoins = levelCoinNorm(o.levelCoins), sharedLevelCoins = {};
  for (const key of Object.keys(priorLevelCoins)) {
    const m = /^(?:classic|sky):(\d+)$/.exec(key);
    const target = m ? m[1] : key;
    sharedLevelCoins[target] = Math.max(sharedLevelCoins[target] || 0, priorLevelCoins[key] | 0);
  }
  o.levelCoins = sharedLevelCoins;
  // Existing medals predate the new Coins reward; mark the best tier already achieved in either mode.
  for (const mode of ["classic", "sky"]) for (const level of Object.keys(objMap(objMap(o.medals)[mode]))) {
    const stars = Math.max(0, Math.min(3, Number(o.medals[mode][level]) | 0));
    const key = String(level);
    if (stars) o.levelCoins[key] = Math.max(o.levelCoins[key] | 0, stars);
  }
  o.records = objMap(o.records);
  o.records.endlessBestClean = Object.assign({ classic: int0(o.endlessBest, 1000000), sky: int0(o.endlessBestSky, 1000000) }, objMap(o.records.endlessBestClean));
  o.records.endlessBestCont = Object.assign({ classic: 0, sky: 0 }, objMap(o.records.endlessBestCont));
  o.records.dailyBest = Object.assign({ cont: { date: null, score: 0 } }, objMap(o.records.dailyBest));
  o.records.dailyBest.cont = Object.assign({ date: null, score: 0 }, objMap(o.records.dailyBest.cont));
  o.cosmetics = cosNorm(o.cosmetics);
  o.purchases = Array.isArray(o.purchases) ? o.purchases.slice(0, 100) : [];
  if (testHooks() && window.__testFailMigrationExt2) throw new Error("test: forced ext 2 upgrade failure");
  const v = validate(o); if (!v.doc) throw new Error("ext 2 upgrade invalid: " + v.error); return v.doc;
}
function backupAndUpgradeExt2(d, raw) {
  let backupKey = null;
  if (raw != null) {
    // Keep both the historical fixed alias (E3 rollback contract) and the unique ext-2 snapshot.
    // Neither key is ever deleted; both contain the exact original bytes, not re-serialized JSON.
    if (rawGet(PREMIGRATION_V3X1_ALIAS) == null) {
      if (!rawSet(PREMIGRATION_V3X1_ALIAS, raw) || rawGet(PREMIGRATION_V3X1_ALIAS) !== raw)
        throw new Error("legacy v3x1 premigration alias could not be written and verified");
    }
    backupKey = PREMIGRATION_PREFIX + "econ2_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const wrote = rawSet(backupKey, raw);
    if (!wrote || rawGet(backupKey) !== raw) throw new Error("economy backup could not be verified before migration");
  }
  return upgradeExt2(d, backupKey);
}
function upgradeToCurrentExt(d, raw) {
  let o = d;
  if ((o.ext | 0) < BASE_EXT) o = upgradeExt(o);
  if ((o.ext | 0) < CURRENT_EXT) o = backupAndUpgradeExt2(o, raw);
  return o;
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
  /* audio v2: clamp optional volumes only when present (no new fields written ⇒ no migration) */
  for (const vk of ["musicVol", "masterVol"]) if (d[vk] != null) { const x = Number(d[vk]); out[vk] = Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : (vk === "musicVol" ? 0.5 : 1); }
  out.lang = (d.lang === "en" || d.lang === "sv") ? d.lang : "sv";
  out.reducedMotion = d.reducedMotion === true;
  out.seenTips = objMap(d.seenTips);
  /* Phase 1A + ext 2 economy schema. Legacy `feathers` is retained as the Coins mirror. */
  const ids = birdIds();
  out.ext = int0(d.ext, 10);
  out.coins = money0(d.coins != null ? d.coins : d.feathers);
  out.feathers = money0(d.feathers != null ? d.feathers : out.coins);
  out.prestigeFeathers = int0(d.prestigeFeathers, 999999);
  out.econ = { v: int0(d.econ && d.econ.v, 100) || 2,
    mirror: money0(d.econ && d.econ.mirror != null ? d.econ.mirror : out.coins),
    migratedAt: d.econ && typeof d.econ.migratedAt === "string" ? d.econ.migratedAt.slice(0, 40) : null,
    backupKey: d.econ && typeof d.econ.backupKey === "string" ? d.econ.backupKey.slice(0, 200) : null };
  out.grants = plainClone(objMap(d.grants), {});
  out.ledger = ledgerNorm(d.ledger);
  // Permanent transaction idempotency is separate from the deliberately bounded 100-row audit ledger.
  out.activeRunId = typeof d.activeRunId === "string" && d.activeRunId ? d.activeRunId.slice(0, 180) : null;
  out.walletKeys = map01(d.walletKeys);
  normalizeWalletState(out);
  out.runCounter = int0(d.runCounter, Number.MAX_SAFE_INTEGER - 1);
  const pc = objMap(d.pendingCont);
  out.pendingCont = d.pendingCont && typeof pc.runId === "string" && typeof pc.tx === "string"
    ? { runId: pc.runId.slice(0, 120), tx: pc.tx.slice(0, 160), method: pc.method === "coins" ? "coins" : "stub", amount: money0(pc.amount) }
    : null;
  const ad = objMap(d.adState);
  out.adState = { day: dateStr(ad.day), dayBonusUsed: ad.dayBonusUsed === true };
  const pd = objMap(d.placedDay);
  const placedDailyCap = Number(window.ECON && ECON.placedCoins && ECON.placedCoins.fullValueDailyCap) || 0;
  out.placedDay = { day: dateStr(pd.day), fullPaid: money0(pd.fullPaid, placedDailyCap) };
  out.missions = missionNorm(d.missions);
  out.levelCoins = levelCoinNorm(d.levelCoins);
  out.records = plainClone(objMap(d.records), {});
  out.records.endlessBestClean = Object.assign({ classic: int0(d.endlessBest, 1000000), sky: int0(d.endlessBestSky, 1000000) }, objMap(out.records.endlessBestClean));
  out.records.endlessBestCont = Object.assign({ classic: 0, sky: 0 }, objMap(out.records.endlessBestCont));
  out.records.dailyBest = Object.assign({ cont: { date: null, score: 0 } }, objMap(out.records.dailyBest));
  out.records.dailyBest.cont = Object.assign({ date: null, score: 0 }, objMap(out.records.dailyBest.cont));
  out.purchases = Array.isArray(d.purchases) ? d.purchases.slice(-100) : [];
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
const MIGRATION_LOCK_KEY = "pfb_save_ext2_migration_lock_v1";
function clone(o) { try { return typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o)); } catch (e) { return JSON.parse(JSON.stringify(o)); } }
function acquireMigrationLock() {
  const now = Date.now(), owner = "ext2:" + now + ":" + Math.random().toString(36).slice(2, 10);
  try {
    const old = parseObj(rawGet(MIGRATION_LOCK_KEY));
    if (old.found && !old.corrupt && old.value && Number(old.value.until) > now) return null;
    const raw = JSON.stringify({ owner, until: now + 5000 });
    if (!rawSet(MIGRATION_LOCK_KEY, raw) || rawGet(MIGRATION_LOCK_KEY) !== raw) return null;
    return owner;
  } catch (e) { return null; }
}
function releaseMigrationLock(owner) {
  try { const q = parseObj(rawGet(MIGRATION_LOCK_KEY)); if (q.found && !q.corrupt && q.value && q.value.owner === owner) rawRemove(MIGRATION_LOCK_KEY); } catch (e) {}
}
function migrateWithLease(doc, raw, makeCurrent) {
  const owner = acquireMigrationLock();
  if (!owner) {
    const current = parseObj(rawGet(V2_KEY));
    if (current.found && !current.corrupt) {
      const v = validate(current.value);
      if (v.doc && (v.doc.ext | 0) >= CURRENT_EXT) return { doc: v.doc, migrated: false, alreadyMigrated: true };
    }
    _writeLock = true; // another tab owns migration; this tab is read-only until reload
    return { doc, migrated: false, migrationFailed: true, error: "another tab is migrating ext 2; reload this tab after it finishes" };
  }
  try {
    const latestRaw = rawGet(V2_KEY);
    if (latestRaw !== raw) {
      const latest = parseObj(latestRaw);
      if (latest.found && !latest.corrupt) {
        const v = validate(latest.value);
        if (v.doc && (v.doc.ext | 0) >= CURRENT_EXT) return { doc: v.doc, migrated: false, alreadyMigrated: true };
      }
      throw new Error("save changed concurrently before ext 2 migration; reload required");
    }
    const next = makeCurrent();
    // Recheck the source bytes while holding the migration lease; never overwrite a newer tab save.
    if (rawGet(V2_KEY) !== raw) {
      const latest = parseObj(rawGet(V2_KEY));
      if (latest.found && !latest.corrupt) {
        const v = validate(latest.value);
        if (v.doc && (v.doc.ext | 0) >= CURRENT_EXT) return { doc: v.doc, migrated: false, alreadyMigrated: true };
      }
      throw new Error("save changed concurrently during ext 2 migration; reload required");
    }
    _writeLock = false;
    if (!saveDoc(next)) throw new Error("ext 2 migrated save could not be committed");
    return { doc: next, migrated: true };
  } catch (e) {
    _writeLock = true; // preserve and expose the untouched source document read-only
    return { doc, migrated: false, migrationFailed: true, error: String(e && e.message || e) };
  } finally { releaseMigrationLock(owner); }
}

function saveDoc(doc) {
  try {
    if ((doc.ext | 0) >= CURRENT_EXT) {
      doc.coins = money0(doc.coins); doc.feathers = doc.coins;
      doc.econ = Object.assign({}, objMap(doc.econ), { mirror: doc.coins, v: 2 });
      normalizeWalletState(doc);
      doc.runCounter = int0(doc.runCounter, Number.MAX_SAFE_INTEGER - 1);
    }
    if (!(doc.v >= CURRENT_VERSION)) doc.v = CURRENT_VERSION;
    doc._seq = (Math.floor(Number(doc._seq)) || 0) + 1;
    doc._writer = String(window.GAME_VERSION || "?");
    delete doc._sum; doc._sum = sumOf(doc);
    const text = JSON.stringify(doc);
    if (_writeLock) return false;
    const wrote = rawSet(V2_KEY, text);
    const verified = rawGet(V2_KEY) === text;
    if (!verified) return false;
    _cache.raw = text; _cache.doc = clone(doc);
    if (wrote) {
      try { if (validate(JSON.parse(text)).doc) rawSet(BACKUP_KEY, text); } catch (e) {}
    }
    return true; // SafeStorage may be in memory fallback; its readback is still session-consistent.
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
function migrate(doc, raw) {
  let d = clone(doc);
  while (d.v < CURRENT_VERSION) {
    const step = MIGRATIONS[d.v];
    if (!step) throw new Error("no migration from v" + d.v);
    if (testHooks() && window.__testFailMigration) throw new Error("test: forced migration failure");
    d = step(d);
  }
  const v = validate(d);
  if (!v.doc) throw new Error("migrated doc invalid: " + v.error);
  return upgradeToCurrentExt(v.doc, raw);
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
  let doc = clone(info.doc);
  if (!_writeLock && (doc.ext | 0) >= CURRENT_EXT && money0(doc.feathers) !== money0(doc.econ && doc.econ.mirror)) {
    const legacy = money0(doc.feathers), mirror = money0(doc.econ && doc.econ.mirror);
    doc.coins = money0(doc.coins + legacy - mirror);
    doc.feathers = doc.coins; doc.econ.mirror = doc.coins;
    const tx = "legacy-sync:" + mirror + ":" + legacy + ":" + (doc._seq | 0);
    doc.ledger = ledgerNorm([{ tx, delta: doc.coins - money0(info.doc.coins), kind: "legacy-sync", at: Date.now() }, ...(doc.ledger || [])]);
    saveDoc(doc);
    info.doc = clone(doc);
  }
  _cache.doc = clone(doc);
  return info;
}
function load() {
  const raw0 = rawGet(V2_KEY);
  const cur = parseObj(raw0);
  if (!cur.found) {
    let doc = fromV1();
    doc = upgradeToCurrentExt(validate(doc).doc, null);
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
      if (v.doc.v < CURRENT_VERSION || !((v.doc.ext | 0) >= CURRENT_EXT)) {
        if (v.doc.v < CURRENT_VERSION) {
          const snapKey = PREMIGRATION_PREFIX + v.doc.v;
          try { if (rawGet(snapKey) == null) rawSet(snapKey, raw0); } catch (e) {}
        }
        const migrated = migrateWithLease(v.doc, raw0, () => v.doc.v < CURRENT_VERSION ? migrate(v.doc, raw0) : upgradeToCurrentExt(v.doc, raw0));
        return finish({ doc: clone(migrated.doc), migrated: !!migrated.migrated, from: v.doc.v,
          toExt: (migrated.doc.ext | 0) >= CURRENT_EXT ? CURRENT_EXT : undefined,
          migrationFailed: !!migrated.migrationFailed, error: migrated.error || null,
          recovered: false, via: "v2", integrity }, raw0);
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

let _walletSeq = 0;
const WALLET_LOCK_KEY = "pfb_wallet_tx_lock_v1";
function makeTxId(kind) {
  _walletSeq = (_walletSeq + 1) % 1000000;
  return String(kind || "tx").slice(0, 32) + ":" + Date.now() + ":" + _walletSeq + ":" + Math.random().toString(36).slice(2, 8);
}
function acquireWalletLock() {
  const owner = makeTxId("lock"), now = Date.now();
  try {
    const old = parseObj(rawGet(WALLET_LOCK_KEY));
    if (old.found && !old.corrupt && old.value && Number(old.value.until) > now) return null;
    const lock = JSON.stringify({ owner, until: now + 2500 });
    rawSet(WALLET_LOCK_KEY, lock);
    const check = rawGet(WALLET_LOCK_KEY);
    if (check !== lock) return null;
    return owner;
  } catch (e) { return null; }
}
function releaseWalletLock(owner) {
  try { const q = parseObj(rawGet(WALLET_LOCK_KEY)); if (q.found && !q.corrupt && q.value.owner === owner) rawRemove(WALLET_LOCK_KEY); } catch (e) {}
}
function appendCoinLedger(d, tx, delta, kind) {
  const id = String(tx || makeTxId(kind)).slice(0, 160);
  d.walletKeys = map01(d.walletKeys);
  if (d.walletKeys["$" + id] || d.ledger.some(x => x.tx === id)) return { ok: false, duplicate: true, balance: d.coins, tx: id };
  const n = Number(delta);
  if (!Number.isFinite(n) || !n) return { ok: false, reason: "amount", balance: d.coins, tx: id };
  const amount = Math.round(n * 100) / 100;
  if (amount < 0 && d.coins + amount < -0.000001) return { ok: false, reason: "funds", balance: d.coins, tx: id };
  const next = money0(d.coins + amount);
  const actualDelta = Math.round((next - d.coins) * 100) / 100;
  if (actualDelta === 0) return { ok: false, reason: "cap", balance: d.coins, tx: id };
  d.coins = next; d.feathers = next; d.econ.mirror = next;
  d.walletKeys["$" + id] = 1;
  d.ledger = ledgerNorm([{ tx: id, delta: actualDelta, kind: String(kind || "wallet").slice(0, 40), at: Date.now() }, ...d.ledger]);
  return { ok: true, balance: next, delta: actualDelta, tx: id };
}
function appendPrestigeLedger(d, tx, delta, kind) {
  const id = String(tx || "").slice(0, 160);
  if (!id) return { ok: false, reason: "tx" };
  d.walletKeys = map01(d.walletKeys);
  if (d.walletKeys["$" + id] || d.ledger.some(x => x.tx === id)) return { ok: false, duplicate: true, balance: d.prestigeFeathers, tx: id };
  const n = Number(delta);
  if (!Number.isFinite(n) || !Number.isInteger(n) || !n) return { ok: false, reason: "amount", balance: d.prestigeFeathers, tx: id };
  if (n < 0 && d.prestigeFeathers + n < 0) return { ok: false, reason: "funds", balance: d.prestigeFeathers, tx: id };
  const next = int0(d.prestigeFeathers + n, 999999);
  const actualDelta = next - d.prestigeFeathers;
  if (!actualDelta) return { ok: false, reason: "cap", balance: d.prestigeFeathers, tx: id };
  d.prestigeFeathers = next;
  d.walletKeys["$" + id] = 1;
  d.ledger = ledgerNorm([{ tx: id, delta: actualDelta, kind: String(kind || "prestige-wallet").slice(0, 40), at: Date.now(), currency: "F" }, ...d.ledger]);
  return { ok: true, balance: next, delta: actualDelta, tx: id };
}
function walletChange(tx, delta, kind, mutate) {
  if (_writeLock) return { ok: false, reason: "migration-lock" };
  const owner = acquireWalletLock();
  if (!owner) return { ok: false, reason: "busy" };
  try {
    // Bypass stale in-tab snapshots after acquiring the cross-tab lease.
    _cache.raw = null; _cache.doc = null;
    const d = readDoc();
    const r = appendCoinLedger(d, tx, delta, kind);
    if (!r.ok) return r;
    if (typeof mutate === "function") mutate(d, r);
    const ok = saveDoc(d);
    if (!ok) return { ok: false, reason: "save", balance: d.coins, tx: r.tx };
    return r;
  } finally { releaseWalletLock(owner); }
}
const PRESTIGE_SOURCES = new Set(["retro", "achievement", "signature_level", "all_world_gold", "weekly_challenge", "daily_seventh", "event"]);
function awardPrestigeDoc(d, amount, grantId, source) {
  const n = int0(amount, 999999);
  const id = String(grantId || "").slice(0, 120), src = String(source || "");
  if (!n || !id || !PRESTIGE_SOURCES.has(src)) return { ok: false, reason: "source" };
  const key = "prestige:" + id;
  if (d.grants[key]) return { ok: false, duplicate: true, balance: d.prestigeFeathers };
  d.prestigeFeathers = int0(d.prestigeFeathers + n, 999999);
  d.grants[key] = { amount: n, source: src, at: Date.now() };
  return { ok: true, amount: n, balance: d.prestigeFeathers };
}
function setMedalAndPay(d, mode, level, stars) {
  const m = mode === "sky" ? "sky" : "classic", key = String(level);
  const old = d.medals[m][level] | 0, oldPaid = d.levelCoins[key] | 0;
  const st = Math.min(3, Math.max(1, Math.floor(Number(stars)) || 0));
  if (!st) return { stars: old, paid: 0 };
  d.medals[m][level] = Math.max(old, st);
  const schedule = (window.ECON && ECON.rewards && ECON.rewards.medalCoins) || [];
  const total = Number(st >= 3 ? schedule[2] : st === 2 ? schedule[1] : schedule[0]) || 0;
  const prev = oldPaid >= 3 ? Number(schedule[2] || 0) : oldPaid === 2 ? Number(schedule[1] || 0) : oldPaid === 1 ? Number(schedule[0] || 0) : 0;
  const add = Math.max(0, Math.round((total - prev) * 100) / 100);
  if (add > 0) {
    const tx = "medal:" + key + ":" + st;
    const r = appendCoinLedger(d, tx, add, "medal");
    if (r.ok) d.levelCoins[key] = st;
  }
  if (st >= 3) {
    const prestige = window.ECON && ECON.prestige || {};
    const signatures = Array.isArray(prestige.signatureLevels) ? prestige.signatureLevels : [];
    if (signatures.includes(Number(level))) awardPrestigeDoc(d, Number(prestige.signatureLevelClear || 10), "signature-level:" + level, "signature_level");
    const ranges = Array.isArray(prestige.worldGoldRanges) ? prestige.worldGoldRanges : [];
    for (const range of ranges) {
      const start = Number(range && range[0]), end = Number(range && range[1]);
      if (!(end >= start) || Number(level) !== end) continue;
      let allGold = true;
      for (let lv = start; lv <= end; lv++) if ((d.medals[m][lv] | 0) < 3) { allGold = false; break; }
      if (allGold) awardPrestigeDoc(d, Number(prestige.allWorldGold || 20), "all-world-gold:" + start + "-" + end, "all_world_gold");
    }
  }
  return { stars: d.medals[m][level], paid: add };
}

const api = {
  KEY: V2_KEY, V1, CURRENT_VERSION, CURRENT_EXT,
  load, validate, fromV1, mirror, verifyChecksum,
  lastLoadInfo() { const i = _cache.info; return i ? { via: i.via, migrated: !!i.migrated, recovered: !!i.recovered, integrity: i.integrity, migrationFailed: !!i.migrationFailed, error: i.error || null } : null; },
  writeLocked() { return _writeLock; },
  allocateRunId(mode, seed) {
    if (_writeLock) return null;
    const owner = acquireWalletLock(); if (!owner) return null;
    try {
      _cache.raw = null; _cache.doc = null;
      const d = readDoc();
      if (d.activeRunId) pruneRunWalletState(d, d.activeRunId);
      d.runCounter = Math.min(Number.MAX_SAFE_INTEGER - 1, int0(d.runCounter, Number.MAX_SAFE_INTEGER - 1) + 1);
      const id = String(mode || "run").replace(/[^a-z0-9_-]/gi, "").slice(0, 20) + ":" + (Number(seed) >>> 0) + ":attempt:" + d.runCounter;
      d.activeRunId = id;
      if (!saveDoc(d)) return null;
      return id;
    } finally { releaseWalletLock(owner); }
  },
  finishRunWalletKeys(runId) {
    const id = String(runId || "").slice(0, 180); if (!id) return false;
    const owner = acquireWalletLock(); if (!owner) return false;
    try {
      _cache.raw = null; _cache.doc = null;
      const d = readDoc();
      pruneRunWalletState(d, id);
      return saveDoc(d);
    } finally { releaseWalletLock(owner); }
  },
  finishActiveRunWalletKeys() {
    const d = peekDoc(), id = d && d.activeRunId;
    return id ? this.finishRunWalletKeys(id) : true;
  },
  /* Nya fält (live read-modify-write — ingen minnescache, testsäker). */
  get(k) {
    const v = peekDoc()[k];
    return (v && typeof v === "object") ? clone(v) : v;
  },
  set(k, v) {
    // Economy-owned fields are deliberately excluded from generic set(): Coins must flow
    // through walletChange + ledger, and prestige through grantPrestige's source allowlist.
    const safe = new Set(["lang", "reducedMotion", "reducedMotionExplicit", "soundVol", "masterVol", "musicVol"]);
    if (!safe.has(String(k))) return peekDoc();
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
  getCoins() { return peekDoc().coins; },
  getFeathers() { return peekDoc().coins; }, // legacy name; value is now Coins, mirrored to feathers
  getPrestigeFeathers() { return peekDoc().prestigeFeathers | 0; },
  walletTransaction(tx, delta, kind) { return walletChange(tx, delta, kind || "wallet"); },
  earnCoins(amount, tx, kind) {
    const n = money0(amount); if (!(n > 0)) return { ok: false, reason: "amount" };
    return walletChange(tx || makeTxId(kind || "earn"), n, kind || "earn");
  },
  spendCoins(amount, tx, kind) {
    const n = money0(amount); if (!(n > 0)) return { ok: false, reason: "amount" };
    return walletChange(tx || makeTxId(kind || "spend"), -n, kind || "spend");
  },
  addFeathers(n) { // legacy method: adds Coins and writes ledger atomically
    const r = this.earnCoins(n, makeTxId("legacy-earn"), "legacy-earn"); return r.ok ? r.balance : this.getCoins();
  },
  spendFeathers(n) { const r = this.spendCoins(n, makeTxId("legacy-spend"), "legacy-spend"); return !!r.ok; },
  grantPrestige(amount, grantId, source) {
    if (!PRESTIGE_SOURCES.has(String(source || ""))) return { ok: false, reason: "source" };
    const owner = acquireWalletLock(); if (!owner) return { ok: false, reason: "busy" };
    try {
      _cache.raw = null; _cache.doc = null;
      const d = readDoc(), r = awardPrestigeDoc(d, amount, grantId, source);
      if (!r.ok) return r;
      if (!saveDoc(d)) return { ok: false, reason: "save" };
      return r;
    } finally { releaseWalletLock(owner); }
  },
  claimPlacedCoin(day, runId, coinId, nominalValue) {
    const date = dateStr(day) || utcDateStr(), id = "placed:" + String(runId || "run") + ":" + String(coinId || "coin");
    const value = money0(nominalValue);
    if (!(value > 0)) return { ok: false, reason: "amount" };
    const owner = acquireWalletLock(); if (!owner) return { ok: false, reason: "busy" };
    try {
      _cache.raw = null; _cache.doc = null;
      const d = readDoc();
      if (d.walletKeys["$" + id] || d.ledger.some(x => x.tx === id)) return { ok: false, duplicate: true, balance: d.coins };
      // A rollback of the device clock must never roll the placed-Coin budget back.
      const highWaterDay = [d.daily && d.daily.lastSeen, d.placedDay && d.placedDay.day, d.adState && d.adState.day]
        .filter(Boolean).sort().pop() || null;
      if (highWaterDay && date < highWaterDay) return { ok: false, reason: "clock", clockSkew: true, day: highWaterDay };
      if (d.placedDay.day !== date) d.placedDay = { day: date, fullPaid: 0 };
      if (!d.daily.lastSeen || date > d.daily.lastSeen) d.daily.lastSeen = date;
      const cap = Number(window.ECON && ECON.placedCoins && ECON.placedCoins.fullValueDailyCap);
      const post = Number(window.ECON && ECON.placedCoins && ECON.placedCoins.postCapValuePerCoin);
      if (!Number.isFinite(cap) || !Number.isFinite(post) || cap < 0 || post < 0) return { ok: false, reason: "config" };
      const full = Math.min(value, Math.max(0, cap - d.placedDay.fullPaid));
      const reduced = Math.max(0, value - full) * post;
      const amount = Math.round((full + reduced) * 100) / 100;
      if (!(amount > 0)) return { ok: false, reason: "cap" };
      const r = appendCoinLedger(d, id, amount, "placed-coin");
      if (!r.ok) return r;
      d.placedDay.fullPaid = money0(d.placedDay.fullPaid + full, cap);
      if (!saveDoc(d)) return { ok: false, reason: "save" };
      return Object.assign(r, { fullPaid: full, reducedPaid: reduced });
    } finally { releaseWalletLock(owner); }
  },
  prepareContinue(runId, method) {
    const id = String(runId || "").slice(0, 120), mode = method === "coins" ? "coins" : method === "stub" ? "stub" : "";
    if (!id || !mode) return { ok: false, reason: "bad" };
    if (mode === "stub" && !(window.GAME_BUILD && window.GAME_BUILD.testHooks === true && window.ADS_MODE === "stub")) return { ok: false, reason: "ads-off" };
    const owner = acquireWalletLock(); if (!owner) return { ok: false, reason: "busy" };
    try {
      _cache.raw = null; _cache.doc = null;
      const d = readDoc(), used = !!d.grants["continue:" + id];
      if (used || (d.pendingCont && d.pendingCont.runId !== id)) return { ok: false, reason: "used" };
      const amount = mode === "coins" ? Number(window.ECON && ECON.currency && ECON.currency.continueCost) : 0;
      if (mode === "coins" && (!Number.isFinite(amount) || amount <= 0)) return { ok: false, reason: "config" };
      if (mode === "coins" && d.coins < amount) return { ok: false, reason: "funds", balance: d.coins };
      d.pendingCont = { runId: id, tx: "continue:" + id, method: mode, amount };
      return saveDoc(d) ? { ok: true, amount, method: mode } : { ok: false, reason: "save" };
    } finally { releaseWalletLock(owner); }
  },
  commitContinue(runId) {
    const id = String(runId || "").slice(0, 120), owner = acquireWalletLock();
    if (!owner) return { ok: false, reason: "busy" };
    try {
      _cache.raw = null; _cache.doc = null;
      const d = readDoc(), p = d.pendingCont;
      if (!p || p.runId !== id) return { ok: false, reason: "pending" };
      const grantKey = "continue:" + id;
      if (d.grants[grantKey]) { d.pendingCont = null; saveDoc(d); return { ok: false, reason: "used" }; }
      if (p.method === "coins") {
        const r = appendCoinLedger(d, p.tx, -p.amount, "continue");
        if (!r.ok) return r;
      } else if (!(window.GAME_BUILD && window.GAME_BUILD.testHooks === true && window.ADS_MODE === "stub")) return { ok: false, reason: "ads-off" };
      d.grants[grantKey] = { method: p.method, amount: p.amount, at: Date.now() };
      d.pendingCont = null;
      if (!saveDoc(d)) return { ok: false, reason: "save" };
      return { ok: true, method: p.method, amount: p.amount, balance: d.coins };
    } finally { releaseWalletLock(owner); }
  },
  cancelContinue(runId) {
    const d = readDoc(); if (d.pendingCont && (!runId || d.pendingCont.runId === String(runId))) { d.pendingCont = null; return saveDoc(d); }
    return true;
  },
  hasRunDoubleClaim(runId) {
    const id = "double-run:" + String(runId || "").slice(0, 120);
    const d = peekDoc();
    return id !== "double-run:" && (!!d.grants[id] || d.ledger.some(x => x.tx === id));
  },
  markRunDoubleClaim(runId, amount) {
    if (!(window.GAME_BUILD && window.GAME_BUILD.testHooks === true && window.ADS_MODE === "stub")) return { ok: false, reason: "ads-off" };
    const id = "double-run:" + String(runId || "").slice(0, 120), n = money0(amount);
    if (!n || id === "double-run:") return { ok: false, reason: "amount" };
    const owner = acquireWalletLock(); if (!owner) return { ok: false, reason: "busy" };
    try {
      _cache.raw = null; _cache.doc = null;
      const d = readDoc();
      if (d.grants[id] || d.ledger.some(x => x.tx === id)) return { ok: false, duplicate: true, balance: d.coins };
      const r = appendCoinLedger(d, id, n, "ad-stub-double-run");
      if (!r.ok) return r;
      d.grants[id] = { amount: n, at: Date.now() };
      return saveDoc(d) ? r : { ok: false, reason: "save" };
    } finally { releaseWalletLock(owner); }
  },
  claimDailyAdBonus(day, amount) {
    if (!(window.GAME_BUILD && window.GAME_BUILD.testHooks === true && window.ADS_MODE === "stub")) return { ok: false, reason: "ads-off" };
    const t = dateStr(day) || utcDateStr(), owner = acquireWalletLock();
    if (!owner) return { ok: false, reason: "busy" };
    try {
      _cache.raw = null; _cache.doc = null;
      const d = readDoc();
      if (d.adState.day === t && d.adState.dayBonusUsed) return { ok: false, duplicate: true };
      const base = d.grants["daily-track:" + t], n = money0(base && base.reward);
      if (!n || (amount != null && money0(amount) !== n)) return { ok: false, reason: "no-reward" };
      const tx = "double-daily:" + t;
      const r = appendCoinLedger(d, tx, n, "ad-stub-double-daily");
      if (!r.ok) return r;
      d.adState = { day: t, dayBonusUsed: true };
      return saveDoc(d) ? r : { ok: false, reason: "save" };
    } finally { releaseWalletLock(owner); }
  },
  missionProgress(event, amount, today) {
    const t = dateStr(today) || utcDateStr(), n = Math.max(0, Math.floor(Number(amount) || 0));
    if (!n) return false;
    const owner = acquireWalletLock(); if (!owner) return false;
    try {
      _cache.raw = null; _cache.doc = null;
      const d = readDoc();
      if (d.missions.day !== t) d.missions = { day: t, list: (window.ECON && ECON.missions || []).map(m => ({ id: m.id, prog: 0, done: false, paid: false })) };
      const defs = window.ECON && ECON.missions || [];
      for (const m of defs) {
        if (m.event !== event) continue;
        let state = d.missions.list.find(x => x.id === m.id);
        if (!state) { state = { id: m.id, prog: 0, done: false, paid: false }; d.missions.list.push(state); }
        if (!state.done) { state.prog = Math.min(m.target, state.prog + n); state.done = state.prog >= m.target; }
      }
      return saveDoc(d);
    } finally { releaseWalletLock(owner); }
  },
  missionState() { return clone(peekDoc().missions); },
  claimMission(id) {
    const owner = acquireWalletLock(); if (!owner) return { ok: false, reason: "busy" };
    try {
      _cache.raw = null; _cache.doc = null;
      const d = readDoc(), state = d.missions.list.find(x => x.id === id);
      const def = (window.ECON && ECON.missions || []).find(x => x.id === id);
      if (!state || !def || !state.done || state.paid) return { ok: false, reason: "not-ready" };
      const r = appendCoinLedger(d, "mission:" + d.missions.day + ":" + id, Number(def.reward), "daily-mission");
      if (!r.ok) return r;
      state.paid = true;
      return saveDoc(d) ? { ok: true, reward: def.reward } : { ok: false, reason: "save" };
    } finally { releaseWalletLock(owner); }
  },
  restoreMigrationBackup() {
    const d = peekDoc(), key = d.econ && d.econ.backupKey;
    if (!key) return { ok: false, reason: "no-backup" };
    const raw = rawGet(key); if (raw == null) return { ok: false, reason: "missing" };
    if (!rawSet(V2_KEY, raw) || rawGet(V2_KEY) !== raw) return { ok: false, reason: "write" };
    _cache.raw = null; _cache.doc = null; _writeLock = false;
    return { ok: true, byteExact: rawGet(V2_KEY) === raw, key };
  },
  migrationBackupKey() { return peekDoc().econ && peekDoc().econ.backupKey || null; },
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
  dailyAdState(today) {
    const t = dateStr(today) || utcDateStr(), d = peekDoc();
    const rec = d.grants["daily-track:" + t];
    return { day: t, reward: rec && Number(rec.reward) || 0, used: d.adState.day === t && d.adState.dayBonusUsed };
  },
  claimDaily(today, reward) { // claim + Coins + prestige in one locked document write
    const t = dateStr(today) || utcDateStr();
    if (!t) return { ok: false, reason: "clock" };
    const owner = acquireWalletLock(); if (!owner) return { ok: false, reason: "busy" };
    try {
      _cache.raw = null; _cache.doc = null;
      const d = readDoc();
      if (d.daily.lastSeen && t < d.daily.lastSeen) return { ok: false, reason: "clock", day: t };
      if (d.daily.lastClaim === t) return { ok: false, already: true, day: t };
      const amount = money0(reward), nextIndex = Math.min(100000, d.daily.claimedTotal + 1);
      if (amount > 0) {
        const coin = appendCoinLedger(d, "daily:" + t, amount, "daily-track");
        if (!coin.ok) return { ok: false, reason: coin.reason || "ledger" };
      }
      d.daily.lastClaim = t;
      d.daily.lastSeen = (!d.daily.lastSeen || t > d.daily.lastSeen) ? t : d.daily.lastSeen;
      d.daily.claimedTotal = nextIndex;
      d.grants["daily-track:" + t] = { reward: amount, claimIndex: nextIndex, at: Date.now() };
      let prestige = 0;
      if (nextIndex % 7 === 0) {
        const f = awardPrestigeDoc(d, Number(window.ECON && ECON.prestige && ECON.prestige.dailySeventhClaim || 0), "daily-track:" + t, "daily_seventh");
        if (f.ok) prestige = f.amount;
      }
      if (!saveDoc(d)) return { ok: false, reason: "save" };
      return { ok: true, day: t, claimIndex: nextIndex, reward: amount, prestige };
    } finally { releaseWalletLock(owner); }
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
  setEndlessContBest(mode, s) {
    const d = readDoc(), m = mode === "sky" ? "sky" : "classic";
    const n = Math.min(1000000, Math.max(0, Number(s) | 0));
    if (n > (d.records.endlessBestCont[m] | 0)) { d.records.endlessBestCont[m] = n; return saveDoc(d); }
    saveDoc(d); return false;
  },
  setDailyContBest(date, score) {
    if (!dateStr(date)) return false;
    const owner = acquireWalletLock(); if (!owner) return false;
    try {
      _cache.raw = null; _cache.doc = null;
      const d = readDoc(), n = Math.min(1000000, Math.max(0, Number(score) | 0));
      const cur = d.records.dailyBest.cont;
      if (cur.date !== date || n > (cur.score | 0)) { d.records.dailyBest.cont = { date, score: n }; return saveDoc(d); }
      return false;
    } finally { releaseWalletLock(owner); }
  },
  setEndlessBest(mode, s) { // true om nytt rekord
    const k = mode === "sky" ? "endlessBestSky" : "endlessBest";
    const d = readDoc();
    if ((s | 0) > (d[k] | 0)) {
      d[k] = Math.min(1000000, s | 0);
      d.records.endlessBestClean = Object.assign({}, d.records.endlessBestClean, { [mode === "sky" ? "sky" : "classic"]: d[k] });
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
  setMedal(mode, level, stars) { // höjer endast; medalj-Coins betalas inkrementellt en gång
    const st = Math.min(3, Math.max(1, Math.floor(Number(stars)) || 0));
    if (!st || level == null) return this.getMedal(mode, level);
    const owner = acquireWalletLock(); if (!owner) return this.getMedal(mode, level);
    try {
      _cache.raw = null; _cache.doc = null;
      const d = readDoc(), m = mode === "sky" ? "sky" : "classic";
      const pay = setMedalAndPay(d, m, level, st);
      if (!saveDoc(d)) return this.getMedal(mode, level);
      try {
        const cur = v1best(V1.medals); cur[m] = cur[m] && typeof cur[m] === "object" ? cur[m] : {};
        if ((cur[m][level] | 0) < pay.stars) cur[m][level] = pay.stars;
        rawSet(V1.medals, JSON.stringify(cur));
      } catch (e) {}
      return this.getMedal(mode, level);
    } finally { releaseWalletLock(owner); }
  },
  /* --- Gate E: dagens bästa + ghost (per UTC-datum; raise-only, aldrig global) --- */
  getDailyBest() {
    const d = readDoc();
    return { date: d.dailyBest.date, score: d.dailyBest.score | 0 };
  },
  setDailyBest(date, score) { // true om nytt rent dagsbästa
    if (!dateStr(date)) return false;
    const owner = acquireWalletLock(); if (!owner) return false;
    try {
      _cache.raw = null; _cache.doc = null;
      const d = readDoc();
      if (d.dailyBest.date !== date || (score | 0) > (d.dailyBest.score | 0)) {
        d.dailyBest = { date, score: Math.min(1000000, Math.max(0, score | 0)) };
        d.records.dailyBest.clean = { date, score: d.dailyBest.score };
        return saveDoc(d);
      }
      return false;
    } finally { releaseWalletLock(owner); }
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
    const owner = acquireWalletLock(); if (!owner) return { ok: false, reason: "busy" };
    try {
      _cache.raw = null; _cache.doc = null;
      const d = readDoc();
      if (d.cosmetics.owned[slot].indexOf(id) >= 0) return { ok: false, reason: "owned" };
      if (d.coins < c) return { ok: false, reason: "funds" };
      const r = appendCoinLedger(d, makeTxId("cosmetic"), -c, "cosmetic");
      if (!r.ok) return { ok: false, reason: r.reason || "funds" };
      d.cosmetics.owned[slot].push(id);
      if (!saveDoc(d)) return { ok: false, reason: "save" };
      return { ok: true, balance: d.coins };
    } finally { releaseWalletLock(owner); }
  },
  /* Shop 1.0 pricing policy is revalidated inside the atomic save boundary; UI prices are never trusted. */
  shopPricePolicy(kind, slot, id, currency, requested, doc) {
    const econ = window.ECON || {}, shop = econ.shop || {};
    if (kind !== "bird" && (kind !== "cosmetic" || COS_SLOTS.indexOf(slot) < 0)) return { ok: false, reason: "bad-kind" };
    let def = null;
    if (kind === "bird") def = (econ.BIRDS || []).find(x => x && x.id === id) || null;
    else def = ((econ.COSMETICS || {})[slot] || []).find(x => x && x.id === id) || null;
    if (!def || def.prestige || def.secret || def.unlockCondition) return { ok: false, reason: "not-for-sale" };
    const expectedCurrency = def.currency === "F" ? "F" : "C";
    const cur = currency === "F" ? "F" : "C";
    const base = Math.floor(Number(def.cost));
    const price = Math.floor(Number(requested));
    if (!Number.isFinite(base) || base <= 0 || cur !== expectedCurrency || !Number.isFinite(price) || price <= 0) return { ok: false, reason: "price" };
    if (cur === "F") return price === base ? { ok: true, price, currency: cur, discounted: false } : { ok: false, reason: "price" };
    if (price === base) return { ok: true, price, currency: cur, discounted: false };

    // Deterministic UTC shelf, reproduced at the save boundary. Only its first item may be 20% off.
    const rows = [], v1 = !!(window.IDENTITY && IDENTITY.V1), idNew = !!(doc && doc.idNew), equippedBird = doc && doc.birdEquipped;
    for (const b of (econ.BIRDS || [])) {
      if (!b || b.prestige || b.secret || b.unlockCondition || !(Number(b.cost) > 0) || b.currency === "F") continue;
      if (b.legacy && idNew && equippedBird !== b.id) continue;
      if (b.v1 && !v1) continue;
      if (v1 && !b.v1 && !b.legacy && !(window.IDENTITY.BIRD_PAL && window.IDENTITY.BIRD_PAL[b.id])) continue;
      rows.push({ slot: "bird", id: b.id, cost: Math.floor(Number(b.cost)) });
    }
    for (const sl of COS_SLOTS) for (const c of ((econ.COSMETICS || {})[sl] || [])) {
      if (!c || c.prestige || c.secret || c.unlockCondition || !(Number(c.cost) > 0) || c.currency === "F") continue;
      rows.push({ slot: sl, id: c.id, cost: Math.floor(Number(c.cost)) });
    }
    const hash = value => { let h = 2166136261; for (const ch of String(value)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
    const day = new Date().toISOString().slice(0, 10);
    rows.sort((a, b) => hash(day + ":" + a.slot + ":" + a.id) - hash(day + ":" + b.slot + ":" + b.id) || (a.id < b.id ? -1 : 1));
    const first = rows.slice(0, Math.max(1, Math.floor(Number(shop.dailyShelfCount) || 3)))[0];
    const discounted = first && first.slot === (kind === "bird" ? "bird" : slot) && first.id === id;
    const expected = discounted ? Math.max(1, Math.floor(base * (1 - Number(shop.dailyDiscount || 0.2)))) : base;
    return price === expected ? { ok: true, price, currency: cur, discounted: !!discounted } : { ok: false, reason: "price" };
  },
  /* Shop 1.0: permanent per-purchase idempotency, atomic balance + ownership + equip. */
  purchaseShopItem(kind, slot, id, currency, cost, purchaseId) {
    const c = Math.floor(Number(cost)), cur = currency === "F" ? "F" : "C";
    const pid = String(purchaseId || "").slice(0, 120);
    if (!pid || !Number.isFinite(c) || c <= 0 || typeof id !== "string" || !BIRD_ID_RE.test(id)) return { ok: false, reason: "bad" };
    const owner = acquireWalletLock(); if (!owner) return { ok: false, reason: "busy" };
    try {
      _cache.raw = null; _cache.doc = null;
      const d = readDoc();
      // Permanent idempotency wins before current pricing is re-evaluated (e.g. after UTC shelf rollover).
      const key = "$shop-purchase:" + pid;
      if (d.walletKeys[key]) return { ok: false, reason: "duplicate" };
      const policy = this.shopPricePolicy(kind, slot, id, cur, c, d);
      if (!policy.ok) return policy;
      const owned = kind === "bird" ? d.birdsOwned : (d.cosmetics.owned[slot] || []);
      if (owned.indexOf(id) >= 0) return { ok: false, reason: "owned" };
      if (cur === "C") {
        if (d.coins < c) return { ok: false, reason: "funds", balance: d.coins };
        const debit = appendCoinLedger(d, "shop:" + pid, -c, "shop-purchase");
        if (!debit.ok) return { ok: false, reason: debit.reason || "duplicate" };
      } else {
        const debit = appendPrestigeLedger(d, "shop:F:" + pid, -c, "shop-purchase");
        if (!debit.ok) return { ok: false, reason: debit.reason || "duplicate", balance: d.prestigeFeathers };
      }
      const previousEquipped = kind === "bird" ? d.birdEquipped : d.cosmetics.equipped[slot];
      owned.push(id);
      if (kind === "bird") d.birdEquipped = id; else d.cosmetics.equipped[slot] = id;
      d.walletKeys[key] = 1;
      const at = Date.now();
      d.purchases = (Array.isArray(d.purchases) ? d.purchases : []).concat([{ id: pid, kind, slot: kind === "bird" ? "bird" : slot, itemId: id, currency: cur, amount: c, at, used: false, refunded: false, previousEquipped }]).slice(-100);
      if (!saveDoc(d)) return { ok: false, reason: "save" };
      return { ok: true, purchaseId: pid, balance: cur === "C" ? d.coins : d.prestigeFeathers };
    } finally { releaseWalletLock(owner); }
  },
  undoShopPurchase(purchaseId, now) {
    const pid = String(purchaseId || "").slice(0, 120), t = Number(now) || Date.now();
    if (!pid) return { ok: false, reason: "bad" };
    const owner = acquireWalletLock(); if (!owner) return { ok: false, reason: "busy" };
    try {
      _cache.raw = null; _cache.doc = null;
      const d = readDoc(), p = (d.purchases || []).find(x => x && x.id === pid);
      if (!p || p.refunded || p.used || t - Number(p.at || 0) > 30000 || t < Number(p.at || 0)) return { ok: false, reason: "not-undoable" };
      const refundKey = "$shop-refund:" + pid;
      if (d.walletKeys[refundKey]) return { ok: false, reason: "duplicate" };
      if (p.currency === "F") {
        const credit = appendPrestigeLedger(d, "shop-refund:F:" + pid, p.amount, "shop-refund");
        if (!credit.ok) return { ok: false, reason: credit.reason || "duplicate" };
      } else {
        const credit = appendCoinLedger(d, "shop-refund:" + pid, p.amount, "shop-refund");
        if (!credit.ok) return { ok: false, reason: credit.reason || "duplicate" };
      }
      if (p.kind === "bird") {
        d.birdsOwned = d.birdsOwned.filter(x => x !== p.itemId);
        if (d.birdEquipped === p.itemId) d.birdEquipped = p.previousEquipped || (d.idNew ? "tornis" : "sunny");
      } else {
        d.cosmetics.owned[p.slot] = (d.cosmetics.owned[p.slot] || []).filter(x => x !== p.itemId);
        if (d.cosmetics.equipped[p.slot] === p.itemId) d.cosmetics.equipped[p.slot] = p.previousEquipped || null;
      }
      p.refunded = true; d.walletKeys[refundKey] = 1;
      if (!saveDoc(d)) return { ok: false, reason: "save" };
      return { ok: true, balance: p.currency === "F" ? d.prestigeFeathers : d.coins };
    } finally { releaseWalletLock(owner); }
  },
  markShopPurchasesUsed() {
    const d = readDoc(); let changed = false;
    for (const p of (d.purchases || [])) {
      if (!p || p.used || p.refunded) continue;
      const active = p.kind === "bird" ? d.birdEquipped === p.itemId : d.cosmetics.equipped[p.slot] === p.itemId;
      if (active) { p.used = true; changed = true; }
    }
    return changed ? saveDoc(d) : true;
  },
  shopPurchases() { return clone(readDoc().purchases || []); },
  buyBird(id, cost) { // atomic spend + own (v4); same rules as ownBird
    const c = Math.floor(Number(cost));
    if (typeof id !== "string" || birdIds().indexOf(id) < 0 || !Number.isFinite(c) || c <= 0) return { ok: false, reason: "bad" };
    const owner = acquireWalletLock(); if (!owner) return { ok: false, reason: "busy" };
    try {
      _cache.raw = null; _cache.doc = null;
      const d = readDoc();
      if (d.birdsOwned.indexOf(id) >= 0) return { ok: false, reason: "owned" };
      if (d.coins < c) return { ok: false, reason: "funds" };
      const r = appendCoinLedger(d, makeTxId("bird"), -c, "bird");
      if (!r.ok) return { ok: false, reason: r.reason || "funds" };
      d.birdsOwned.push(id);
      if (!saveDoc(d)) return { ok: false, reason: "save" };
      return { ok: true, balance: d.coins };
    } finally { releaseWalletLock(owner); }
  },
  /* --- v4: E5 first clear once per level (across modes); also records the per-mode ledger --- */
  firstClearPaid(level) { return !!(peekDoc().fcLevel || {})[level]; },
  claimFirstClearLevel(mode, level) {
    const m = (mode === "sky") ? "sky" : "classic";
    const owner = acquireWalletLock(); if (!owner) return 0;
    try {
      _cache.raw = null; _cache.doc = null;
      const d = readDoc(), key = String(level), paid = !!d.fcLevel[key];
      d.bonus[m][key] = 1; // keep the per-mode record (v0.3 compatibility)
      if (paid) { saveDoc(d); return 0; }
      const amount = Number((window.ECON && ECON.rewards && ECON.rewards.firstClear) || 0);
      const r = amount > 0 ? appendCoinLedger(d, "first-clear-level:" + key, amount, "first-clear") : { ok: true, delta: 0 };
      if (!r.ok) return 0;
      d.fcLevel[key] = 1;
      if (!saveDoc(d)) return 0;
      return r.delta || 0;
    } finally { releaseWalletLock(owner); }
  },
  claimDailyCourse(date, amount) {
    const day = dateStr(date) || utcDateStr(), n = money0(amount);
    if (!n) return { ok: false, reason: "amount" };
    return walletChange("daily-course:" + day, n, "daily-course", d => { d.grants["daily-course:" + day] = { amount: n, at: Date.now() }; });
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
