/* ============================================================
   DIPWING — src/identity.js (Identity V1, spec id-0.1 2026-11-10)
   Brand, palette, Tornis renderer and the rounded gate language.
   PURELY VISUAL: nothing here touches physics, RNG, hitbox (r = 11)
   or the Sim hash. Everything is behind IDENTITY.V1:
     ?identity=0 in the URL (or localStorage pfb_identity_v1 = "0")
     restores the legacy bird (Sunny) and the legacy pipes.
   Working title "Dipwing" is NOT a registered trademark and has not
   been legally cleared (see docs/IDENTITY.md).
   ============================================================ */
(function () {
"use strict";
const TAU = Math.PI * 2;

function flagOn() {
  try {
    const q = (typeof location !== "undefined" && location.search) || "";
    if (/[?&]identity=0(&|$)/.test(q)) return false;
    if (/[?&]identity=1(&|$)/.test(q)) return true;
    const v = window.SafeStorage ? SafeStorage.get("pfb_identity_v1") : null;
    if (v === "0") return false;
  } catch (e) {}
  return true;
}
const V1 = flagOn();

const BRAND = {
  name: "Dipwing", wordmark: "dipwing", mascot: "Tornis",
  tagline: { sv: "Tryck. Dyk. Glid.", en: "Tap. Dip. Glide." },
  workingNameNotice: { sv: "Arbetsnamn – ej registrerat varumärke", en: "Working title – not a registered trademark" }
};

const C = {
  ink: "#1A1433", inkSoft: "#5B4C7A", cream: "#FFF8EC", cream2: "#FFF0D6", line: "#E9E2D2",
  tornis: "#3B4CC0", tornisDeep: "#232B7A", coral: "#FF6B4A", coralTop: "#FF8466", coralBot: "#F0533A",
  amber: "#FFB830", mint: "#8DF2DC", dusk: "#7A3B8F", sun: "#FFE38A",
  ok: "#4CD07D", warn: "#FFC23D", danger: "#FF4D5E", info: "#4AA8FF"
};

/* Bird palettes: [body, bodyDark, wing, wingFar, belly, scarf, iris] (+ extra decoration) */
const BIRD_PAL = {
  tornis: ["#3B4CC0", "#232B7A", "#4F63E0", "#1C2266", "#FFF1DC", "#FF6B4A", "#FFB830"],
  glod:   ["#E8743B", "#9C3E1E", "#F59A4A", "#6E2A14", "#FFE7C7", "#2B2140", "#FFD45E"],
  lagoon: ["#2BB3A6", "#16706A", "#4FD1C5", "#0F4F4A", "#F0FFFA", "#FF8C69", "#FFB830"],
  ang:    ["#5DAA4A", "#2F6B2A", "#86CC5B", "#21481D", "#FFF6D8", "#F2D14B", "#FF9A3C"],
  frost:  ["#9CCBF2", "#4F7FB8", "#DDF1FF", "#3C628F", "#FFFFFF", "#7CFFB2", "#2E6BD6"],
  natt:   ["#1E2450", "#0C0F2B", "#2E3778", "#090B22", "#C9D2FF", "#FFE38A", "#FFE38A"],
  neon:   ["#1B1830", "#0A0914", "#FF3FA4", "#00C8E0", "#00F0FF", "#00F0FF", "#FF3FA4"],
  kosmos: ["#6A3FC4", "#2C1A55", "#B47FE8", "#3D1A75", "#FFE38A", "#FFE38A", "#7DF9FF"],
  /* prestige (achievement only, never for sale): Guld-Tornis */
  guld:   ["#F2C14E", "#A77A1C", "#FFE08A", "#7A5512", "#FFF6DC", "#3B4CC0", "#FF6B4A"],
  /* legacy Sunny as a Tornis colourway (only shown to players who already owned Sunny) */
  sunny:  ["#FFD45E", "#F59A2E", "#FFB830", "#C85A1A", "#FFF3D0", "#FF6B4A", "#5B3A1A"]
};
const DOTS = {
  natt: { col: "#FFE38A", pts: [[-8, -3], [0, -6], [-14, 1], [6, 3], [-22, -15], [-30, -20]] },
  kosmos: { col: "#FFFFFF", pts: [[-6, -2], [2, 2], [-12, -4], [-26, -19], [-18, -14], [8, -6]] }
};

/* World accents and gate palettes. Hazard warning colours (laser, rock, saw) are NOT themed. */
const WORLD_ID = {
  meadow: { accent: "#4CD07D", gate: "#C98A4B", band: "#6DBE45", lamp: "#8DF2DC" },
  tropic: { accent: "#FF8C69", gate: "#D9B65A", band: "#FF8C69", lamp: "#FFF3C4" },
  sunset: { accent: "#FFB830", gate: "#3A2140", band: "#FFB830", lamp: "#FFE38A" },
  "city-neon": { accent: "#00F0FF", gate: "#3A2140", band: "#00F0FF", lamp: "#FF3FA4" },
  winter: { accent: "#7CFFB2", gate: "#BFE6FF", band: "#FFFFFF", lamp: "#7CFFB2" },
  rimewake: { accent: "#3FD1B0", gate: "#7FA6BD", band: "#3FD1B0", lamp: "#E8FFF8" },
  magic: { accent: "#FFE38A", gate: "#2C1A55", band: "#B47FE8", lamp: "#FFE38A" }
};
function worldPal(S) {
  if (S && S.envId === "city-neon") return WORLD_ID["city-neon"];
  if (S && S.envId === "rimewake") return WORLD_ID.rimewake;
  return WORLD_ID[(S && S.worldKey) || "meadow"] || WORLD_ID.meadow;
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; } else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  return "#" + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

/* ---------- Tornis geometry (spec §3, local coords, facing right, origin = hitbox centre) ---------- */
const HAS_P2D = typeof Path2D !== "undefined";
const P = {};
function path(k, d) { if (!P[k] && HAS_P2D) P[k] = new Path2D(d); return P[k]; }
const D = {
  farWing: "M1,1 C-8,7 -20,13 -36,15 C-24,7 -12,2 -3,-2 Z",
  tail: "M-19,-1 L-37,-8 L-30,1 L-37,9 L-19,3 Z",
  body: "M24,1 C20,-8 6,-11 -6,-8 C-15,-6 -21,-2 -24,1 C-18,5 -6,9 8,8 C17,7 22,5 24,1 Z",
  throat: "M21,3 C15,7 5,8 -1,6.5 C7,5.5 14,3.5 19,1 Z",
  beak: "M23.5,-0.5 L29.5,1.6 L23.5,3.2 Z",
  nearWing: "M6,-3 C-2,-12 -18,-22 -43,-25 C-30,-17 -18,-9 -6,1 Z",
  wingLine: "M-4,-6 C-12,-12 -22,-17 -32,-20",
  brow: "M9.5,-6.4 Q14,-8.2 18.6,-5.6"
};
/* Render scale. Spec id-0.1 says 0.70; measured hitbox coverage at 0.70 left the lower half of the
   r = 11 circle visibly empty, so V1 uses 0.84 (see tests/suites/12-identity.mjs, coverage check). */
const RENDER_SCALE = 0.84;

/* Hats/accessories (anchor (14,-8) in local coords). Never extend far in the flight direction. */
const HATS = {
  goggles(c) {
    c.strokeStyle = "#8A5A2B"; c.lineWidth = 2.6; c.beginPath(); c.moveTo(6, -7); c.quadraticCurveTo(14, -11, 22, -6); c.stroke();
    c.fillStyle = "#8DF2DC"; c.strokeStyle = C.ink; c.lineWidth = 1.4; c.beginPath(); c.arc(12, -9, 3, 0, TAU); c.fill(); c.stroke();
  },
  straw(c) {
    c.fillStyle = "#F2D14B"; c.strokeStyle = C.ink; c.lineWidth = 1.5;
    c.beginPath(); c.ellipse(11, -9.5, 9, 2.4, -0.08, 0, TAU); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(6, -10); c.quadraticCurveTo(7, -16, 11, -16.5); c.quadraticCurveTo(15.5, -16, 16, -10.5); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = C.coral; c.fillRect(6.4, -12, 9.4, 1.8);
  },
  beanie(c) {
    c.fillStyle = "#4AA8FF"; c.strokeStyle = C.ink; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(5, -8); c.quadraticCurveTo(10, -18, 18, -8); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = "#FFFFFF"; c.beginPath(); c.arc(11, -15.5, 2.4, 0, TAU); c.fill(); c.stroke();
  },
  crown(c) { // prestige only (Endless 100) — sits on the head, no forward overhang
    c.fillStyle = "#F2C14E"; c.strokeStyle = C.ink; c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(6, -9); c.lineTo(6.5, -16); c.lineTo(9.5, -12.5); c.lineTo(12, -17.5); c.lineTo(14.5, -12.5); c.lineTo(17.5, -16); c.lineTo(17, -9); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = "#FF6B4A"; c.beginPath(); c.arc(12, -11, 1.3, 0, TAU); c.fill();
  },
  propeller(c) {
    c.fillStyle = "#FF6B4A"; c.strokeStyle = C.ink; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(6, -8); c.quadraticCurveTo(11, -15, 17, -8); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = "#FFB830"; c.fillRect(7, -9.5, 9, 1.6);
    c.beginPath(); c.ellipse(11.5, -15.5, 5, 1.2, 0, 0, TAU); c.fill(); c.stroke();
  }
};

/* opts: { pal:id|array, scarf:hex, hat:id, wingDeg, state:"fly"|"dead"|"happy", blink, scale, reduced } */
function drawTornis(c, opts) {
  const o = opts || {};
  const pal = Array.isArray(o.pal) ? o.pal : (BIRD_PAL[o.pal] || BIRD_PAL.tornis);
  const [body, dark, wing, far, belly, scarfDef, iris] = pal;
  const scarf = o.scarf || scarfDef;
  const s = (o.scale || 1) * RENDER_SCALE;
  c.save();
  c.scale(s, s);
  c.lineJoin = "round"; c.lineCap = "round";
  // scarf (behind body) — tail end waves (static when reduced motion)
  const wave = o.reduced ? 0 : Math.sin((o.t || 0) * 2.2 * TAU) * 3;
  const lift = Math.max(-4, Math.min(6, (o.vy || 0) / 120));
  const ex = -34, ey = -12 + wave + lift;
  c.beginPath(); c.moveTo(8, -4); c.bezierCurveTo(2, -9, -6, -5, -12, -9); c.bezierCurveTo(-20, -14, -26, -7 + wave * 0.5, ex, ey);
  c.strokeStyle = C.ink; c.lineWidth = 6.6; c.stroke();
  c.strokeStyle = scarf; c.lineWidth = 3.8; c.stroke();
  if (o.scarf2) { c.save(); c.setLineDash([3, 3.5]); c.strokeStyle = o.scarf2; c.lineWidth = 3.8; c.stroke(); c.restore(); } // striped / two-tone scarves
  const wd = (o.wingDeg || 0) * Math.PI / 180;
  // far wing (rotates around (4,-2))
  c.save(); c.translate(4, -2); c.rotate(-wd * 0.6); c.translate(-4, 2);
  c.fillStyle = far; c.strokeStyle = C.ink; c.lineWidth = 1.8;
  if (HAS_P2D) { c.fill(path("farWing", D.farWing)); c.stroke(P.farWing); }
  c.restore();
  // tail
  c.fillStyle = dark; c.lineWidth = 1.8;
  if (HAS_P2D) { c.fill(path("tail", D.tail)); c.stroke(P.tail); }
  // body
  const bg = c.createLinearGradient(0, -10, 0, 10); bg.addColorStop(0, body); bg.addColorStop(1, dark);
  c.fillStyle = bg; c.lineWidth = 2;
  if (HAS_P2D) { c.fill(path("body", D.body)); c.stroke(P.body); }
  else { c.beginPath(); c.ellipse(0, 0, 24, 9, 0, 0, TAU); c.fill(); c.stroke(); }
  c.fillStyle = belly; if (HAS_P2D) c.fill(path("throat", D.throat));
  // beak
  c.fillStyle = "#3A2E4F"; c.lineWidth = 1.2; if (HAS_P2D) { c.fill(path("beak", D.beak)); c.stroke(P.beak); }
  // eye
  if (o.state === "dead") {
    c.strokeStyle = C.ink; c.lineWidth = 1.8; c.beginPath();
    c.moveTo(11.5, -5); c.lineTo(16.5, 0.5); c.moveTo(16.5, -5); c.lineTo(11.5, 0.5); c.stroke();
  } else {
    c.fillStyle = "#FFFFFF"; c.strokeStyle = C.ink; c.lineWidth = 1.4;
    const ry = o.blink ? 0.6 : 3.3;
    c.beginPath(); c.ellipse(14, -2, 4.2, ry, 0, 0, TAU); c.fill(); c.stroke();
    if (!o.blink) {
      c.fillStyle = iris; c.beginPath(); c.arc(15.2, -1.8, 2.3, 0, TAU); c.fill();
      c.fillStyle = C.ink; c.beginPath(); c.arc(15.6, -1.8, 1.15, 0, TAU); c.fill();
      c.fillStyle = "#FFFFFF"; c.beginPath(); c.arc(16.3, -2.7, 0.7, 0, TAU); c.fill();
    }
    c.save(); if (o.state === "happy") c.translate(0, -1.5);
    c.strokeStyle = C.ink; c.lineWidth = 1.7; if (HAS_P2D) c.stroke(path("brow", D.brow));
    c.restore();
  }
  // near wing
  c.save(); c.translate(4, -2); c.rotate(wd); c.translate(-4, 2);
  const wg = c.createLinearGradient(0, -24, -30, 0); wg.addColorStop(0, wing); wg.addColorStop(1, body);
  c.fillStyle = wg; c.strokeStyle = C.ink; c.lineWidth = 2;
  if (HAS_P2D) { c.fill(path("nearWing", D.nearWing)); c.stroke(P.nearWing); }
  c.globalAlpha = 0.45; c.lineWidth = 1.2; if (HAS_P2D) c.stroke(path("wingLine", D.wingLine));
  c.globalAlpha = 1;
  c.restore();
  const dots = DOTS[o.palId || o.pal];
  if (dots) { c.fillStyle = dots.col; for (const [a, b] of dots.pts) { c.beginPath(); c.arc(a, b, 0.9, 0, TAU); c.fill(); } }
  if ((o.palId || o.pal) === "neon") { c.strokeStyle = "#00F0FF"; c.lineWidth = 1; c.beginPath(); c.moveTo(24, 1); c.bezierCurveTo(20, -8, 6, -11, -6, -8); c.bezierCurveTo(-15, -6, -21, -2, -24, 1); c.stroke(); }
  if (o.hat && HATS[o.hat]) HATS[o.hat](c);
  c.restore();
}

/* Wing angle (degrees, negative = up) from flap time and vertical speed. Spec §3:
   flap 0 → −28° → 0 over 120 ms, dive (vy > 300) −8°, glide ±3° at 2.2 Hz. */
function wingAngle(sinceFlap, vy, t, reduced) {
  if (sinceFlap != null && sinceFlap >= 0 && sinceFlap < 0.12) {
    const k = sinceFlap / 0.12;
    return k < 0.5 ? -28 * (1 - (1 - 2 * k) * (1 - 2 * k)) : -28 * (1 - (2 * k - 1) * (2 * k - 1));
  }
  if (vy > 300) return 8; // swept back on a dive
  return reduced ? 0 : Math.sin(t * 2.2 * TAU) * 3;
}

/* ---------- gate language (spec §4): rounded pillars, end band, gap lantern ----------
   Geometry follows the HITBOX, not the spec's nominal 64 px: pillar = ob.w (78, the collision
   column incl. its 4 px forgiveness), band = ob.w + 12 like the legacy cap overhang. */
function rr(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function drawGatePair(c, ob, S) {
  const pal = worldPal(S);
  const gy = S.H - S.groundH;
  const w = ob.w || 78, x = ob.x;
  const top = ob.gapY - ob.gap / 2, bot = ob.gapY + ob.gap / 2;
  const BAND = 22, OV = 6;
  c.save();
  // soft drop shadow
  c.fillStyle = "rgba(26,20,51,0.16)";
  rr(c, x + 6, -30, w, top + 30, 18); c.fill();
  rr(c, x + 6, bot, w, gy - bot + 30, 18); c.fill();
  // pillars
  c.lineWidth = 3; c.strokeStyle = C.ink; c.lineJoin = "round";
  const g = c.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, shade(pal.gate, 0.12)); g.addColorStop(0.55, pal.gate); g.addColorStop(1, shade(pal.gate, -0.22));
  c.fillStyle = g;
  if (top > -20) { rr(c, x, -30, w, top + 30, 18); c.fill(); c.stroke(); }
  if (bot < gy + 20) { rr(c, x, bot, w, gy - bot + 40, 18); c.fill(); c.stroke(); }
  // gloss line (6 px white 25 %)
  c.strokeStyle = "rgba(255,255,255,0.25)"; c.lineWidth = 6; c.lineCap = "round";
  c.beginPath();
  if (top - 40 > 10) { c.moveTo(x + 13, 10); c.lineTo(x + 13, top - 40); }
  if (gy - 10 > bot + 40) { c.moveTo(x + w - 15, bot + 40); c.lineTo(x + w - 15, gy - 10); }
  c.stroke();
  // end bands at the gap
  c.fillStyle = pal.band; c.strokeStyle = C.ink; c.lineWidth = 3;
  if (top > 0) { rr(c, x - OV, top - BAND, w + OV * 2, BAND, 11); c.fill(); c.stroke(); }
  if (bot < gy) { rr(c, x - OV, bot, w + OV * 2, BAND, 11); c.fill(); c.stroke(); }
  c.fillStyle = "rgba(255,255,255,0.32)";
  if (top > 0) { rr(c, x - OV + 6, top - BAND + 3, w + OV * 2 - 12, 4, 2); c.fill(); }
  if (bot < gy) { rr(c, x - OV + 6, bot + 3, w + OV * 2 - 12, 4, 2); c.fill(); }
  // gap lanterns (show where the opening is) — layered glow, no shadowBlur
  const cx = x + w / 2;
  for (const ly of [top - BAND / 2, bot + BAND / 2]) {
    if (ly < 0 || ly > gy) continue;
    c.globalAlpha = 0.35; c.fillStyle = pal.lamp; c.beginPath(); c.arc(cx, ly, 8, 0, TAU); c.fill();
    c.globalAlpha = 1; c.beginPath(); c.arc(cx, ly, 4, 0, TAU); c.fill();
    c.strokeStyle = C.ink; c.lineWidth = 1.5; c.stroke();
  }
  c.restore();
}
/* Hazard-family rails (wind/pendulum/rock/laser/blade): same corridor as corridorHit. */
function drawGateRails(c, ob, S) {
  const pal = worldPal(S);
  const gy = S.H - S.groundH;
  const top = ob.gapY - ob.gap / 2, bot = ob.gapY + ob.gap / 2;
  c.save();
  c.strokeStyle = C.ink; c.lineWidth = 2;
  for (const rx of [ob.x + 1, ob.x + ob.w - 9]) {
    c.fillStyle = pal.gate;
    if (top > 0) { rr(c, rx, -10, 8, top + 10, 4); c.fill(); c.stroke(); }
    if (bot < gy) { rr(c, rx, bot, 8, gy - bot + 10, 4); c.fill(); c.stroke(); }
    c.fillStyle = pal.band;
    if (top > 0) { rr(c, rx - 2, top - 8, 12, 8, 4); c.fill(); c.stroke(); }
    if (bot < gy) { rr(c, rx - 2, bot, 12, 8, 4); c.fill(); c.stroke(); }
  }
  c.restore();
}

/* Idé 4 – Vävaren: korall S-ledlinje (ink-kontur) mellan kolumn 1:s och kolumn 2:s öppning, plus en
   chevron per kolumn (▼ dyk / ▲ klättra). Linjen försvinner när kolumn 1 passerats. Reducerad rörelse:
   statisk streckning (ingen marsch). Ren rendering — påverkar aldrig hitbox eller Sim-hash. */
function drawWeaveMark(c, ob, S) {
  const w = ob.w || 78, cx = ob.x + w / 2;
  let rm = false; try { rm = !!(window.DW_reducedMotion && window.DW_reducedMotion()); } catch (e) {}
  c.save();
  // drawn with column 2 (painted after column 1) so neither pillar hides the line; gone once column 1 is behind the bird
  if (ob.role === 2 && ob.pairDx && S.bird && S.bird.x - 12 < ob.x - ob.pairDx + w) {
    const x0 = cx - ob.pairDx, y0 = ob.pairY1, x1 = cx, y1 = ob.gapY, mx = (x0 + x1) / 2;
    const path = () => { c.beginPath(); c.moveTo(x0 - w * 0.9, y0 + 18); c.bezierCurveTo(x0 - w * 0.3, y0 + 18, x0, y0, mx, (y0 + y1) / 2);
      c.bezierCurveTo(x1, y1, x1 + w * 0.3, y1 - 18, x1 + w * 0.9, y1 - 18); };
    c.lineCap = "round"; c.setLineDash([10, 9]); c.lineDashOffset = rm ? 0 : -((S.time || 0) * 40 % 19);
    c.strokeStyle = C.ink; c.lineWidth = 7; c.globalAlpha = 0.55; path(); c.stroke();
    c.strokeStyle = C.coralTop; c.lineWidth = 4; c.globalAlpha = 0.95; path(); c.stroke();
    c.setLineDash([]);
  }
  // chevron inne i öppningen: kolumn 1 pekar ned (dyk), kolumn 2 upp (klättra)
  const dir = ob.role === 2 ? -1 : 1, y = ob.gapY + (rm ? 0 : Math.sin((S.time || 0) * 4) * 3) * dir;
  c.globalAlpha = 0.9; c.fillStyle = C.coral; c.strokeStyle = C.ink; c.lineWidth = 2; c.lineJoin = "round";
  c.beginPath(); c.moveTo(cx - 10, y - 6 * dir); c.lineTo(cx + 10, y - 6 * dir); c.lineTo(cx, y + 7 * dir); c.closePath(); c.fill(); c.stroke();
  c.restore();
}

window.IDENTITY = { V1, drawWeaveMark, BRAND, C, BIRD_PAL, WORLD_ID, HATS, RENDER_SCALE, worldPal, shade,
  drawTornis, wingAngle, drawGatePair, drawGateRails, version: "id-0.1" };
window.IDENTITY_V1 = V1;
})();
