/* ============================================================
   DIPWING — src/rng.js (Phase 0)
   Separerade slumpströmmar:
   - RNG.game  = GAMEPLAY (hinder, sekvenser). Seedad ⇒ deterministisk.
   - Math.random = DEKOR (moln, partiklar, ambient). Påverkar aldrig spel.
   ============================================================ */
(function () {
"use strict";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const RNG = {
  _fn: mulberry32(1),
  seed: 1,

  // Starta en ny gameplay-sekvens. Samma seed ⇒ samma hinderföljd.
  reset(seed) {
    this.seed = seed >>> 0;
    this._fn = mulberry32(this.seed);
  },

  // Rått gameplay-tal i [0,1)
  next() { return this._fn(); },

  range(a, b) { return a + this._fn() * (b - a); },

  int(a, b) { return a + Math.floor(this._fn() * (b - a + 1)); },

  pick(arr) { return arr[Math.floor(this._fn() * arr.length) % arr.length]; },

  chance(p) { return this._fn() < p; },

  // Daglig utmaning: alla får samma seed ⇒ samma hinder (rättvis tävling)
  dailySeed(dateStr) { return hashStr("dipwing-daily-v1-" + dateStr); } // Identity V1: no legacy name in seeds
};

window.RNG = RNG;
window.mulberry32 = mulberry32;
})();
