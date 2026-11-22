/* ============================================================
   DIPWING — src/economy.js (Omgång 5: gemensam ekonomikälla)
   ECON = aktiv, djupfryst konfiguration för Coins, prestige-F, fortsättning,
   utplacerade Coins, dagliga uppdrag och befintligt kosmetikinnehåll.
   ECON_PROPOSED = äldre inaktiva förslag; ECON_REJECTED = avvisade loot/pity-regler.
   Nya belopp för Omgång 5 hämtas från ECON, inte från spelkodens reservvärden.
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
  version: 3,
  /* Dipwing economy v2 integration (all active amounts live here). Values remain preliminary. */
  currency: {
    coinSymbol: "C", prestigeSymbol: "F", legacyField: "feathers",
    ledgerMax: 100, balanceMax: 999999.99, migrationRatio: 1,
    continueCost: 150, continueMaxPerRun: 1
  },
  /* Shop 1.0 is cosmetic-only. No purchase SDK or paid currency is active. */
  shop: {
    tabs: ["birds", "scarf", "trail", "hat", "effect", "theme", "archive", "collection"],
    undoMs: 30000, dailyShelfCount: 3, dailyDiscount: 0.20,
    rarity: {
      common: { min: 300, max: 600 }, uncommon: { min: 700, max: 1500 },
      rare: { min: 2000, max: 3500 }, epic: { min: 4000, max: 7000 },
      mythic: { min: 9000, max: 15000 }, legendary: { min: 150, max: 300, currency: "F" }
    },
    iapEnabled: false, supporterEnabled: false,
    iapCatalog: [] // future cosmetic-only structure; intentionally empty and never rendered while flags are false
  },
  placedCoins: {
    fixedMin: 6, fixedMax: 10, fixedValue: 1, riskValue: 5,
    fullValueDailyCap: 150, postCapValuePerCoin: 0.25,
    endlessEvery: 9, endlessOffset: 5, coinRadius: 9,
    safeCenterFraction: 0, riskOffsetFraction: 0.52, riskSafeFraction: 0.24, riskMaxOffsetRadius: 2.8,
    riskGroupFraction: 0.7, minEdgeClearance: 18,
    schedule(target, ordinaryCount) {
      const totalGroups = Math.max(8, Math.floor(Number(target) || 20));
      const count = Math.max(6, Math.min(10, Math.floor(Number(ordinaryCount) || 6)));
      const ordinaryGroups = Array.from({ length: count }, (_, i) =>
        Math.max(2, Math.min(totalGroups, Math.ceil((i + 1) * totalGroups / (count + 1))))).sort((a, b) => a - b);
      const riskGroup = Math.max(2, Math.min(totalGroups, Math.ceil(totalGroups * this.riskGroupFraction)));
      return { ordinaryGroups, riskGroup, ordinaryCount: count, totalCoinCount: count + 1 };
    }
  },
  missions: [
    { id: "pass_20", event: "pass", target: 20, reward: 15, titleSv: "Passera 20 hinder", titleEn: "Pass 20 obstacles" },
    { id: "collect_5", event: "collect", target: 5, reward: 15, titleSv: "Samla 5 ban-Coins", titleEn: "Collect 5 course Coins" },
    { id: "clear_1", event: "clear", target: 1, reward: 15, titleSv: "Klara en bana", titleEn: "Clear a level" }
  ],
  prestige: {
    retroGoldMedal: 5, retroWorldClear: 20,
    dailySeventhClaim: 5,
    achievementMin: 5, achievementMax: 20,
    signatureLevelClear: 10, allWorldGold: 20,
    weeklyChallenge: [4, 4, 6], eventReward: 10,
    retroWorldEnds: [3, 5, 10, 20],
    worldGoldRanges: [[1, 3], [4, 5], [6, 10], [11, 20]],
    /* Signature level IDs were not enumerated in the approved ECONOMY_v2; keep empty until confirmed. */
    signatureLevels: []
  },
  ads: {
    defaultMode: "off", testMode: "stub", testLabelSv: "TESTLÄGE – ingen riktig reklam",
    testLabelEn: "TEST MODE – no real ad",
    doubleRunRewardMultiplier: 2, doubleRunMaxClaimsPerRun: 1,
    doubleDailyMaxClaimsPerDay: 1
  },

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
    dailyCourse: 25,
    medalCoins: [10, 20, 40],
    placedCoinDailyFullCap: 150,
    placedCoinPostCap: 0.25,
    dailyMissionReward: 15
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
      { id: "goggles", cost: 900, rarity: "uncommon" },
      { id: "straw", cost: 1500, rarity: "uncommon" },
      { id: "crown", cost: 0, prestige: { type: "endless", n: 100 } }
    ],
    trail: [
      { id: "ribbon", cost: 0, def: true },
      { id: "trail_leaf", cost: 1300, col: "#6DBE45", dots: "#B8F28A", rarity: "uncommon" },
      { id: "trail_snow", cost: 2600, col: "#BFE6FF", dots: "#FFFFFF", rarity: "rare" }
    ],
    effect: [
      { id: "dust_coral", cost: 500, rarity: "common", puff: "255,107,74", feather: "255,184,48", particleAlpha: 0.55 },
      { id: "feather_sky", cost: 1200, rarity: "uncommon", puff: "124,192,238", feather: "141,242,220", particleAlpha: 0.55 },
      { id: "comet_bloom", cost: 9000, rarity: "mythic", puff: "190,160,255", feather: "255,218,120", particleAlpha: 0.62 },
      { id: "aurora_feather", cost: 150, currency: "F", rarity: "legendary", puff: "110,225,210", feather: "180,245,230", particleAlpha: 0.62 }
    ],
    theme: [
      { id: "sunset_menu", cost: 600, rarity: "common", accent: "#FF8A62", paper: "#FFF0D6" },
      { id: "night_menu", cost: 1400, rarity: "uncommon", accent: "#6C79D9", paper: "#F0EFFF" },
      { id: "neon_menu", cost: 3200, rarity: "rare", accent: "#39BEB0", paper: "#E6FFFA" },
      { id: "celestial_menu", cost: 300, currency: "F", rarity: "legendary", accent: "#9A78D7", paper: "#F4ECFF" }
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
    { id: "ang", cost: 1000, v1: true, rarity: "uncommon" },
    { id: "glod", cost: 2000, v1: true, rarity: "rare" },
    { id: "frost", cost: 4000, v1: true, rarity: "epic" },
    { id: "natt", cost: 6500, v1: true, rarity: "epic" },
    { id: "guld", cost: 0, v1: true, prestige: { type: "clear", level: 40 } },
    { id: "lagoon", cost: 200, rarity: "common",
      body: ["#a5f3e8", "#4fd1c5", "#1f8a80"], belly: "#f0fffa",
      wingBack: "#b04a3a", wing: ["#ff8c69", "#e05a3a"], tail: "#2aa89b",
      tuft: "#ff8c69", mark: "wave", markCol: "rgba(20,110,120,0.6)" }
  ]
};
})();

/* E1: the active economy table is frozen (deep) in every build. Hygiene, not security. */
(function deepFreeze(o) { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; })(window.ECON);
