/* ============================================================
   DIPWING — src/sim-core.js  (B-10, feat/3d-core)
   DEN GEMENSAMMA FYSIK-/SIMULERINGSMODULEN för 2D-renderaren och 3D-adaptern.
   Sim-lagret = src/rng.js (mulberry32-ström) + src/obstacles.js (hinderkontrakt + Director) + denna fil.
   Här bor: tuning (gravitation 1500, flax −440, maxfall 640), fast steg 1/120 s, ackumulator max 5 steg,
   fågelns integration och takspärr, hinderrörelse/spawn/borttagning, vindsumma, kollision (hitbox r = 11)
   och fysikhashen. Ingen DOM, ingen lagring, ingen rendering, ingen Math.random.
   REN REFAKTOR: varje uttryck är flyttat ordagrant från src/game/60-step.js och 80-sim-loop.js
   (dev 28f5dd3) i samma ordning, så flyttal och RNG-anrop blir identiska ⇒ identisk hash.
   Renderare (2D/3D) får bara LÄSA tillståndet (se snapshot()).
   ============================================================ */
(function () {
"use strict";

const DEFAULTS = Object.freeze({ gravity: 1500, flapVelocity: -440, maxFallSpeed: 640, birdXfrac: 0.32,
  speed: 155, gap: 205, spacing: 350, target: 10 });

const PHYS = Object.freeze({
  STEP: 1 / 120,      // fast fysiksteg (Gate B)
  MAX_STEPS: 5,       // ackumulatorns tak per bildruta (shed ⇒ slow-mo i stället för spiral)
  BIRD_R: 11,         // samma hitbox-radie för alla fåglar (doktrin regel 3)
  CEIL_Y: 14,         // takspärr
  PASS_LEAD: 12,      // passage räknas när hindrets högerkant är 12 px bakom fågeln
  SPAWN_MARGIN: 90,   // nästa hinder skapas när det senaste når högerkanten + 90 px
  CULL_X: -30,        // hinder tas bort när högerkanten passerat −30 px
  DEATH_MAX_VY: 900,  // fall under döds-animationen (inte hashat)
  DEFAULTS
});

/* Tuning: main.pjs (window.root) kan skriva över, med samma fallback-regler som tidigare (Gate C: 0 är giltigt). */
function readTuning() {
  const d = { ...DEFAULTS };
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

/* ---------- tid: fast steg via ackumulator ---------- */
function makeAccumulator() { return { STEP: PHYS.STEP, acc: 0 }; }
// identiskt med tidigare: acc = min(acc + dt, STEP * 5)
function accumulate(A, dt) { A.acc = Math.min(A.acc + dt, A.STEP * PHYS.MAX_STEPS); }
// kör högst MAX_STEPS steg så länge canStep() gäller; returnerar antal steg
function drain(A, canStep, step) {
  let n = 0;
  while (A.acc >= A.STEP && canStep() && n < PHYS.MAX_STEPS) {
    step(A.STEP);
    A.acc -= A.STEP;
    n++;
  }
  return n;
}

/* ---------- fågel ---------- */
function flap(bird, T) { bird.vy = T.flapVelocity; bird.wing = -0.9; }
function integrateBird(bird, windA, dt, T) {
  bird.vy = Math.min(bird.vy + (T.gravity + windA) * dt, T.maxFallSpeed);
  bird.y += bird.vy * dt;
}
function clampCeiling(bird) { if (bird.y < PHYS.CEIL_Y) { bird.y = PHYS.CEIL_Y; bird.vy = 0; } }

/* ---------- hinder ---------- */
function rampSpeed(c, score) {
  const rampF = 1 + c.ramp * Math.min(1, score / Math.max(1, c.target));
  return c.speed * rampF;
}
function advanceObstacles(S, speed, dt) {
  for (const ob of S.pipes) {
    ob.x -= speed * dt;
    window.OBSTACLES[ob.fam].update(ob, dt, S);
  }
}
function windAccel(S) {
  let windA = 0;
  for (const ob of S.pipes) {
    if (ob.fam === "wind" && S.bird.x > ob.x && S.bird.x < ob.x + ob.w) windA += ob.accel;
  }
  if (window.THERMALS_ON && S.mode === "sky") windA += window.Director.thermalA(S); // Sky thermal bands (same sum ⇒ Sim = live)
  return windA;
}
function maybeSpawn(S) {
  const lastOb = S.pipes[S.pipes.length - 1];
  if (!lastOb) window.Director.spawnNext(window.RNG, S);
  else if (lastOb.x < S.W + PHYS.SPAWN_MARGIN) window.Director.spawnNext(window.RNG, S);
}
function isPassed(ob, bird) { return !ob.passed && ob.x + ob.w < bird.x - PHYS.PASS_LEAD; }
function cullObstacles(S) { while (S.pipes.length && S.pipes[0].x + S.pipes[0].w < PHYS.CULL_X) S.pipes.shift(); }

/* ---------- kollision (förlåtande hitbox; varje familj definierar sin egen) ---------- */
function groundY(S) { return S.H - S.groundH; }
function hitsGround(bird, br, gy) { return bird.y + br >= gy; }
function hitsObstacle(S, br) {
  for (const ob of S.pipes) {
    if (window.OBSTACLES[ob.fam].collide(ob, S.bird.x, S.bird.y, br, S)) return true;
  }
  return false;
}

/* ---------- fysikhash (Gate B: bara fysiktid ptime hashas) ---------- */
function hash(S) {
  const obs = S.pipes.map(o => [o.fam, r2(o.x), r2(o.gapY), r2(o.gap),
    r2(o.baseY == null ? -1 : o.baseY), r2(o.t), o.passed ? 1 : 0,
    r2(o.amp || 0), r2(o.warn || 0), r2(o.toff || 0), o.state || "-",
    r2(o.by == null ? -9999 : o.by)].concat(o.th ? ["th" + o.th.map(b => b.x0 + "/" + b.x1 + "/" + b.y0 + "/" + b.y1 + "/" + b.a).join(":")] : []).join(",")).join("|"); // Sky thermals only when present
  const s = [r2(S.bird.x), r2(S.bird.y), r2(S.bird.vy), S.score, r2(S.camX),
    r2(S.ptime), S.spawnCount, S.prevGapY == null ? -1 : r2(S.prevGapY)].join(";") + "#" + obs;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16) + ":" + s.length;
  function r2(v) { return Math.round(v * 100) / 100; }
}

/* ---------- läsvy för renderare (2D/3D). Kopia – en renderare kan aldrig skriva tillbaka. ---------- */
function snapshot(S) {
  return {
    ptime: S.ptime, score: S.score, state: S.state, level: S.level, mode: S.mode, W: S.W, H: S.H,
    groundY: S.H - S.groundH, camX: S.camX, speed: S.curSpeed,
    bird: { x: S.bird.x, y: S.bird.y, vy: S.bird.vy, r: PHYS.BIRD_R },
    gates: S.pipes.map(o => ({ fam: o.fam, x: o.x, w: o.w, gapY: o.gapY, gap: o.gap, t: o.t,
      passed: !!o.passed, state: o.state || null, warn: o.warn || 0 }))
  };
}

window.DipwingSim = Object.freeze({
  VERSION: "sim-core-1 (B-10, refaktor av dev 28f5dd3)",
  PHYS, readTuning, makeAccumulator, accumulate, drain,
  flap, integrateBird, clampCeiling,
  rampSpeed, advanceObstacles, windAccel, maybeSpawn, isPassed, cullObstacles,
  groundY, hitsGround, hitsObstacle, hash, snapshot
});
})();
