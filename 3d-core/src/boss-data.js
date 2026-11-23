/* DIPWING — Round 7 boss data. Pure, deterministic data/helpers; loaded only by the 3D build. */
(function () {
"use strict";
const LEVELS = {};
for (let w = 1; w <= 8; w++) {
  for (let l = 1; l <= 6; l++) {
    // Each world has five legacy seeds plus one hand-built signature flight.
    const legacy = l <= 5 ? (w - 1) * 5 + l : null;
    const signature = w === 1 && l === 6;
    const gameLevel = legacy != null ? legacy : signature ? 41 : null;
    LEVELS[`w${w}-l${l}`] = Object.freeze({ id: `w${w}-l${l}`, world: w, level: l,
      legacyLevel: legacy, gameLevel, signature });
  }
}
const WORLD_NAMES = Object.freeze([
  "Green Valley", "Tropic Lagoon", "Sunset Coast", "Neon City",
  "Glacier", "Rimewake", "Arcana Nebula", "Deep Space"
]);
const WORLD_NAMES_SV = Object.freeze([
  "Gröna dalen", "Tropiska lagunen", "Solnedgångskusten", "Neonstaden",
  "Glaciären", "Rimfrost", "Arkaniska nebulosan", "Djupa rymden"
]);
const ALMOR = Object.freeze({
  id: "almor", name: "Ålmor", epithet: "Tidvattenväktaren", worldId: "w1",
  intro: "En vänlig lagunål som vakar över sjön och vattenfallet.",
  body: Object.freeze({ style: "segmented-lagoon-eel", collision: false, plane: "depth" }),
  rules: Object.freeze({ phases: 3, phaseBreak: 1.8, checkpoint: "current-phase", mercyAfterDeaths: 3,
    mercyWarningMultiplier: 1.25, mercyRemoveEvery: 3, continueAllowed: false,
    warningMin: 1.0, beatMin: 1.15, birdRadius: 11, scrollSpeed: 190 }),
  phases: Object.freeze([
    Object.freeze({
      id: "water-pillars", title: "Vattenpelare", titleEn: "Water pillars", duration: 14.6, warning: 1.1,
      // 7a (t171u/t183u/t184u/t185u): 9 beats 1.36 s apart (was 6 × 1.72). Water pillars rise from the lake (top 378–488,
      // one tall 360–372 per phase) and cascades fall from the waterfall at the top (bottom 200–300, one deep 338–350),
      // so neither the top, the bottom nor the middle is a permanently safe hover height. Every beat leaves one readable gap.
      attacks: Object.freeze({ kind: "pillar", count: 9, firstImpact: 2.45, spacing: 1.36, duration: 0.46,
        rect: Object.freeze({ x0: 126, x1: 180, y0: 420, y1: 708 }),
        pattern: Object.freeze(["water", "cascade", "water", "tall", "cascade", "water", "water", "deep", "water"]),
        lanes: Object.freeze({ water: Object.freeze({ y0: [378, 488], y1: [708, 708] }), tall: Object.freeze({ y0: [360, 372], y1: [708, 708] }),
          cascade: Object.freeze({ y0: [0, 0], y1: [200, 300] }), deep: Object.freeze({ y0: [0, 0], y1: [338, 350] }) }),
        shape: "vertical-columns", symbol: "║" })
    }),
    Object.freeze({
      id: "flying-fish", title: "Flygfiskar", titleEn: "Flying fish", duration: 14.4, warning: 1.0,
      // 7a: 9 fish 1.36 s apart (was 6 × 1.72). Low leaps (top 360–440) and high leaps (top 190–250) rise from the water;
      // diving fish come from the top of the screen (bottom 240–300). A low leap always sits between a high leap and a dive,
      // so the lane change is ≤ ~150 px. Closes the "fly at the very top" exploit (t184u).
      attacks: Object.freeze({ kind: "fish", count: 9, firstImpact: 2.25, spacing: 1.36, duration: 0.44,
        rect: Object.freeze({ x0: 105, x1: 213, y0: 402, y1: 476 }),
        pattern: Object.freeze(["low", "high", "low", "dive", "low", "high", "low", "dive", "low"]),
        lanes: Object.freeze({ low: Object.freeze({ y0: [360, 440], y1: [708, 708] }), high: Object.freeze({ y0: [190, 250], y1: [708, 708] }),
          dive: Object.freeze({ y0: [0, 0], y1: [240, 300] }) }),
        shape: "fish-chevron", symbol: "≋" })
    }),
    Object.freeze({
      id: "tide-and-tail", title: "Tidvatten och stjärtsvep", titleEn: "Tide and tail sweep", duration: 15.0,
      attacks: Object.freeze({ kind: "sequence", duration: 0.44, items: Object.freeze([
        // 7a: tide earlier (1.85 → 1.6 s), 9 beats 1.45 s apart (was 6 × 1.8 s). Tail sweeps cover the whole upper (0–380)
        // or lower (400–600) lane, pillars rise from the tide; the safe lane switches on almost every beat.
        Object.freeze({ kind: "tide", impactAt: 1.6, warning: 1.2, rect: Object.freeze({ x0: 0, x1: 480, y0: 600, y1: 720 }), shape: "wave-line", symbol: "≈" }),
        Object.freeze({ kind: "sweep", impactAt: 3.05, warning: 1.0, rect: Object.freeze({ x0: 0, x1: 480, y0: 0, y1: 380 }), shape: "horizontal-sweep", symbol: "← →", lane: "upper" }),
        Object.freeze({ kind: "pillar", impactAt: 4.5, warning: 1.1, rect: Object.freeze({ x0: 126, x1: 180, y0: 360, y1: 600 }), shape: "vertical-columns", symbol: "║" }),
        Object.freeze({ kind: "sweep", impactAt: 5.95, warning: 1.0, rect: Object.freeze({ x0: 0, x1: 480, y0: 400, y1: 600 }), shape: "horizontal-sweep", symbol: "← →", lane: "lower" }),
        Object.freeze({ kind: "sweep", impactAt: 7.4, warning: 1.0, rect: Object.freeze({ x0: 0, x1: 480, y0: 0, y1: 380 }), shape: "horizontal-sweep", symbol: "← →", lane: "upper" }),
        Object.freeze({ kind: "pillar", impactAt: 8.85, warning: 1.1, rect: Object.freeze({ x0: 126, x1: 180, y0: 360, y1: 600 }), shape: "vertical-columns", symbol: "║" }),
        Object.freeze({ kind: "sweep", impactAt: 10.3, warning: 1.0, rect: Object.freeze({ x0: 0, x1: 480, y0: 400, y1: 600 }), shape: "horizontal-sweep", symbol: "← →", lane: "lower" }),
        Object.freeze({ kind: "sweep", impactAt: 11.75, warning: 1.0, rect: Object.freeze({ x0: 0, x1: 480, y0: 0, y1: 380 }), shape: "horizontal-sweep", symbol: "← →", lane: "upper" }),
        Object.freeze({ kind: "pillar", impactAt: 13.2, warning: 1.1, rect: Object.freeze({ x0: 126, x1: 180, y0: 360, y1: 600 }), shape: "vertical-columns", symbol: "║" })
      ]) })
    })
  ]),
  // 7a: weak points sit in the lane that is safe for the NEXT attack (pulls the player through the pattern).
  weakPoints: Object.freeze({ countPerPhase: 3, y: 300, yByPhase: Object.freeze([Object.freeze([330, 320, 330]), Object.freeze([260, 340, 320]), Object.freeze([470, 375, 330])]), travelStartX: 438, travelEndX: 153, travelDuration: 1.22,
    starts: Object.freeze([1.55, 5.25, 8.95]),
    phase3Sequence: Object.freeze([2, 0, 1]),
    shape: "golden-ring", plane: "game" })
});
function rng(seed) {
  let s = Number(seed) >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function makeTimeline(phaseNo, seed, mercy) {
  const p = ALMOR.phases[Math.max(0, Math.min(2, (Number(phaseNo) || 1) - 1))];
  const rnd = rng((Number(seed) >>> 0) ^ (phaseNo * 0x9e3779b9));
  let base;
  if (p.attacks.kind === "sequence") {
    base = p.attacks.items.map((a, i) => Object.assign({}, a, { id: `p3-a${i + 1}`, duration: p.attacks.duration,
      rect: Object.assign({}, a.rect) }));
  } else {
    const a = p.attacks;
    base = Array.from({ length: a.count }, (_, i) => {
      const rect = Object.assign({}, a.rect); let lane;
      const r = rnd(); // 7a: one extra draw per attack, before the timing jitter
      if (a.pattern) {
        lane = a.pattern[i % a.pattern.length];
        const L = a.lanes[lane], pick = rg => Math.round(rg[0] + r * (rg[1] - rg[0]));
        rect.y0 = pick(L.y0); rect.y1 = pick(L.y1);
      }
      return { id: `p${phaseNo}-a${i + 1}`, kind: a.kind, impactAt: a.firstImpact + i * a.spacing + (rnd() - 0.5) * 0.10,
        warning: p.warning, duration: a.duration, rect, shape: a.shape, symbol: a.symbol, lane };
    });
  }
  const attacks = base.map((a, i) => Object.assign({}, a, {
    warning: Number((a.warning * (mercy ? ALMOR.rules.mercyWarningMultiplier : 1)).toFixed(3)),
    impactAt: Number((a.impactAt + (rnd() - 0.5) * 0.08).toFixed(3)),
    duration: a.duration || 0.44,
    // Every third scheduled attack is removed in mercy mode (index 3, 6, ...).
    removedByMercy: !!(mercy && (i + 1) % ALMOR.rules.mercyRemoveEvery === 0)
  })).filter(a => !a.removedByMercy);
  return attacks;
}
function makeWeakPoints(phaseNo) {
  const seq = phaseNo === 3 ? ALMOR.weakPoints.phase3Sequence : [0, 1, 2];
  return ALMOR.weakPoints.starts.map((bornAt, i) => ({
    id: `p${phaseNo}-w${seq[i]}`, order: seq[i], bornAt, reachAt: bornAt + ALMOR.weakPoints.travelDuration,
    expireAt: bornAt + ALMOR.weakPoints.travelDuration + 0.6, /* 7a: 0.95 → 0.6 s so a missed ring never lingers into the next lethal window */ y: (ALMOR.weakPoints.yByPhase[phaseNo - 1] || [])[i] || ALMOR.weakPoints.y,
    x0: ALMOR.weakPoints.travelStartX, x1: ALMOR.weakPoints.travelEndX, collected: false, missed: false
  }));
}
function checkpointAfterDeath(phase, deathsInPhase) {
  const n = Math.max(0, Number(deathsInPhase) || 0);
  const mercy = n >= ALMOR.rules.mercyAfterDeaths;
  return { phase: Math.max(1, Math.min(3, Number(phase) || 1)), mercy,
    warningMultiplier: mercy ? ALMOR.rules.mercyWarningMultiplier : 1,
    removeEvery: mercy ? ALMOR.rules.mercyRemoveEvery : 0 };
}
function worldTwoUnlocked(w1SignatureCleared, originalUnlockedLegacy) {
  return !!w1SignatureCleared || Number(originalUnlockedLegacy || 1) >= 6;
}
function worldOneComplete(sixRegularFlightsCleared, bossBeaten) {
  return !!sixRegularFlightsCleared && !!bossBeaten;
}
function migrateLegacyProgress(rawKeys, migratedAt, bossSave) {
  const raw = rawKeys || {};
  const parse = key => { try { const v = raw[key]; const x = typeof v === "string" ? JSON.parse(v) : (v || {}); return x && typeof x === "object" && !Array.isArray(x) ? x : {}; } catch (e) { return {}; } };
  // V1 keys are the live progression mirrors. V2 (or its last-known-good backup) is a
  // recovery source for exports/older installs where those mirrors are absent or stale.
  const v2Primary = parse("pfb_save_v2");
  const v2Backup = parse("pfb_save_v2_backup");
  const v2 = Object.assign({}, v2Backup, v2Primary);
  const bestC = parse("pfb_best_v1"), bestS = parse("pfb_best_sky_v1");
  const clearC = parse("pfb_cleared_v1"), clearS = parse("pfb_cleared_sky_v1");
  const medals = parse("pfb_medals_v1"), records = {};
  const v2BestC = v2.best || {}, v2BestS = v2.bestSky || {};
  const v2ClearC = v2.cleared || {}, v2ClearS = v2.clearedSky || {};
  const v2Medals = v2.medals || {};
  const n0 = v => Math.max(0, Number(v) || 0);
  for (const entry of Object.values(LEVELS)) {
    const n = entry.legacyLevel; if (n == null) continue;
    records[entry.id] = {
      classic: { best: Math.max(n0(bestC && bestC[n]), n0(v2BestC[n])),
        cleared: !!(clearC && clearC[n]) || !!v2ClearC[n],
        medal: Math.max(n0(medals && medals.classic && medals.classic[n]), n0(v2Medals.classic && v2Medals.classic[n])) },
      sky: { best: Math.max(n0(bestS && bestS[n]), n0(v2BestS[n])),
        cleared: !!(clearS && clearS[n]) || !!v2ClearS[n],
        medal: Math.max(n0(medals && medals.sky && medals.sky[n]), n0(v2Medals.sky && v2Medals.sky[n])) }
    };
  }
  const originalUnlockedLegacy = Math.max(1, Number(raw.pfb_unlocked_v1) || 1, Number(v2.unlocked) || 1);
  return { version: 1, mappingVersion: "omg7-v3", migrated: true,
    migratedAt: migratedAt || new Date().toISOString(), originalUnlockedLegacy,
    unlockedLegacy: originalUnlockedLegacy, records, boss: bossSave && typeof bossSave === "object" ? bossSave : {} };
}

/* 7a (REVIEW_7 B1): validator for the boss script in its NATIVE format (kind + rect object). Called by boss.js
   before every fight (normal and calm timelines). Combines DipwingSim.validateBossAttacks with plane/passage rules. */
const PLANE = Object.freeze({ w: 480, ceil: 14, floor: 708, tideFloor: 600, minPassage: 66 }); // 66 px = 3 bird diameters
function validateTimeline(attacks, Sim) {
  const errors = [];
  if (!Array.isArray(attacks) || !attacks.length) return ["empty boss script"];
  const tideAt = Math.min(Infinity, ...attacks.filter(a => a && a.kind === "tide").map(a => Number(a.impactAt)));
  for (const a of attacks) {
    const id = String((a && a.id) || "attack"), r = (a && a.rect) || {};
    const x0 = Number(r.x0), x1 = Number(r.x1), y0 = Number(r.y0), y1 = Number(r.y1);
    if (![x0, x1, y0, y1].every(Number.isFinite) || !(x1 > x0) || !(y1 > y0)) { errors.push(id + ": invalid rect"); continue; }
    if (x0 < 0 || x1 > PLANE.w || y0 < 0 || y1 > 720) errors.push(id + ": rect outside the play plane");
    if (!(Number(a.warning) >= 1.0) || Number(a.warning) > 1.5) errors.push(id + ": warning outside 1.0–1.5 s");
    if (a.kind === "tide") continue;
    const floor = Number(a.impactAt) >= tideAt ? PLANE.tideFloor : PLANE.floor;
    const above = Math.max(0, Math.min(y0, floor) - PLANE.ceil), below = Math.max(0, floor - Math.max(y1, PLANE.ceil));
    if (Math.max(above, below) < PLANE.minPassage) errors.push(id + ": no readable gap (≥ " + PLANE.minPassage + " px) at the bird's column");
  }
  const sorted = attacks.slice().sort((p, q) => Number(p.impactAt) - Number(q.impactAt));
  for (let i = 1; i < sorted.length; i++) if (Number(sorted[i].impactAt) - Number(sorted[i - 1].impactAt) < ALMOR.rules.beatMin) errors.push(String(sorted[i].id) + ": beats < 1.15 s apart");
  if (Sim && Sim.validateBossAttacks) {
    const norm = attacks.filter(a => a.kind !== "tide").map(a => ({ id: a.id, kind: "rect", warning: a.warning, impactAt: a.impactAt, x0: a.rect.x0, x1: a.rect.x1, y0: a.rect.y0, y1: a.rect.y1 }));
    for (const e of Sim.validateBossAttacks(norm)) if (!/beats/.test(e)) errors.push(e);
  }
  return errors;
}
function validateWeakPoints(phaseNo, attacks) {
  // every weak point must be outside every lethal rect while it is collectable (bird radius included)
  const errors = [];
  for (const w of makeWeakPoints(phaseNo)) for (const a of attacks) {
    if (a.kind === "tide") { if (w.y + 11 >= PLANE.tideFloor && w.expireAt >= a.impactAt) errors.push(w.id + ": below the tide"); continue; }
    const overlapT = w.reachAt - 0.15 <= a.impactAt + a.duration && w.expireAt >= a.impactAt;
    if (overlapT && w.y + 11 > a.rect.y0 && w.y - 11 < a.rect.y1) errors.push(w.id + ": inside " + a.id);
  }
  return errors;
}
window.DipwingBossData = Object.freeze({ VERSION: "omg7-almor-data-6-7a", LEVELS: Object.freeze(LEVELS), WORLD_NAMES, WORLD_NAMES_SV, ALMOR,
  makeTimeline, makeWeakPoints, validateTimeline, validateWeakPoints, PLANE, checkpointAfterDeath, worldTwoUnlocked, worldOneComplete, migrateLegacyProgress });
})();
