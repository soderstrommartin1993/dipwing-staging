/* ============================================================
   DIPWING — src/obstacles.js (Phase 0)
   8 fristående hinderfamiljer + Director (spawn-sekvens) + validering.

   Kontrakt per familj:
     spawn(R, S, x, gapY) -> ob          (R = RNG helper {range,int,pick,chance,next})
     update(ob, dt, env)                 (env = {speed}; skrollning sköts av spelet)
     collide(ob, bx, by, br, env) -> bool
     draw(c, ob, S)                      (c = ctx)
     .timing  (true = tajminghinder: aldrig intill annat tajminghinder)
     .intro   (nivå där familjen introduceras)

   All gameplay-slump kommer från R (seedad). Math.random används ALDRIG här.
   ============================================================ */
(function () {
"use strict";

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* ---------- introduktionsnivåer (gradvis, aldrig allt i nivå 1) ---------- */
const INTRO = {
  classic: 1, drift: 4, pulse: 6, wind: 8,
  pendulum: 11, rock: 13, laser: 15, blade: 18
};
const NAMES = {
  classic: "Klassiska rör", drift: "Drivande rör", pulse: "Pulsgate",
  wind: "Vindtunnel", pendulum: "Pendel", rock: "Fallande sten",
  laser: "Laserbarriär", blade: "Rotorsåg", weave: "Vävaren"
};
/* Idé 4 – Vävaren (feature flag, default PÅ): ?weave=0 eller localStorage pfb_weave="0" ⇒ exakt
   v0.4-sekvensen (familjen finns inte i INTRO/vikter ⇒ samma RNG-anrop ⇒ samma fysikfingeravtryck). */
const WEAVE_ON = (function () {
  try { const q = new URLSearchParams(location.search).get("weave"); if (q === "0") return false; if (q === "1") return true;
    return !((window.SafeStorage ? SafeStorage.get("pfb_weave") : (window.localStorage && localStorage.getItem("pfb_weave"))) === "0"); } catch (e) { return true; }
})();
if (WEAVE_ON) INTRO.weave = 7;

/* ---------- familjevikter per nivå (Director) ---------- */
function weightsFor(level) {
  const w = [{ id: "classic", w: 10 }];
  const add = (id, weight) => { if (level >= INTRO[id]) w.push({ id, w: weight }); };
  add("drift", level >= 11 ? 3.2 : 2.2);
  add("pulse", level >= 15 ? 2.6 : 2.0);
  add("wind", 2.0);
  add("pendulum", 1.8);
  add("rock", 1.8);
  add("laser", 1.6);
  add("blade", 1.8);
  // sena nivåer: mer tajming, mindre klassiskt
  if (level >= 21) { w[0].w = 4; }
  // Gate D: bortom 21 växer tajmingtrycket mjukt vidare (ingen ny platå)
  if (level >= 25) { for (const e of w) if (e.id !== "classic") e.w += 0.5; }
  if (level >= 35) { for (const e of w) if (e.id !== "classic") e.w += 0.5; }
  // Vävaren: lärs ut L7–14 (2,4), måttlig L15–17 (1,8), lägre när tajmingfamiljerna tar över (1,2).
  // Läggs SIST så att listan (och därmed RNG-utfallet) för övriga familjer är oförändrad när flaggan är av.
  if (INTRO.weave != null) add("weave", level <= 14 ? 2.4 : level < 18 ? 1.8 : 1.2);
  return w;
}

function pickWeighted(R, list) {
  let total = 0;
  for (const e of list) total += e.w;
  let r = R.next() * total;
  for (const e of list) { r -= e.w; if (r <= 0) return e.id; }
  return list[0].id;
}

/* Delad kollisionshjälp för grindfamiljerna (Gate A):
   varje hinder kräver passage genom sitt gap — takflygning
   (eller golvflygning) genom grindområdet är alltid dödligt.
   Farans egen träffyta läggs TILL (union), aldrig istället. */
function corridorHit(ob, bx, by, br) {
  if (bx + br <= ob.x + 4 || bx - br >= ob.x + ob.w - 4) return false;
  const top = ob.gapY - ob.gap / 2, bot = ob.gapY + ob.gap / 2;
  return (by - br < top + 3 || by + br > bot - 3);
}
/* ---------- gapY-promenad (rättvis: begränsad ändring per hinder) ----------
   Gate A: null = oinitierad (mittenstart). Live-init MÅSTE vara null —
   0 tolkas som "förra gapet vid y=0" och kläms mot topMargin (taktak). */
/* Gate D: svårighetsnivå — adventure använder S.level, endless har S.diff
   (pseudo-nivå från poäng). Samma Director, samma rättvisa. */
function difflv(S) { return S.diff != null ? S.diff : S.level; }
/* ---------- gapY-promenad (rättvis: begränsad ändring per hinder) ----------
   Gate A: null = oinitierad (mittenstart). Live-init MÅSTE vara null —
   0 tolkas som "förra gapet vid y=0" och kläms mot topMargin (taktak). */
function walkGapY(R, S, prevY, minGap, jumpCap) {
  const c = S.cfg;
  const mj = jumpCap != null ? Math.min(c.maxJump, jumpCap) : c.maxJump; // A5: tidsbaserat tak
  const topMargin = 110, botMargin = S.groundH + 95;
  const lo = topMargin + minGap / 2, hi = S.H - botMargin - minGap / 2;
  let y;
  if (prevY == null) {
    y = (lo + hi) / 2 + R.range(-40, 40);
  } else {
    y = clamp(prevY + R.range(-mj, mj), lo, hi);
    if (difflv(S) <= 3) y = (lo + hi) / 2 + (y - (lo + hi) / 2) * 0.75;
  }
  return { y: clamp(y, lo, hi), lo, hi };
}

/* ============================================================
   FAMILJER
   ============================================================ */
const OBSTACLES = {

  /* ---- 1. Klassiska rör (m. tvillingformation) ---- */
  classic: {
    name: NAMES.classic, intro: INTRO.classic, timing: false, w: 78,
    spawn(R, S, x, gapY) {
      return { fam: "classic", x, w: 78, gapY, gap: S.cfg.gap,
        passed: false, ph: R.range(0, TAU), t: 0, twin: false };
    },
    update(ob, dt) { ob.t += dt; },
    gapNow(ob) { return { top: ob.gapY - ob.gap / 2, bot: ob.gapY + ob.gap / 2 }; },
    collide(ob, bx, by, br) {
      if (bx + br <= ob.x + 4 || bx - br >= ob.x + ob.w - 4) return false;
      const g = this.gapNow(ob);
      return (by - br < g.top + 3 || by + br > g.bot - 3);
    },
    draw(c, ob, S) { window.FX.drawPipePair(c, ob, S); }
  },

  /* ---- 9. Vävaren (idé 4): två förskjutna kolumner = ett spawn, dyk ned genom kolumn 1, glid upp
     genom kolumn 2. Två vanliga hinderobjekt (role 1/2) så poäng, passed-flanken, städning och
     fysikhash förblir exakt samma maskineri som för tvillingar (2 poäng). Rättvisan sätts i Director. */
  weave: {
    name: NAMES.weave, intro: 7, timing: false, w: 78, weave: true,
    spawn(R, S, x, gapY, role) {
      return { fam: "weave", x, w: 78, gapY, gap: S.cfg.gap + 24, passed: false, t: 0, role: role || 1, twin: role === 2 };
    },
    update(ob, dt) { ob.t += dt; },
    collide(ob, bx, by, br) { return corridorHit(ob, bx, by, br); },
    draw(c, ob, S) {
      window.FX.drawPipePair(c, ob, S);
      if (window.IDENTITY && IDENTITY.drawWeaveMark) IDENTITY.drawWeaveMark(c, ob, S);
    }
  },

  /* ---- 2. Drivande rör (sinus i höjd) ---- */
  drift: {
    name: NAMES.drift, intro: INTRO.drift, timing: false, w: 78,
    spawn(R, S, x, gapY) {
      const lv = difflv(S);
      const amp = lv >= 11 ? Math.min(110, 30 + (lv - 11) * 9)
                           : 12 + Math.max(0, lv - 4) * 5;
      return { fam: "drift", x, w: 78, baseY: gapY, gapY, gap: S.cfg.gap,
        passed: false, ph: R.range(0, TAU), t: 0,
        amp, spd: Math.min(1.6, 0.9 + lv * 0.03) };
    },
    update(ob, dt, env) {
      ob.t += dt;
      ob.gapY = ob.baseY + Math.sin(ob.t * ob.spd + ob.ph) * ob.amp;
      const topM = 100 + ob.gap / 2, botM = env.H - env.groundH - 80 - ob.gap / 2;
      ob.gapY = clamp(ob.gapY, topM, botM);
    },
    gapNow(ob) { return { top: ob.gapY - ob.gap / 2, bot: ob.gapY + ob.gap / 2 }; },
    collide(ob, bx, by, br) {
      if (bx + br <= ob.x + 4 || bx - br >= ob.x + ob.w - 4) return false;
      const g = this.gapNow(ob);
      return (by - br < g.top + 3 || by + br > g.bot - 3);
    },
    draw(c, ob, S) {
      window.FX.drawPipePair(c, ob, S);
      // mjuk glödram + riktningspilar som visar vart gapet glider
      const vy = ob.amp * ob.spd * Math.cos(ob.t * ob.spd + ob.ph);
      const dir = vy > 4 ? 1 : vy < -4 ? -1 : 0;
      c.save();
      c.globalAlpha = 0.30 + 0.18 * Math.sin(S.time * 5 + ob.ph);
      c.strokeStyle = "#ffe27a"; c.lineWidth = 7; c.lineCap = "round";
      c.beginPath();
      if (c.roundRect) c.roundRect(ob.x - 6, ob.gapY - ob.gap / 2 - 44, ob.w + 12, ob.gap + 88, 12);
      else c.rect(ob.x - 6, ob.gapY - ob.gap / 2 - 44, ob.w + 12, ob.gap + 88);
      c.stroke();
      c.globalAlpha = 0.85;
      c.strokeStyle = "#fff3c4"; c.lineWidth = 2.5;
      c.setLineDash([10, 8]);
      c.stroke();
      c.setLineDash([]);
      if (dir !== 0) {
        const cx = ob.x + ob.w / 2;
        const ay = dir > 0 ? ob.gapY + ob.gap / 2 + 24 : ob.gapY - ob.gap / 2 - 24;
        c.globalAlpha = 0.9;
        c.fillStyle = "#ffe27a";
        c.strokeStyle = "#2b2118"; c.lineWidth = 2;
        c.beginPath();
        if (dir > 0) { c.moveTo(cx - 9, ay - 8); c.lineTo(cx + 9, ay - 8); c.lineTo(cx, ay + 2); }
        else { c.moveTo(cx - 9, ay + 8); c.lineTo(cx + 9, ay + 8); c.lineTo(cx, ay - 2); }
        c.closePath(); c.fill(); c.stroke();
      }
      c.restore();
    }
  },

  /* ---- 3. Pulsgate (gapet öppnas/stängs periodiskt) ---- */
  pulse: {
    name: NAMES.pulse, intro: INTRO.pulse, timing: false, w: 78,
    spawn(R, S, x, gapY) {
      const lv = difflv(S);
      const base = S.cfg.gap + 34;
      const amp = Math.min(46, 20 + lv * 2);
      return { fam: "pulse", x, w: 78, gapY, baseGap: base,
        gap: base, passed: false, ph: R.range(0, TAU), t: 0,
        amp, period: Math.max(1.9, 2.7 - lv * 0.04) };
    },
    update(ob, dt) {
      ob.t += dt;
      ob.gap = ob.baseGap + Math.sin((ob.t / ob.period) * TAU + ob.ph) * ob.amp;
      if (ob.gap < 130) ob.gap = 130; // validerad minsta öppning
    },
    gapNow(ob) { return { top: ob.gapY - ob.gap / 2, bot: ob.gapY + ob.gap / 2 }; },
    collide(ob, bx, by, br) {
      if (bx + br <= ob.x + 4 || bx - br >= ob.x + ob.w - 4) return false;
      const g = this.gapNow(ob);
      return (by - br < g.top + 3 || by + br > g.bot - 3);
    },
    draw(c, ob, S) {
      window.FX.drawPipePair(c, ob, S);
      // pilar som visar pulsriktning (kontur + glöd = tydligare)
      const openness = (ob.gap - 130) / Math.max(1, ob.baseGap + ob.amp - 130);
      const cx = ob.x + ob.w / 2;
      const dir = Math.cos((ob.t / ob.period) * TAU + ob.ph) > 0 ? 1 : -1;
      c.save();
      c.globalAlpha = 0.35 + 0.3 * openness;
      c.fillStyle = openness > 0.45 ? "#b8f0c0" : "#ffb3b3";
      c.beginPath(); c.arc(cx, ob.gapY, 20, 0, TAU); c.fill();
      c.globalAlpha = 0.6 + 0.35 * openness;
      c.fillStyle = openness > 0.45 ? "#e8fff0" : "#ffe0e0";
      c.strokeStyle = "#2b2118"; c.lineWidth = 2.5;
      for (const s of [-1, 1]) {
        const yy = ob.gapY + s * 13 * dir;
        c.beginPath();
        c.moveTo(cx - 10, yy - s * 7 * dir); c.lineTo(cx + 10, yy - s * 7 * dir); c.lineTo(cx, yy + s * 4 * dir);
        c.closePath(); c.fill(); c.stroke();
      }
      c.restore();
    }
  },

  /* ---- 4. Vindtunnel (vertikal zon som påverkar fysik) ---- */
  wind: {
    name: NAMES.wind, intro: INTRO.wind, timing: false, w: 120,
    spawn(R, S, x, gapY) {
      const lv = difflv(S);
      const dir = R.chance(0.5) ? -1 : 1; // -1 = uppvind, +1 = nedvind
      const frac = Math.min(0.45, 0.26 + lv * 0.012);
      return { fam: "wind", x, w: 120, gapY, gap: S.cfg.gap + 20,
        passed: false, ph: R.range(0, TAU), t: 0,
        accel: dir * frac * 1500, dir };
    },
    update(ob, dt) { ob.t += dt; },
    collide(ob, bx, by, br) { return corridorHit(ob, bx, by, br); }, // grind + vindknuff (dödar aldrig direkt UTANFÖR grind — men grinden kräver passage)
    draw(c, ob, S) {
      window.FX.drawGate(c, ob, S);
      const gy = S.H - S.groundH;
      const F = window.FX;
      // metallstolpar med bultar
      for (const px of [ob.x - 6, ob.x + ob.w - 4]) {
        const g = c.createLinearGradient(px, 0, px + 10, 0);
        g.addColorStop(0, "#5d7186"); g.addColorStop(0.5, "#aebfd0"); g.addColorStop(1, "#3d4c5c");
        c.fillStyle = g;
        c.fillRect(px, 40, 10, gy - 40);
        c.fillStyle = "#2b2118";
        c.fillRect(px, 40, 10, 3); c.fillRect(px, gy - 3, 10, 3);
        c.fillStyle = "rgba(255,255,255,0.5)";
        c.fillRect(px + 2, 44, 2, gy - 48);
      }
      // vimplar som vajar i vindriktningen
      for (const [fx, fy] of [[ob.x - 1, 52], [ob.x + ob.w - 9, 52]]) {
        const wave = Math.sin(S.time * 9 + ob.ph + fx) * 4;
        c.save();
        c.fillStyle = S.world.pipe[1];
        c.strokeStyle = "#2b2118"; c.lineWidth = 1.5;
        c.beginPath();
        if (ob.dir < 0) { // uppvind: vimpeln pekar upp
          c.moveTo(fx, fy + 12); c.quadraticCurveTo(fx + 10, fy + 8 + wave, fx + 19, fy + 2 + wave);
          c.lineTo(fx + 10, fy + 1); c.quadraticCurveTo(fx + 5, fy + 6, fx, fy + 8);
        } else { // nedvind: vimpeln pekar ner
          c.moveTo(fx, fy); c.quadraticCurveTo(fx + 10, fy + 4 + wave, fx + 19, fy + 10 + wave);
          c.lineTo(fx + 10, fy + 11); c.quadraticCurveTo(fx + 5, fy + 6, fx, fy + 4);
        }
        c.closePath(); c.fill(); c.stroke();
        c.restore();
      }
      // strömmar (mörk underlag + mättad färg = läsbart mot alla himlar)
      const streamCol = ob.dir < 0 ? "#3fa9e0" : "#ef7d23";
      c.save();
      c.lineCap = "round";
      const n = 5;
      for (let i = 0; i < n; i++) {
        const lx = ob.x + 12 + (i / (n - 1)) * (ob.w - 24);
        const flow = (S.time * (140 + i * 22) + ob.ph * 60) % (gy - 80);
        const y = ob.dir < 0 ? gy - 40 - flow : 60 + flow;
        const a = 0.45 + 0.4 * (1 - Math.abs(y - gy / 2) / (gy / 2));
        const drawArrow = () => {
          c.beginPath();
          if (ob.dir < 0) { c.moveTo(lx, y + 22); c.lineTo(lx, y - 6); c.moveTo(lx - 5, y + 2); c.lineTo(lx, y - 6); c.lineTo(lx + 5, y + 2); }
          else { c.moveTo(lx, y - 22); c.lineTo(lx, y + 6); c.moveTo(lx - 5, y - 2); c.lineTo(lx, y + 6); c.lineTo(lx + 5, y - 2); }
          c.stroke();
        };
        c.globalAlpha = a * 0.55; c.strokeStyle = "#2b2118"; c.lineWidth = 6;
        drawArrow();
        c.globalAlpha = a; c.strokeStyle = streamCol; c.lineWidth = 3;
        drawArrow();
        c.globalAlpha = a; c.strokeStyle = "rgba(255,255,255,0.85)"; c.lineWidth = 1.2;
        drawArrow();
      }
      c.restore();
    }
  },

  /* ---- 5. Pendel (svängande klot i öppningen) ---- */
  pendulum: {
    name: NAMES.pendulum, intro: INTRO.pendulum, timing: true, w: 90,
    spawn(R, S, x, gapY) {
      const lv = difflv(S);
      const gap = Math.max(S.cfg.gap + 70, 235);
      const L = gap * 0.44;
      return { fam: "pendulum", x, w: 90, gapY, gap,
        passed: false, ph: R.range(0, TAU), t: 0,
        L, bobR: 16, amp: Math.min(L * 0.95, 80 + lv * 2.2),
        period: Math.max(2.1, 3.3 - lv * 0.05), hubX: x + 45, hubY: 0 };
    },
    update(ob, dt) { ob.t += dt; },
    bob(ob) {
      const a = Math.sin((ob.t / ob.period) * TAU + ob.ph) * ob.amp;
      return { x: ob.x + ob.w / 2 + a, y: ob.gapY };
    },
    collide(ob, bx, by, br) {
      if (corridorHit(ob, bx, by, br)) return true; // grinden kräver passage (takflygning stoppas här)
      const b = this.bob(ob);
      const dx = bx - b.x, dy = by - b.y;
      return dx * dx + dy * dy < (br + ob.bobR - 3) * (br + ob.bobR - 3);
    },
    draw(c, ob, S) {
      window.FX.drawGate(c, ob, S);
      const cx = ob.x + ob.w / 2;
      const topY = 0;
      const b = this.bob(ob);
      // takfäste (platta + bultar)
      c.fillStyle = "#3d4c5c";
      c.strokeStyle = "#2b2118"; c.lineWidth = 2.5;
      c.beginPath(); c.rect(cx - 16, topY, 32, 12); c.fill(); c.stroke();
      c.fillStyle = "rgba(255,255,255,0.5)";
      c.beginPath(); c.arc(cx - 9, topY + 6, 2, 0, TAU); c.arc(cx + 9, topY + 6, 2, 0, TAU); c.fill();
      // kedja (länkar längs armen)
      c.strokeStyle = "#2b2118"; c.lineWidth = 6; c.lineCap = "round";
      c.beginPath(); c.moveTo(cx, topY + 12); c.lineTo(b.x, b.y); c.stroke();
      c.strokeStyle = "#8a99aa"; c.lineWidth = 2.5;
      c.beginPath(); c.moveTo(cx, topY + 12); c.lineTo(b.x, b.y); c.stroke();
      c.fillStyle = "#2b2118";
      const segs = 5;
      for (let i = 1; i < segs; i++) {
        const lx = cx + (b.x - cx) * (i / segs), ly = topY + 12 + (b.y - topY - 12) * (i / segs);
        c.beginPath(); c.arc(lx, ly, 2.5, 0, TAU); c.fill();
      }
      // klot med piggar + metallglans
      const g = c.createRadialGradient(b.x - 6, b.y - 6, 2, b.x, b.y, ob.bobR + 6);
      g.addColorStop(0, "#ffd9a0"); g.addColorStop(0.55, "#e8763a"); g.addColorStop(1, "#7a2f14");
      c.fillStyle = g;
      c.beginPath(); c.arc(b.x, b.y, ob.bobR, 0, TAU); c.fill();
      c.strokeStyle = "#2b2118"; c.lineWidth = 2.5; c.stroke();
      // roterande glint (visar att klotet snurrar)
      c.save();
      c.strokeStyle = "rgba(255,255,255,0.75)"; c.lineWidth = 3; c.lineCap = "round";
      c.beginPath(); c.arc(b.x, b.y, ob.bobR - 5, ob.t * 0.8, ob.t * 0.8 + 0.9); c.stroke();
      c.restore();
      c.fillStyle = "#2b2118";
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + ob.t * 0.8;
        const sx = b.x + Math.cos(a) * ob.bobR, sy = b.y + Math.sin(a) * ob.bobR;
        c.beginPath(); c.arc(sx, sy, 3.4, 0, TAU); c.fill();
        c.fillStyle = "rgba(255,255,255,0.35)";
        c.beginPath(); c.arc(sx - 1, sy - 1, 1.2, 0, TAU); c.fill();
        c.fillStyle = "#2b2118";
      }
      c.fillStyle = "rgba(255,255,255,0.6)";
      c.beginPath(); c.arc(b.x - 5, b.y - 6, 3.5, 0, TAU); c.fill();
    }
  },

  /* ---- 6. Fallande sten (varning → fall → ofarlig) ---- */
  rock: {
    name: NAMES.rock, intro: INTRO.rock, timing: true, w: 78,
    spawn(R, S, x, gapY) {
      const lv = difflv(S);
      return { fam: "rock", x, w: 78, gapY, gap: Math.max(S.cfg.gap + 40, 190),
        passed: false, ph: R.range(0, TAU), t: 0,
        warn: Math.max(0.85, 1.35 - lv * 0.02), // varningstid (min 0.85 s)
        rockW: 44, rockH: 38, vy: 0, ry: 0, state: "warn", warnOn: false, tw: 0 };
    },
    /* A6 (P1-3): avståndsstyrd tajming. Tidigare startade varningstimern vid spawn (utanför bild), så
       fallet sammanföll med att fågeln passerade (L13–17) eller skedde osynligt utanför bild (L18+).
       Nu: stenen landar senast när kolumnen är LAND_LEAD s före fågeln; fallet startar så att det hinns
       med; varningen börjar `warn` s före fallet (kantmarkör medan kolumnen ännu är utanför bild). */
    LAND_LEAD: 0.10,
    fallTime(ob, env) {
      const gy = env.H - env.groundH;
      const d = Math.max(0, Math.min(ob.gapY + ob.gap / 2, gy) - 4 - (ob.gapY - ob.gap / 2 - ob.rockH - 6));
      const a = 1500 * 1.7, v0 = 60;
      return (-v0 + Math.sqrt(v0 * v0 + 2 * a * d)) / a;
    },
    fallX(ob, env) { // kolumnens x när fallet ska starta
      const sp = env.curSpeed || (env.cfg && env.cfg.speed) || 200;
      return env.bird.x + 11 + sp * (this.LAND_LEAD + this.fallTime(ob, env));
    },
    warningVisible(ob, env) { return ob.state === "warn" && !!ob.warnOn; },
    update(ob, dt, env) {
      ob.t += dt;
      const gy = env.H - env.groundH;
      const topY = ob.gapY - ob.gap / 2 - ob.rockH - 6;
      if (ob.state === "warn") {
        ob.ry = topY;
        const sp = env.curSpeed || (env.cfg && env.cfg.speed) || 200;
        const xf = this.fallX(ob, env);
        if (!ob.warnOn && ob.x <= xf + sp * ob.warn) ob.warnOn = true;
        if (ob.warnOn) ob.tw = (ob.tw || 0) + dt;
        if (ob.x <= xf) { ob.state = "fall"; ob.vy = 60; }
      } else if (ob.state === "fall") {
        ob.vy += 1500 * 1.7 * dt;
        ob.ry += ob.vy * dt;
        const floor = Math.min(ob.gapY + ob.gap / 2, gy) - 4;
        if (ob.ry >= floor) { ob.ry = floor; ob.state = "rest"; ob.tRest = 0; }
      } else if (ob.state === "rest") {
        ob.tRest += dt;
        if (ob.tRest > 0.45) ob.state = "gone";
      }
    },
    rockRect(ob) {
      return { x: ob.x + (ob.w - ob.rockW) / 2, y: ob.ry, w: ob.rockW, h: ob.rockH };
    },
    collide(ob, bx, by, br) {
      // grinden kräver ALLTID passage (även under varning/före fallet);
      // stenen träffar bara när den faller/vilar.
      if (corridorHit(ob, bx, by, br)) return true;
      if (ob.state === "warn" || ob.state === "gone") return false;
      const r = this.rockRect(ob);
      const cx = clamp(bx, r.x + 3, r.x + r.w - 3), cy = clamp(by, r.y + 3, r.y + r.h - 3);
      const dx = bx - cx, dy = by - cy;
      return dx * dx + dy * dy < (br - 2) * (br - 2);
    },
    draw(c, ob, S) {
      window.FX.drawGate(c, ob, S);
      const r = this.rockRect(ob);
      if (ob.state === "warn" && ob.warnOn !== false && ob.x + ob.w * 0.5 > S.W - 4) {
        // A6: kantmarkör medan kolumnen fortfarande är utanför bild (pulserande ⚠ vid högerkanten)
        const my = ob.gapY - ob.gap / 2 - 26;
        c.save();
        c.globalAlpha = 0.65 + 0.3 * Math.sin(S.time * 14);
        c.fillStyle = "#ffcf3f"; c.strokeStyle = "#2b2118"; c.lineWidth = 2.5;
        c.beginPath(); c.moveTo(S.W - 30, my + 12); c.lineTo(S.W - 8, my + 12); c.lineTo(S.W - 19, my - 8); c.closePath();
        c.fill(); c.stroke();
        c.fillStyle = "#2b2118"; c.fillRect(S.W - 20, my - 2, 2.4, 7); c.fillRect(S.W - 20, my + 7, 2.4, 2.4);
        c.restore();
      }
      if (ob.state === "warn" && ob.warnOn !== false) {
        // spöksten i taket + streckad fallkolumn så spelaren ser VAR den faller
        const jx = Math.sin(S.time * 40) * 2;
        c.save();
        c.globalAlpha = 0.55;
        drawRockShape(c, r.x + jx, r.y, r.w, r.h, S);
        c.restore();
        c.save();
        c.globalAlpha = 0.4 + 0.15 * Math.sin(S.time * 14);
        c.strokeStyle = "#ffcf3f"; c.lineWidth = 2.5;
        c.setLineDash([8, 8]);
        c.strokeRect(r.x - 5, 0, r.w + 10, ob.gapY + ob.gap / 2);
        c.setLineDash([]);
        // fallande pilar i kolumnen (visar riktning — pulserar nedåt)
        c.fillStyle = "#ffcf3f";
        const drop = (S.time * 90) % 44;
        for (let ay = 40 + drop; ay < ob.gapY + ob.gap / 2 - 10; ay += 44) {
          c.globalAlpha = 0.75;
          c.beginPath();
          c.moveTo(r.x + r.w / 2 - 8, ay); c.lineTo(r.x + r.w / 2 + 8, ay); c.lineTo(r.x + r.w / 2, ay + 9);
          c.closePath(); c.fill();
        }
        c.restore();
        // blinkande varningsskylt överst (alltid synlig)
        const blink = Math.sin(S.time * 14) > 0;
        c.save();
        c.globalAlpha = blink ? 1 : 0.35;
        c.fillStyle = "#ffcf3f";
        c.strokeStyle = "#2b2118"; c.lineWidth = 3;
        c.beginPath();
        const cx = ob.x + ob.w / 2, cy = Math.max(30, ob.gapY - ob.gap / 2 - 46);
        c.moveTo(cx, cy - 18); c.lineTo(cx + 18, cy + 12); c.lineTo(cx - 18, cy + 12);
        c.closePath(); c.fill(); c.stroke();
        c.fillStyle = "#2b2118";
        c.font = "900 20px sans-serif"; c.textAlign = "center";
        c.fillText("!", cx, cy + 8);
        c.restore();
      } else if (ob.state === "fall" || ob.state === "rest") {
        const fade = ob.state === "rest" ? clamp(1 - ob.tRest / 0.45, 0, 1) : 1;
        c.save(); c.globalAlpha = fade;
        drawRockShape(c, r.x, r.y, r.w, r.h, S);
        c.restore();
        if (ob.state === "fall") {
          c.save(); c.globalAlpha = 0.35; c.fillStyle = "#fff";
          c.fillRect(r.x + 6, r.y - 26, r.w - 12, 22);
          c.restore();
        }
      }
      // damm vid landning
      if (ob.state === "rest" && ob.tRest < 0.25) {
        c.save(); c.globalAlpha = 0.6 * (1 - ob.tRest / 0.25);
        c.fillStyle = "#cbb59a";
        c.beginPath(); c.ellipse(r.x + r.w / 2, r.y + r.h, 26, 8, 0, 0, TAU); c.fill();
        c.restore();
      }
    }
  },

  /* ---- 7. Laserbarriär (av → varning → på, periodiskt) ---- */
  laser: {
    name: NAMES.laser, intro: INTRO.laser, timing: true, w: 100,
    spawn(R, S, x, gapY) {
      const lv = difflv(S);
      const toff = Math.max(1.0, 1.9 - lv * 0.03);
      return { fam: "laser", x, w: 100, gapY, gap: Math.max(S.cfg.gap + 50, 210),
        passed: false, ph: R.range(0, TAU), t: R.range(0, 0.6),
        beamOff: gapY + R.range(-20, 20),
        toff, twin_warn: 0.5, ton: 1.25 };
    },
    update(ob, dt) { ob.t += dt; },
    phase(ob) {
      const cyc = ob.toff + ob.twin_warn + ob.ton;
      const tt = ((ob.t % cyc) + cyc) % cyc;
      if (tt < ob.toff) return "off";
      if (tt < ob.toff + ob.twin_warn) return "warn";
      return "on";
    },
    collide(ob, bx, by, br) {
      if (corridorHit(ob, bx, by, br)) return true; // grinden kräver passage
      if (this.phase(ob) !== "on") return false;
      if (bx + br <= ob.x - 2 || bx - br >= ob.x + ob.w + 2) return false;
      return Math.abs(by - ob.beamOff) < br + 5;
    },
    draw(c, ob, S) {
      window.FX.drawGate(c, ob, S);
      const top = ob.gapY - ob.gap / 2, bot = ob.gapY + ob.gap / 2;
      const ph = this.phase(ob);
      const lensCol = ph === "on" ? "#ff5b5b" : ph === "warn" ? "#ffb830" : "#7a8a9a";
      // sändarhus (metall + lins som visar tillstånd)
      for (const [hx, hy] of [[ob.x - 8, top - 30], [ob.x + ob.w - 6, top - 30], [ob.x - 8, bot], [ob.x + ob.w - 6, bot]]) {
        const g = c.createLinearGradient(hx, 0, hx + 14, 0);
        g.addColorStop(0, "#3d4c5c"); g.addColorStop(0.5, "#8a99aa"); g.addColorStop(1, "#2b3540");
        c.fillStyle = g;
        c.fillRect(hx, hy, 14, 30);
        c.fillStyle = "#2b2118";
        c.fillRect(hx, hy, 14, 3); c.fillRect(hx, hy + 27, 14, 3);
        c.fillStyle = lensCol;
        c.beginPath(); c.arc(hx + 7, hy + 15, 4, 0, TAU); c.fill();
        c.fillStyle = "rgba(255,255,255,0.7)";
        c.beginPath(); c.arc(hx + 6, hy + 14, 1.4, 0, TAU); c.fill();
      }
      // svaga ledskenor genom hela öppningen (läsbarhet)
      c.save();
      c.globalAlpha = 0.22;
      c.fillStyle = "#2b2118";
      c.fillRect(ob.x - 5, top, 8, bot - top);
      c.fillRect(ob.x + ob.w - 3, top, 8, bot - top);
      c.restore();
      const blink = ph === "warn" ? (Math.sin(S.time * 18) > 0) : true;
      // stråle
      c.save();
      if (ph === "off") {
        c.globalAlpha = 0.25; c.fillStyle = "#ff6b6b";
        for (let dx = ob.x; dx < ob.x + ob.w; dx += 14) {
          c.beginPath(); c.arc(dx, ob.beamOff, 2, 0, TAU); c.fill();
        }
      } else if (ph === "warn") {
        c.globalAlpha = blink ? 0.8 : 0.2;
        c.fillStyle = "#ffb830";
        c.fillRect(ob.x, ob.beamOff - 4, ob.w, 8);
        // ⚡-glyf: formkodad varning (inte bara färg/blink)
        c.globalAlpha = blink ? 1 : 0.3;
        c.fillStyle = "#2b2118";
        c.font = "bold 17px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText("⚡", ob.x + ob.w / 2, ob.beamOff - 16);
        // varningspilar längs strålen (pulserar inåt mot mitten)
        c.fillStyle = "#fff";
        const slide = (S.time * 60) % 24;
        for (let dx = ob.x + 8 + slide; dx < ob.x + ob.w - 8; dx += 24) {
          c.beginPath();
          c.moveTo(dx - 5, ob.beamOff - 5); c.lineTo(dx + 3, ob.beamOff); c.lineTo(dx - 5, ob.beamOff + 5);
          c.lineTo(dx - 2, ob.beamOff);
          c.closePath(); c.fill();
        }
      } else {
        // A9: skiktad glöd i stället för shadowBlur (blur är dyrt vid mjukvaru-rastrering/svaga GPU:er)
        c.fillStyle = "rgba(255,59,59,0.18)"; c.fillRect(ob.x, ob.beamOff - 16, ob.w, 32);
        c.fillStyle = "rgba(255,59,59,0.32)"; c.fillRect(ob.x, ob.beamOff - 10, ob.w, 20);
        c.fillStyle = "#ff5b5b";
        c.fillRect(ob.x, ob.beamOff - 6, ob.w, 12);
        c.fillStyle = "#fff";
        c.fillRect(ob.x, ob.beamOff - 2, ob.w, 4);
        // diagonala ränder: mönsterkodad fara (läsbar även utan färgseende)
        c.save();
        c.beginPath(); c.rect(ob.x, ob.beamOff - 6, ob.w, 12); c.clip();
        c.strokeStyle = "rgba(43,33,24,0.55)"; c.lineWidth = 4;
        for (let dx = -12; dx < ob.w + 12; dx += 12) {
          c.beginPath();
          c.moveTo(ob.x + dx, ob.beamOff + 8); c.lineTo(ob.x + dx + 9, ob.beamOff - 8);
          c.stroke();
        }
        c.restore();
      }
      c.restore();
    }
  },

  /* ---- 8. Rotorsåg (roterande klinga som åker vertikalt) ---- */
  blade: {
    name: NAMES.blade, intro: INTRO.blade, timing: true, w: 90,
    spawn(R, S, x, gapY) {
      const lv = difflv(S);
      const gap = Math.max(S.cfg.gap + 80, 245);
      return { fam: "blade", x, w: 90, gapY, gap,
        passed: false, ph: R.range(0, TAU), t: 0,
        bladeR: 18, amp: Math.min(gap / 2 - 36, 55 + lv * 2),
        period: Math.max(1.9, 2.9 - lv * 0.03), spin: 0 };
    },
    update(ob, dt) {
      ob.t += dt;
      ob.spin += dt * 11;
      ob.by = ob.gapY + Math.sin((ob.t / ob.period) * TAU + ob.ph) * ob.amp;
    },
    collide(ob, bx, by, br) {
      if (corridorHit(ob, bx, by, br)) return true; // grinden kräver passage
      const cx = ob.x + ob.w / 2, cy = ob.by == null ? ob.gapY : ob.by;
      const dx = bx - cx, dy = by - cy;
      return dx * dx + dy * dy < (br + ob.bladeR - 3) * (br + ob.bladeR - 3);
    },
    draw(c, ob, S) {
      window.FX.drawGate(c, ob, S);
      const cx = ob.x + ob.w / 2, cy = ob.by == null ? ob.gapY : ob.by;
      // skena (metall + ändstopp)
      c.save();
      const rg = c.createLinearGradient(cx - 4, 0, cx + 4, 0);
      rg.addColorStop(0, "#3d4c5c"); rg.addColorStop(0.5, "#aebfd0"); rg.addColorStop(1, "#3d4c5c");
      c.fillStyle = rg;
      c.fillRect(cx - 4, ob.gapY - ob.gap / 2, 8, ob.gap);
      c.fillStyle = "#2b2118";
      c.fillRect(cx - 7, ob.gapY - ob.gap / 2 - 4, 14, 6);
      c.fillRect(cx - 7, ob.gapY + ob.gap / 2 - 2, 14, 6);
      c.restore();
      // klinga (rörelseoskärpa + metall + nav)
      c.save();
      c.translate(cx, cy);
      c.globalAlpha = 0.25;
      c.fillStyle = "#cfd9e2";
      c.beginPath(); c.arc(0, 0, ob.bladeR + 4, ob.spin - 1.1, ob.spin - 0.2); c.lineTo(0, 0); c.closePath(); c.fill();
      c.globalAlpha = 1;
      c.rotate(ob.spin);
      const g = c.createRadialGradient(-4, -4, 2, 0, 0, ob.bladeR + 4);
      g.addColorStop(0, "#ffffff"); g.addColorStop(0.5, "#9fb2c4"); g.addColorStop(0.85, "#6b7d90"); g.addColorStop(1, "#4a5a6a");
      c.fillStyle = g;
      c.beginPath();
      const teeth = 9;
      for (let i = 0; i <= teeth * 2; i++) {
        const a = (i / (teeth * 2)) * TAU;
        const r = i % 2 === 0 ? ob.bladeR + 4 : ob.bladeR - 3;
        i === 0 ? c.moveTo(Math.cos(a) * r, Math.sin(a) * r) : c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath(); c.fill();
      c.strokeStyle = "#2b2118"; c.lineWidth = 2.5; c.stroke();
      c.fillStyle = "#e23b3b";
      c.beginPath(); c.arc(0, 0, 5, 0, TAU); c.fill();
      c.strokeStyle = "#7a1d1d"; c.lineWidth = 2; c.stroke();
      c.restore();
      // varningsram med glöd (rundad, mjuk)
      c.save();
      c.globalAlpha = 0.3 + 0.2 * Math.sin(S.time * 6 + ob.ph);
      c.strokeStyle = "#ff6b6b"; c.lineWidth = 6; c.lineCap = "round";
      c.beginPath();
      if (c.roundRect) c.roundRect(ob.x - 3, ob.gapY - ob.gap / 2, ob.w + 6, ob.gap, 10);
      else c.rect(ob.x - 3, ob.gapY - ob.gap / 2, ob.w + 6, ob.gap);
      c.stroke();
      c.globalAlpha = 0.8;
      c.strokeStyle = "#ffd0d0"; c.lineWidth = 2;
      c.stroke();
      c.restore();
    }
  }
};

function drawRockShape(c, x, y, w, h, S) {
  c.fillStyle = "#8a7a68";
  c.strokeStyle = "#2b2118"; c.lineWidth = 2.5;
  c.beginPath();
  c.moveTo(x + 3, y + h); c.lineTo(x, y + 12); c.lineTo(x + 10, y + 2);
  c.lineTo(x + 26, y); c.lineTo(x + w, y + 8); c.lineTo(x + w - 3, y + h);
  c.closePath(); c.fill(); c.stroke();
  // ljusfasett upptill
  c.fillStyle = "rgba(255,255,255,0.25)";
  c.beginPath();
  c.moveTo(x + 10, y + 2); c.lineTo(x + 26, y); c.lineTo(x + 22, y + 14); c.lineTo(x + 12, y + 12);
  c.closePath(); c.fill();
  // sprickor (struktur)
  c.strokeStyle = "rgba(43,33,24,0.55)"; c.lineWidth = 1.6;
  c.beginPath();
  c.moveTo(x + 12, y + 16); c.lineTo(x + 20, y + 26); c.lineTo(x + 18, y + h - 4);
  c.moveTo(x + 28, y + 10); c.lineTo(x + 26, y + 24);
  c.stroke();
  // mossa på skuggsidan
  c.fillStyle = "rgba(90,140,60,0.5)";
  c.beginPath(); c.ellipse(x + 8, y + h - 6, 8, 3.5, 0.3, 0, TAU); c.fill();
}

/* ============================================================
   DIRECTOR — väljer familj, placerar, validerar (rättvisa).
   ============================================================ */
const Director = {
  MIN_REACT: 0.62,      // min sekunder mellan hinder (hastighet × tid)
  MIN_REACT_TIMING: 0.9,// extra andrum efter tajminghinder
  // A5: lodrät räckvidd. Med tätare hinder måste höjdskillnaden mellan två öppningar (inkl. glidande
  // öppningars utslag) gå att hinna med: CLIMB px/s ≈ stadig stigning vid ~5 tryck/s.
  CLIMB: 280,
  driftAmpCap(dtMin) { return Math.max(12, Math.round(this.CLIMB * dtMin * 0.25)); },

  // Övre gräns för avstånd (ren funktion). A5: används INTE längre som spawn-tröskel
  // (det gjorde banan 40–110 % glesare än konfigurerat); kvar för bakåtkompatibla verktyg.
  maxSpacing(cfg, speed) {
    const eff = Math.max(speed, cfg.speed * (1 + (cfg.ramp || 0)));
    return cfg.spacing + (cfg.spacingVar || 0) + 40 + eff * 0.9;
  },

  unlocked(level) {
    return Object.keys(INTRO).filter(id => level >= INTRO[id]);
  },

  // Nästa spawn-händelse. Returnerar lista (tvilling = två hinder).
  spawnNext(R, S) {
    const cfg = S.cfg;
    const last = S.pipes.length ? S.pipes[S.pipes.length - 1] : null;
    const lastX = last ? last.x : S.W + 100;
    const lastFam = S.spawnLastFam || null;
    const idx = S.spawnCount || 0;

    // 1) välj familj (tajming aldrig intill tajming)
    const dlv = difflv(S);
    let pool = this.weightsFor(dlv).filter(e => {
      if (!this.unlocked(dlv).includes(e.id)) return false;
      const mod = OBSTACLES[e.id];
      if (mod.timing && lastFam && OBSTACLES[lastFam] && OBSTACLES[lastFam].timing) return false;
      // Vävaren: aldrig tajminghinder intill (före eller efter) — andra kolumnen kräver full uppmärksamhet
      if (mod.timing && lastFam === "weave") return false;
      if (e.id === "weave" && lastFam && OBSTACLES[lastFam] && OBSTACLES[lastFam].timing) return false;
      return true;
    });
    if (!pool.length) pool = [{ id: "classic", w: 1 }];
    let fam = pickWeighted(R, pool);
    if (dlv === 1 || idx === 0) fam = "classic"; // rättvis start, alltid

    // 2) avstånd (reaktionstid i sekunder, aldrig under minimum)
    // Gate A: rampen ökar farten mitt i nivån — räkna med MAXIMAL
    // effektiv fart så reaktionstiden håller hela vägen till målet.
    const speed = cfg.speed * (1 + (cfg.ramp || 0));
    let spacing = cfg.spacing;
    if (cfg.spacingVar) spacing += R.range(-cfg.spacingVar, cfg.spacingVar);
    const minGap = (OBSTACLES[fam].timing || (lastFam && OBSTACLES[lastFam] && OBSTACLES[lastFam].timing))
      ? this.MIN_REACT_TIMING : this.MIN_REACT;
    spacing = Math.max(spacing, speed * minGap);
    if (fam === "wind" || fam === "laser") spacing += 40;

    const x = idx === 0 && !S.pipes.length
      ? S.W + 120
      : Math.max(lastX + spacing, S.W + 60);

    // 3) gapY-promenad (familjens mingap styr bandet).
    // A5: höjdskillnaden begränsas av tiden till hindret vid maxfart (räckvidd), minus glidande
    // öppningars utslag (förra + detta), så tätare banor aldrig kräver omöjliga klättringar.
    const dtMin = last ? (x - lastX) / speed : 2;
    const ampCap = this.driftAmpCap(dtMin);
    const prevAmp = last && last.fam === "drift" ? Math.min(last.amp || 0, ampCap) : 0;
    const thisAmp = fam === "drift" ? ampCap : 0;
    const jumpCap = Math.max(40, this.CLIMB * dtMin - prevAmp - thisAmp);
    const famMinGap = fam === "blade" ? 245 : fam === "pendulum" ? 235 :
      fam === "laser" ? 210 : fam === "rock" ? 190 : cfg.gap;
    const wres = walkGapY(R, S, S.prevGapY, famMinGap, jumpCap);

    // 4) bygg hindret + validera
    const mk = (fx, fy) => {
      const ob = OBSTACLES[fam].spawn(R, S, fx, fy);
      if (ob.fam === "drift" && ob.amp > ampCap) ob.amp = ampCap; // A5: utslag ≤ räckvidd/4
      return this.validate(ob, S);
    };
    if (fam === "weave") {
      const w = this.weavePair(R, S, x, wres, speed, jumpCap, dlv);
      if (w) { for (const ob of w) S.pipes.push(ob); S.prevGapY = w[1].gapY; S.spawnLastFam = fam; S.spawnCount = idx + 1; return w; }
      fam = "classic"; // banan för smal för en rättvis S ⇒ en vanlig port på samma plats
    }
    const out = [mk(x, wres.y)];
    S.prevGapY = wres.y;

    // 5) tvillingformation (klassisk L2+): två snabba rör = 2 poäng.
    // Gate A: tvillingen valideras självständigt och får ett eget
    // minimiavstånd (effektiv fart × 0.55 s) så paret aldrig blir omöjligt.
    // A7 (P1-4): villkoret `dlv <= 10` gjorde cfg.twinCh för L11+ till död kod — nu styr cfg.twinCh.
    if (fam === "classic" && dlv >= 2 && R.chance(cfg.twinCh != null ? cfg.twinCh : 0.22)) {
      const twinDx = Math.max(150, Math.round(speed * 0.55));
      const y2 = clamp(wres.y + R.range(-70, 70), wres.lo, wres.hi);
      const ob2 = OBSTACLES.classic.spawn(R, S, x + twinDx, y2);
      ob2.twin = true;
      out.push(this.validate(ob2, S));
      S.prevGapY = ob2.gapY; // A7: nästa promenadsteg utgår från tvillingen (räckviddstaket gäller från den)
    }

    for (const ob of out) S.pipes.push(ob);
    S.spawnLastFam = fam;
    S.spawnCount = idx + 1;
    return out;
  },

  /* Vävaren-paret (E:s villkor):
     - x2 = x + max(150, maxfart × 0,55) (samma golv som tvillingar), maxfart = speed × (1 + ramp)
     - höjdskillnaden mellan öppningarnas mitt ≤ CLIMB × dt × 0,9 där dt = dx / maxfart
     - kolumn 1 nås från förra öppningen inom samma räckviddstak (jumpCap) som alla andra hinder
     - från L18 kortas förskjutningen (×0,75), gapet (cfg.gap + 24) rörs inte
     - båda kolumnerna valideras; andra kolumnen styr lastX/prevGapY. Returnerar null om ingen rättvis S ryms. */
  WEAVE_MIN_OFF: 48,
  weightsFor, // exponerad så att testverktyg kan bygga en "bara Vävaren"-bana i sidan (ingen prod-krok)
  weavePair(R, S, x, wres, speed, jumpCap, dlv) {
    const G = S.cfg.gap + 24;
    const dx = Math.max(150, Math.round(speed * 0.55));
    const capClimb = this.CLIMB * (dx / speed) * 0.9;
    const lo = 110 + G / 2, hi = S.H - S.groundH - 95 - G / 2;
    let off = Math.min(capClimb, hi - lo) * R.range(0.8, 1.0);
    if (dlv >= 18) off *= 0.75;
    // kolumn 1 = den lägre öppningen (dyk), kolumn 2 = den högre (klättra)
    let y1 = clamp(wres.y, lo + off, hi);
    if (S.prevGapY != null && y1 - S.prevGapY > jumpCap) { y1 = Math.max(lo, S.prevGapY + jumpCap); off = Math.min(off, y1 - lo); }
    if (off < this.WEAVE_MIN_OFF) return null;
    const a = this.validate(OBSTACLES.weave.spawn(R, S, x, y1, 1), S);
    const b = this.validate(OBSTACLES.weave.spawn(R, S, x + dx, a.gapY - off, 2), S);
    // efter validering: förskjutningen får aldrig växa över klättertaket
    if (a.gapY - b.gapY > capClimb) b.gapY = a.gapY - capClimb;
    a.pairDx = dx; a.pairY = b.gapY; b.pairDx = dx; b.pairY1 = a.gapY; // länk åt båda håll (ritning/test)
    return [a, b];
  },

  // Rättvisekontroll: kläm parametrar så passage alltid finns.
  validate(ob, S) {
    const speed = S.cfg.speed;
    const gy = S.H - S.groundH;
    if (ob.fam === "classic" || ob.fam === "drift") {
      ob.gap = S.cfg.gap;
    } else if (ob.fam === "weave") {
      ob.gap = S.cfg.gap + 24;
    } else if (ob.fam === "pulse") {
      if (ob.baseGap - ob.amp < 130) ob.amp = Math.max(0, ob.baseGap - 130);
    } else if (ob.fam === "wind") {
      const maxA = 0.45 * 1500;
      if (Math.abs(ob.accel) > maxA) ob.accel = Math.sign(ob.accel) * maxA;
    } else if (ob.fam === "pendulum") {
      ob.amp = Math.min(ob.amp, ob.L * 0.95);
      if (ob.period < 2.0) ob.period = 2.0;
      if (ob.gap < 225) ob.gap = 225;
    } else if (ob.fam === "rock") {
      if (ob.warn < 0.85) ob.warn = 0.85;
      if (ob.gap < 185) ob.gap = 185;
    } else if (ob.fam === "laser") {
      const need = (ob.w + 60) / speed + 0.45;
      if (ob.toff < need) ob.toff = need;
      if (ob.gap < 200) ob.gap = 200;
      ob.beamOff = clamp(ob.beamOff, ob.gapY - ob.gap / 2 + 40, ob.gapY + ob.gap / 2 - 40);
    } else if (ob.fam === "blade") {
      ob.amp = Math.min(ob.amp, ob.gap / 2 - 36);
      if (ob.period < 1.8) ob.period = 1.8;
      if (ob.gap < 235) ob.gap = 235;
    }
    // håll gapY inom banan
    const lo = 110 + ob.gap / 2, hi = gy - 95 - ob.gap / 2;
    if (lo <= hi) ob.gapY = clamp(ob.gapY, lo, hi);
    else { ob.gapY = (110 + gy - 95) / 2; }
    if (ob.baseY != null) ob.baseY = clamp(ob.baseY, lo, Math.max(lo, hi));
    return ob;
  },

  // Fristående sekvensgenerering för tester (rör inte live-state).
  genSequence(cfg, S_like, seed, n) {
    const R = {
      _f: mulberry32(seed >>> 0),
      next() { return this._f(); },
      range(a, b) { return a + this._f() * (b - a); },
      int(a, b) { return a + Math.floor(this._f() * (b - a + 1)); },
      pick(arr) { return arr[Math.floor(this._f() * arr.length) % arr.length]; },
      chance(p) { return this._f() < p; }
    };
    const fake = {
      cfg, level: cfg.level, H: S_like.H, groundH: S_like.groundH, W: S_like.W,
      pipes: [], prevGapY: null, spawnLastFam: null, spawnCount: 0
    };
    const seq = [];
    for (let i = 0; i < n; i++) {
      // tillfällig S-kopia: spawnNext läser S.pipes/S.prevGapY m.m.
      const made = this.spawnNext(R, fake);
      for (const ob of made) seq.push(JSON.parse(JSON.stringify(ob)));
      // avancera x som spelet skulle (för realistiska lastX)
      for (const ob of fake.pipes) ob._sx = 1;
    }
    // OBS: spawnNext använder S.W för första x — deterministiskt per seed. OK.
    return seq;
  },

  describe(level) {
    const now = Object.keys(INTRO).filter(id => INTRO[id] === level);
    if (!now.length) return null;
    const names = now.map(id => (window.I18N ? I18N.famName(id) : NAMES[id]));
    return window.I18N ? I18N.t("new_hazard", { names: names.join(", ") }) : ("Nytt hinder: " + names.join(", ") + "!");
  }
};

window.OBSTACLES = OBSTACLES;
window.Director = Director;
window.OBSTACLE_INTRO = INTRO;
window.OBSTACLE_NAMES = NAMES;
window.WEAVE_ON = WEAVE_ON;
})();
