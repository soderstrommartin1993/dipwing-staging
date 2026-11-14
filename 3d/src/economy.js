/* ============================================================
   DIPWING — src/economy.js (Phase 0 + Phase 1A)
   ECON = active values only. ECON_PROPOSED = inactive Phase 0 proposals.
   ECON_REJECTED = loot/pity constants rejected by the doctrine.
   Phase 1A-delen (AKTIV): fjäderintjäning + dagbelöningar + fågelkatalog.
   Balansrapport: se README ("Ekonomi — Phase 1A").
   ============================================================ */
(function () {
"use strict";

/* Economy doctrine (docs/ECONOMY_DOCTRINE.md, approved idea 2): no loot boxes, no feather sales,
   no pay-to-win, no subscriptions, no paid streak saves. Test `13-doctrine` fails if these reappear. */

/* REJECTED by the doctrine (rule 4: no loot boxes / hidden odds / pity chests). Kept only as a record
   so nobody re-adds them by accident. NOT read by any game code. Frozen. */
window.ECON_REJECTED = Object.freeze({
  reason: "Doctrine rule 4 – no loot boxes, no hidden odds, no pity chests (approved 2026-11-10)",
  chestOdds: Object.freeze({ common: 0.60, uncommon: 0.25, rare: 0.10, epic: 0.04, legendary: 0.01 }),
  pity: Object.freeze({ epic: 30, legendary: 150 })
});

/* PROPOSALS from Phase 0 — INACTIVE, not read by any game code. Each must be re-simulated and
   approved before use. Ads: everything off until Martin approves a concrete activation (rule 11). */
window.ECON_PROPOSED = Object.freeze({
  missionReward: 100,
  birdCost: { common: 200, uncommon: 800, rare: 2000 }, // all birds are bought with earned feathers; nothing via eggs/chests
  trailCost: 400, hatCost: 300,
  skillTier: { t1: [50, 150, 300], t2: [200, 500, 900], t3: [600, 1200, 2000], t4: [1500, 3000, 4000] }, // would affect play – needs review vs rule 3
  caps: { heartHeld: 1, reviveTokens: 3, powerupCharges: 5, rewardedRevivePerRun: 1 },
  ads: { enabled: false, interstitialEveryNRuns: 3, maxInterstitialsPerDay: 4, newPlayerGraceSessions: 5, rewardedRevivePerRun: 1 }
});

window.ECON = {
  version: 2,

  /* --- ACTIVE economy v2 (idea 3 = B1 + C7 + E5). Values set AFTER the re-run simulation
     (tools/econ/econ_sim.py on docs/difficulty-per-level.csv; report docs/ECONOMY_SIM.md).
     - perPipe: daily obstacle bonus — the first 100 obstacles of a (UTC) day pay 2, 101–400 pay 1,
       after that 1 per 4 obstacles. Clock rolled back ⇒ the day never resets (Gate C lastSeen);
       within one session the day only changes after real (monotonic) time has passed.
     - firstClear: 30, ONCE PER LEVEL across Classic and Sky (E5). Already-paid bonuses are never
       taken back; a level paid in either mode before v0.4 counts as paid.
     - endless milestones (per run): 25 → +5, 50 → +15, 100 → +40.
     - dailyCourse: 25, once per day (idea 5), no revive, no ads.
     Flag: ?econ=0 or localStorage pfb_econ_v2="0" restores the v0.3 rules (flat 2, 25 per mode+level,
     old daily track). ---- */
  rewards: {
    perPipe: 2,
    firstClear: 30,
    dayTiers: [[100, 2], [400, 1], [1e9, 0.25]],
    endlessMilestones: { 25: 5, 50: 15, 100: 40 },
    dailyCourse: 25
  },
  dailyTrack: [40, 50, 60, 80, 100, 120, 250],
  legacy: { // v0.3 rules (flag off)
    rewards: { perPipe: 2, firstClear: 25 },
    dailyTrack: [50, 60, 80, 100, 130, 160, 300]
  },

  /* Courier Closet v1 (C7, capped per B round 2): 4 skins, 3 scarves, 2 hats, 2 trails + Lagoon kept.
     Defaults (free): Tornis, coral scarf, scarf-ribbon trail, no hat. Prestige items cost 0 feathers
     and need a visible achievement — NEVER for sale (doctrine). Same hitbox for everything. */
  COSMETICS: {
    scarf: [
      { id: "coral", cost: 0, def: true, col: "#FF6B4A" },
      { id: "scarf_gold", cost: 400, col: "#F2C14E" },
      { id: "scarf_stripe", cost: 700, col: "#FFF1DC", col2: "#3B4CC0" },
      { id: "scarf_bluegold", cost: 1100, col: "#2E6BD6", col2: "#F2D14B" }
    ],
    hat: [
      { id: "goggles", cost: 900 },
      { id: "straw", cost: 1600 },
      { id: "crown", cost: 0, prestige: { type: "endless", n: 100 } }
    ],
    trail: [
      { id: "ribbon", cost: 0, def: true },
      { id: "trail_leaf", cost: 1300, col: "#6DBE45", dots: "#B8F28A" },
      { id: "trail_snow", cost: 2600, col: "#BFE6FF", dots: "#FFFFFF" }
    ]
  },

  /* Fågelkatalog (kosmetik — identisk fysik/hitbox för alla).
     Paletterna används av drawBird (samma geometri, olika färger). */
  BIRDS: [
    /* Identity V1: Tornis is the default for new players (palette in src/identity.js). Legacy
       entries keep their old colour fields so IDENTITY_V1 = false can still draw them. */
    { id: "tornis", cost: 0, v1: true },
    { id: "sunny", cost: 0, def: true, legacy: true,
      body: ["#ffe27a", "#ffc93f", "#f59a2e"], belly: "#fff3d0",
      wingBack: "#c85a1a", wing: ["#ff9a3c", "#e86a1e"], tail: "#e88a2e",
      tuft: "#ff9a3c", mark: "arc", markCol: "rgba(200,110,20,0.55)" },
    { id: "ang", cost: 1000, v1: true },
    { id: "glod", cost: 2000, v1: true },
    { id: "frost", cost: 4000, v1: true },
    { id: "natt", cost: 6500, v1: true },
    { id: "guld", cost: 0, v1: true, prestige: { type: "clear", level: 40 } },
    { id: "lagoon", cost: 200,
      body: ["#a5f3e8", "#4fd1c5", "#1f8a80"], belly: "#f0fffa",
      wingBack: "#b04a3a", wing: ["#ff8c69", "#e05a3a"], tail: "#2aa89b",
      tuft: "#ff8c69", mark: "wave", markCol: "rgba(20,110,120,0.6)" }
  ]
};
})();

/* E1: the active economy table is frozen (deep) in every build. Hygiene, not security. */
(function deepFreeze(o) { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; })(window.ECON);
