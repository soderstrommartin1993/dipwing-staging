/* ============================================================
   DIPWING — src/r3d-sim-adapter.js  (B-10, feat/3d-core)
   3D-vägens ingång mot den GEMENSAMMA simmodulen (src/sim-core.js, window.DipwingSim).
   B-11: Three.js-renderaren (src/render3d.js + src/r3d-studio.js) matas ENBART via renderView(S) nedan.
   Adapterkontraktet:
   - 3D äger aldrig fysik, input eller tid. Den läser DipwingSim.snapshot(S) (en kopia) och mappar till 3D-världen.
   - Fast steg/ackumulator kommer från DipwingSim (makeAccumulator/accumulate/drain), inte från 3D-loopen.
   - Hashen räknas med DipwingSim.hash(S) – samma funktion som 2D:s Sim.hash().
   Laddas inte av index.html: 72-render3d.js laddar den lat när 3D väljs (bara i test- och --3d-bygget);
   tools/sim-parity.mjs injicerar den i testbygget.
   Headless: ingen WebGL, ingen DOM-rendering.
   ============================================================ */
(function () {
"use strict";
const DS = () => window.DipwingSim;
const UNIT = 1 / 100; // 1 världsenhet = 100 logiska px (render3d: spelplanet z = 0, y uppåt)

const Sim3D = {
  frames: 0, lastView: null,
  /* 2D-logisk plan (480×800, y nedåt) → 3D-värld (y uppåt, z = 0 spelplan). Bara läsning. */
  toWorld(v) {
    const X = x => x * UNIT, Y = y => (v.H - y) * UNIT;
    return {
      ptime: v.ptime, score: v.score, state: v.state,
      bird: { pos: [X(v.bird.x), Y(v.bird.y), 0], vy: -v.bird.vy * UNIT, r: v.bird.r * UNIT },
      gates: v.gates.map(g => ({ fam: g.fam, x0: X(g.x), x1: X(g.x + g.w), gapC: Y(g.gapY), gapH: g.gap * UNIT, t: g.t, passed: g.passed })),
      ground: Y(v.groundY), cam: X(v.camX)
    };
  },
  /* B-11: RENDERVY för Three.js-renderaren (src/render3d.js + r3d-studio.js). Allt renderaren får se går härigenom:
     fysikdelen kommer från DipwingSim.snapshot(S) (kopia), plus de rent visuella fälten renderaren behöver
     (S.time för dekor, kamerans camY/viewH, fågelns rot/vinge/flaxtid, världsnyckel). Hindren lämnas som KOPIOR med
     stabil identitet (WeakMap original → kopia, fälten skrivs om varje bildruta) så renderarens mesh-pooler kan
     följa ett hinder mellan bildrutor – men en renderare kan aldrig skriva tillbaka till S.pipes. */
  _obCopy: new WeakMap(),
  renderView(S) {
    const v = DS().snapshot(S), m = this._obCopy;
    const pipes = S.pipes.map(o => { let c = m.get(o); if (!c) { c = {}; m.set(o, c); } return Object.assign(c, o); });
    return Object.freeze({
      // fysik (DipwingSim)
      ptime: v.ptime, score: v.score, state: v.state, level: v.level, mode: v.mode, W: v.W, H: v.H, camX: v.camX,
      groundH: S.groundH, groundY: v.groundY, speed: v.speed, gates: v.gates, pipes: Object.freeze(pipes),
      bird: Object.freeze(Object.assign({}, v.bird, { rot: S.bird.rot, wing: S.bird.wing, flapAt: S.bird.flapAt, alive: S.bird.alive })),
      // presentation (inte hashat, ingen fysik)
      time: S.time, camY: S.camY, viewW: S.viewW || S.W, viewH: S.viewH, offX: S.offX || 0, worldKey: S.worldKey,
      shake: S.shake, shakeT: S.shakeT
    });
  },
  /* en "renderbildruta": läser simmen via snapshot och bygger 3D-vymodellen */
  frame(S) { const v = DS().snapshot(S); this.lastView = this.toWorld(v); this.frames++; return v; },

  _begin(F, seed, level, mode) { this._mode0 = F.S.mode; if (mode) F.S.mode = mode; F.Sim.begin(seed, level, 800); },
  _end(F) { F.Sim.end(); F.S.mode = this._mode0; },
  _out(F, t) {
    const S = F.S;
    return { result: S.simResult || (S.state === "playing" ? "timeout" : S.state), score: S.score, ticks: t, hash: DS().hash(S) };
  },

  /* 3D-väg A: ett fast steg per tick, 3D-bildruta efter varje steg, policy fattar beslut på 3D-sidans snapshot */
  run(F, seed, level, ticks, policy, mode) {
    this._begin(F, seed, level, mode);
    let t = 0, view = this.frame(F.S);
    try {
      for (; t < ticks; t++) {
        if (F.S.simResult || F.S.state !== "playing") break;
        F.Sim.tick(!!policy(view));
        view = this.frame(F.S);
      }
      return this._out(F, t);
    } finally { this._end(F); }
  },

  /* 3D-väg B: oregelbundna bildrutor (seedade dt 7–50 ms + lagg-spikar) genom DipwingSims ackumulator,
     0–3 extra läsningar per bildruta. Samma antal fysiksteg ⇒ samma hash om 3D bara läser. */
  runFrames(F, seed, level, ticks, policy, frameSeed, mode) {
    const rnd = window.mulberry32(frameSeed >>> 0), D = DS();
    const DTS = [1 / 144, 1 / 120, 1 / 90, 1 / 60, 1 / 50, 1 / 30, 0.05, 0.013, 0.021, 0.0333];
    this._begin(F, seed, level, mode);
    const A = D.makeAccumulator();
    let t = 0, view = this.frame(F.S), frames = 0, shed = 0;
    const canStep = () => t < ticks && !F.S.simResult && F.S.state === "playing";
    try {
      while (canStep() && frames < ticks * 10) {
        let dt = DTS[Math.floor(rnd() * DTS.length)];
        if (rnd() < 0.01) { dt = 0.05; A.acc = 10; shed++; } // lagg-spik: ackumulatorn ska kapa till 5 steg
        frames++;
        D.accumulate(A, dt);
        D.drain(A, canStep, () => { F.Sim.tick(!!policy(view)); t++; view = this.frame(F.S); });
        const extra = Math.floor(rnd() * 4); for (let i = 0; i < extra; i++) this.frame(F.S);
      }
      const o = this._out(F, t); o.frames = frames; o.shed = shed; return o;
    } finally { this._end(F); }
  }
};
window.Sim3D = Sim3D;
})();
