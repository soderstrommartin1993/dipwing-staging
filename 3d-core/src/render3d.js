/* ============================================================
   DIPWING — src/render3d.js  (3D PROTOTYPE renderer, branch feat/3d, NOT default)
   Lazy-loaded only when the 3D render path is selected (?render=3d or the 3D prototype build).
   Needs window.THREE_R3D (src/three-r3d.js, vendored three.js subset, MIT).

   CONTRACT (merge criterion): this file is a pure VIEW of the game state.
   - It never writes to S, never calls the game RNG, never touches storage, input or timing.
   - Physics, collisions and the Director stay 2D in the logical 480×800 field.
   - The gameplay layer is drawn with an OBLIQUE PARALLEL projection: the gameplay plane z = 0 maps 1:1 to the
     2D canvas transform, and every gate box is "silhouette-compensated" so its on-screen outline equals the 2D
     gate rectangle exactly (see placeExact). Depth shows as visible top and left faces, never as a shifted edge.
   - The world behind the gameplay plane is a separate PERSPECTIVE scene (real parallax, fog, light).
   ============================================================ */
(function () {
"use strict";
const T = window.THREE_R3D;
if (!T) { window.Render3D = { VERSION: "3d-proto.1", supported: () => false }; return; }
const VERSION = "3d-proto.1";
/* Oblique projection: a point dz towards the camera is drawn K·dz lower and KX·dz further right
   (we look slightly down on the gates and see their top and left faces). */
const K = 0.14, KX = 0.12;
const DC = 760;          // distance of the perspective background camera from the gameplay plane (px units)
const INK = 0x1A1433;

/* ---------- small deterministic generator for decor (NOT the game RNG) ---------- */
function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/* ---------- palettes per world key (2 layouts × 5 palettes) ---------- */
const PAL = {
  meadow: { layout: "meadow", tree: "round", sky: ["#4fa8f5", "#bfe6ff"], fog: "#c6e6ff", ground: "#6dbe45", dirt: "#8a5a2b",
    hill: ["#4fa64a", "#3f8f3f"], mount: "#7d95c8", snow: true, canopy: ["#3f8f2f", "#5cb845"], trunk: "#6b4423", cloud: "#ffffff",
    sun: "#fff2b0", sunPos: [0.78, 0.13], sunR: 300, light: "#fff4dc", hemi: ["#e4f3ff", "#5a8a3a"], stars: false },
  tropic: { layout: "meadow", tree: "round", sky: ["#38b6e8", "#ffe7b8"], fog: "#ffe2c4", ground: "#7ccf5a", dirt: "#c28a4a",
    hill: ["#3fae6a", "#2f9358"], mount: "#6aa3b8", snow: false, canopy: ["#2fa36b", "#57c27f"], trunk: "#7a5230", cloud: "#ffffff",
    sun: "#fff0a0", sunPos: [0.8, 0.12], sunR: 320, light: "#fff1d0", hemi: ["#fff3dc", "#4a8a4a"], stars: false },
  winter: { layout: "meadow", tree: "pine", sky: ["#7fb8ea", "#eaf6ff"], fog: "#e6f2ff", ground: "#f4fbff", dirt: "#9bb3c9",
    hill: ["#dbeaf5", "#c6dced"], mount: "#8aa6c8", snow: true, canopy: ["#2e7d4f", "#3f9a64"], trunk: "#6b4a33", cloud: "#ffffff",
    sun: "#ffffff", sunPos: [0.75, 0.14], sunR: 260, light: "#f2f8ff", hemi: ["#f4faff", "#9fb6cc"], stars: false },
  sunset: { layout: "dusk", tree: "round", sky: ["#2a1b4f", "#ff9a5a"], fog: "#b8667a", ground: "#4a3a5a", dirt: "#3a2a40",
    hill: ["#3d2b52", "#33244a"], mount: "#2e2448", snow: false, canopy: ["#2e1f38", "#3a2848"], trunk: "#24182c", cloud: "#ffc7a8",
    sun: "#ffb35a", sunPos: [0.7, 0.42], sunR: 520, light: "#ffcf9a", hemi: ["#ffb4a0", "#2a1f3a"], stars: true },
  magic: { layout: "dusk", tree: "pine", sky: ["#0b0f2e", "#3b2a6b"], fog: "#2a2458", ground: "#2c2350", dirt: "#1e1838",
    hill: ["#241c4e", "#1d1742"], mount: "#1c1840", snow: false, canopy: ["#3a2f7a", "#4b3c95"], trunk: "#241c4e", cloud: "#8f86c9",
    sun: "#e8f4ff", sunPos: [0.78, 0.15], sunR: 200, light: "#c9d6ff", hemi: ["#8f9cff", "#1a1438"], stars: true }
};
function palFor(worldKey) { return PAL[worldKey] || PAL.meadow; }

/* ---------- material cache (memory: one material per colour/kind, shared) ---------- */
const MATS = new Map();
function lam(hex, extra) {
  const k = "L" + hex + (extra ? JSON.stringify(extra) : "");
  let m = MATS.get(k);
  if (!m) { m = new T.MeshLambertMaterial(Object.assign({ color: new T.Color(hex) }, extra || {})); MATS.set(k, m); }
  return m;
}
let RAMP = null;
function toon(hex, extra) {
  const k = "T" + hex + (extra ? JSON.stringify(extra) : "");
  let m = MATS.get(k);
  if (!m) {
    if (!RAMP) { RAMP = new T.DataTexture(new Uint8Array([89, 176, 255]), 3, 1, T.RedFormat); RAMP.minFilter = RAMP.magFilter = T.NearestFilter; RAMP.generateMipmaps = false; RAMP.needsUpdate = true; }
    m = new T.MeshToonMaterial(Object.assign({ color: new T.Color(hex), gradientMap: RAMP }, extra || {})); MATS.set(k, m);
  }
  return m;
}
function basic(hex, extra) {
  const k = "B" + hex + (extra ? JSON.stringify(extra) : "");
  let m = MATS.get(k);
  if (!m) { m = new T.MeshBasicMaterial(Object.assign({ color: new T.Color(hex) }, extra || {})); MATS.set(k, m); }
  return m;
}
const GEO = {
  box: new T.BoxGeometry(1, 1, 1),
  sph: new T.SphereGeometry(1, 14, 10),
  sphLo: new T.SphereGeometry(1, 8, 6),
  ico: new T.IcosahedronGeometry(1, 1),
  cone4: new T.ConeGeometry(1, 1, 4),
  cone5: new T.ConeGeometry(1, 1, 5),
  cone8: new T.ConeGeometry(1, 1, 8),
  cyl6: new T.CylinderGeometry(1, 1, 1, 6),
  cyl10: new T.CylinderGeometry(1, 1, 1, 10)
};

/* ============================================================
   BIRD RIG — Tornis is the reference model; every bird uses the same rig and the same sockets.
   Units = game px, origin = hitbox centre (r = 11 circle), facing +x, y up (three convention).
   Proportions follow the Visual Director's DESIGN_SYSTEM.md §4.1/§5.2 body plan (1 r = hitbox radius 11 px):
   body ellipsoid 1.35×1.00×0.95 r at (−0.10, 0), head r 0.78 at (1.00, 0.38), beak tip 2.35 r (25.9 px ≤ 27 px rule),
   wing span 2.5 r from the shoulder (0.15, 0.55, ±0.52), forked tail 1.75 r at (−1.28, 0.05). Toon ramp 35/69/100 %.
   SOCKETS (Object3D anchors, equipment attaches as children; moving with the animated parts):
     head (top of head) · eyes (front of eyes, for goggles/glasses) · neck (scarf ring)
     wingL / wingR (on the wing surfaces, animate with the flap) · back (between wings) · tail (tail base)
   ============================================================ */
const r_ = 11;
const BIRD_SPEC_DEFAULT = { bodyLen: 1.35 * r_, bodyH: 1.0 * r_, bodyW: 0.95 * r_, headR: 0.78 * r_, beakLen: 0.62 * r_, wingSpan: 2.5 * r_, tailLen: 1.75 * r_, headY: 0 };
const BIRD_SPECS = { // per-bird proportions (only colours differ today; the hook exists for unique silhouettes later)
  // DESIGN_SYSTEM §5.2 reference plans for Glöd (round robin) and Frost (slim tern); the rest share the Tornis plan for now
  tornis: {}, glod: { bodyLen: 1.25 * r_, bodyH: 1.10 * r_, bodyW: 1.05 * r_, headR: 0.86 * r_, wingSpan: 2.1 * r_, tailLen: 0.95 * r_, headY: 0.04 * r_ },
  frost: { bodyLen: 1.45 * r_, bodyH: 0.88 * r_, bodyW: 0.85 * r_, headR: 0.68 * r_, wingSpan: 3.0 * r_, tailLen: 2.0 * r_ },
  guld: {}, natt: {}, lagoon: {}, ang: {}, neon: {}, kosmos: {}, sunny: {}
};
/* Flat slab between two edge polylines (same length): quads lead[i],lead[i+1],trail[i+1],trail[i] on both faces
   plus side walls. Replaces ExtrudeGeometry/Shape (saves ≈9 KB gz of the vendored bundle). x,y in the shape plane,
   thickness along z (centred). */
function slab(lead, trail, depth) {
  const pos = [], h = depth / 2;
  const tri = (a, c, b) => pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); // (args listed clockwise; pushed CCW = outward)
  const P = (p, z) => [p[0], p[1], z];
  for (let i = 0; i < lead.length - 1; i++) {
    const a = lead[i], b = lead[i + 1], c = trail[i + 1], d = trail[i];
    tri(P(a, h), P(d, h), P(b, h)); tri(P(b, h), P(d, h), P(c, h));          // front
    tri(P(a, -h), P(b, -h), P(d, -h)); tri(P(b, -h), P(c, -h), P(d, -h));    // back
    for (const [u, v] of [[a, b], [c, d]]) { tri(P(u, h), P(v, h), P(v, -h)); tri(P(u, h), P(v, -h), P(u, -h)); } // walls
  }
  for (const [u, v] of [[trail[0], lead[0]], [lead[lead.length - 1], trail[trail.length - 1]]]) { tri(P(u, h), P(v, h), P(v, -h)); tri(P(u, h), P(v, -h), P(u, -h)); }
  const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}
function bez(p0, p1, p2, p3, n) { const o = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t;
  o.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); } return o; }
/* wing outline from identity.js nearWing (leading edge shoulder→tip, trailing edge back to the shoulder), y = outward */
function wingGeo(span) {
  const s = span / 43, S2 = p => [p[0] * s, p[1] * s];
  const lead = bez([6, 0], [-2, 9], [-18, 19], [-43, 22], 8).map(S2);
  const trail = bez([-8, -1], [-18, 5], [-30, 13], [-43, 22], 8).map(S2);
  return slab(lead, trail, 1.4);
}
/* forked tail: two blades from the tail base */
function tailGeo(len) {
  const s = len / 18, a = slab([[0, 2.5 * s], [-18 * s, 8 * s]], [[0, 0], [-12 * s, 0]], 3), b = slab([[0, 0], [-12 * s, 0]], [[0, -2.5 * s], [-18 * s, -8 * s]], 3);
  const pa = a.getAttribute("position").array, pb = b.getAttribute("position").array, all = new Float32Array(pa.length + pb.length);
  all.set(pa); all.set(pb, pa.length); a.dispose(); b.dispose();
  const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(all, 3)); g.computeVertexNormals(); return g;
}
const GEO_CACHE = new Map();
function cachedGeo(key, make) { let g = GEO_CACHE.get(key); if (!g) { g = make(); GEO_CACHE.set(key, g); } return g; }

/* Equipment registry: id -> { slot, build(mats) -> Object3D }. Slots = socket names. Purely visual. */
const EQUIP = {
  /* hats (head socket) — mirror the 2D HATS in identity.js */
  straw: { slot: "head", build() { const g = new T.Group();
    const brim = new T.Mesh(GEO.cyl10, toon("#F2D14B")); brim.scale.set(8.5, 1.2, 8.5); g.add(brim);
    const crown = new T.Mesh(GEO.cyl10, toon("#F2D14B")); crown.scale.set(4.6, 5, 4.6); crown.position.y = 3; g.add(crown);
    const band = new T.Mesh(GEO.cyl10, toon("#FF6B4A")); band.scale.set(4.8, 1.6, 4.8); band.position.y = 1.6; g.add(band); return g; } },
  beanie: { slot: "head", build() { const g = new T.Group();
    const cap = new T.Mesh(GEO.sph, toon("#4AA8FF")); cap.scale.set(7, 6, 7); cap.position.y = 0.5; g.add(cap);
    const pom = new T.Mesh(GEO.sphLo, toon("#FFFFFF")); pom.scale.setScalar(2.4); pom.position.y = 7; g.add(pom); return g; } },
  crown: { slot: "head", build() { const g = new T.Group();
    const ring = new T.Mesh(GEO.cyl10, toon("#F2C14E", { emissive: new T.Color("#5a4210") })); ring.scale.set(5.6, 3, 5.6); ring.position.y = 1.5; g.add(ring);
    for (let i = 0; i < 5; i++) { const sp = new T.Mesh(GEO.cone4, toon("#F2C14E")); const a = i / 5 * Math.PI * 2;
      sp.scale.set(1.6, 4, 1.6); sp.position.set(Math.cos(a) * 4.6, 5, Math.sin(a) * 4.6); g.add(sp); }
    const gem = new T.Mesh(GEO.sphLo, basic("#FF6B4A")); gem.scale.setScalar(1.3); gem.position.set(5.2, 1.6, 0); g.add(gem); return g; } },
  propeller: { slot: "head", spin: true, build() { const g = new T.Group();
    const cap = new T.Mesh(GEO.sph, toon("#FF6B4A")); cap.scale.set(6.2, 4.4, 6.2); g.add(cap);
    const axle = new T.Mesh(GEO.cyl6, toon("#FFB830")); axle.scale.set(0.7, 4, 0.7); axle.position.y = 5; g.add(axle);
    const rotor = new T.Group(); rotor.name = "spin"; rotor.position.y = 7;
    const blade = new T.Mesh(GEO.box, toon("#FFB830")); blade.scale.set(11, 0.6, 2.2); rotor.add(blade); g.add(rotor); return g; } },
  /* eyes socket */
  goggles: { slot: "eyes", build() { const g = new T.Group();
    const strap = new T.Mesh(GEO.cyl10, toon("#8A5A2B")); strap.scale.set(7.4, 1.6, 7.4); strap.rotation.z = Math.PI / 2 - 0.25; strap.position.set(-4, 0, 0); g.add(strap);
    for (const z of [6.4, -6.4]) { const lens = new T.Mesh(GEO.cyl10, toon("#8DF2DC", { emissive: new T.Color("#1a5a50") }));
      lens.scale.set(2.8, 1.2, 2.8); lens.rotation.x = Math.PI / 2; lens.position.set(0, 0, z); g.add(lens); }
    return g; } }
};
/* scarves (neck socket) are parametric: colour (+ optional stripe colour) from the cosmetic definition */
function buildScarf(col, col2) {
  const g = new T.Group();
  const ring = new T.Mesh(GEO.cyl10, toon(col)); ring.scale.set(10.8, 3.6, 10.8); g.add(ring);
  if (col2) { const st = new T.Mesh(GEO.cyl10, toon(col2)); st.scale.set(11, 1.2, 11); g.add(st); }
  const tails = new T.Group(); tails.name = "scarfTails"; g.add(tails);
  for (let i = 0; i < 3; i++) { const seg = new T.Mesh(GEO.box, toon(i === 1 && col2 ? col2 : col)); seg.scale.set(7, 3.2, 1.6); seg.position.set(-5 - i * 6.5, -1 - i, 0); seg.userData.i = i; tails.add(seg); }
  return g;
}
/* trail cosmetic -> tail socket streamers (the 2D trail line is not drawn in 3D) */
function buildTrail(col, dots) {
  const g = new T.Group(); g.name = "trailStreamers";
  for (let i = 0; i < 2; i++) { const s = new T.Mesh(GEO.box, toon(col, { emissive: new T.Color(col).multiplyScalar(0.3) })); s.scale.set(12, 1.2, 1.2);
    s.position.set(-8, i ? -2 : 2, 0); s.userData.i = i; g.add(s); }
  if (dots) { const d = new T.Mesh(GEO.sphLo, basic(dots)); d.scale.setScalar(1.6); d.position.set(-15, 0, 0); g.add(d); }
  return g;
}

function makeBird(palArr, specId) {
  const sp = Object.assign({}, BIRD_SPEC_DEFAULT, BIRD_SPECS[specId] || {});
  const [body, dark, wing, far, belly, , iris] = palArr;
  const root = new T.Group(), rig = new T.Group(); root.add(rig);
  const outl = [], parts = {};
  const add = (parent, mesh, outline) => { parent.add(mesh); if (outline) outl.push(mesh); return mesh; };
  // body (ellipsoid) + cream belly + head + throat (DESIGN_SYSTEM §4.1)
  const bx = -0.1 * r_;
  parts.body = add(rig, new T.Mesh(GEO.sph, toon(body)), true); parts.body.scale.set(sp.bodyLen, sp.bodyH, sp.bodyW); parts.body.position.x = bx;
  const bel = add(rig, new T.Mesh(GEO.sph, toon(belly)), false); bel.scale.set(sp.bodyLen * 0.8, sp.bodyH * 0.74, sp.bodyW * 0.9); bel.position.set(bx + 0.15 * r_, -sp.bodyH * 0.3, 0.1 * r_);
  const head = new T.Group(); head.position.set(r_ * 1.0, r_ * 0.38 + sp.headY, 0); rig.add(head); parts.head = head;
  const hR = sp.headR, hs = hR / (0.78 * r_);
  const hm = add(head, new T.Mesh(GEO.sph, toon(body)), true); hm.scale.setScalar(hR);
  const cheek = add(head, new T.Mesh(GEO.sphLo, toon(belly)), false); cheek.scale.setScalar(hR * 0.62); cheek.position.set(0.33 * r_ * hs, -0.22 * r_ * hs, 0);
  const beak = add(head, new T.Mesh(GEO.cone5, toon("#FF8466")), false); beak.scale.set(0.21 * r_, sp.beakLen, 0.21 * r_); beak.rotation.z = -Math.PI / 2;
  beak.position.set(2.35 * r_ - r_ * 1.0 - sp.beakLen / 2, -0.04 * r_, 0); // tip at x = 2.35 r (25.9 px) for every plan
  // eyes (both sides; the near one is the one the camera sees): white Ø 0.53 r, iris 0.34, pupil 0.19, unlit glint upper-front
  const eyes = new T.Group(); head.add(eyes); parts.eyes = [];
  for (const zs of [1, -1]) {
    const e = new T.Group(); e.position.set(0.39 * r_ * hs, 0.17 * r_ * hs, zs * 0.53 * r_ * hs); eyes.add(e);
    const white = new T.Mesh(GEO.sphLo, basic("#FFFFFF")); white.scale.setScalar(0.265 * r_ * hs); e.add(white);
    const ir = new T.Mesh(GEO.sphLo, toon(iris)); ir.scale.setScalar(0.17 * r_ * hs); ir.position.set(0.09 * r_, 0, zs * 0.14 * r_ * hs); e.add(ir);
    const pu = new T.Mesh(GEO.sphLo, basic("#1A1433")); pu.scale.setScalar(0.095 * r_ * hs); pu.position.set(0.14 * r_, 0, zs * 0.22 * r_ * hs); e.add(pu);
    const gl = new T.Mesh(GEO.sphLo, basic("#FFFFFF")); gl.scale.setScalar(0.04 * r_); gl.position.set(0.18 * r_, 0.07 * r_, zs * 0.27 * r_ * hs); e.add(gl);
    const brow = new T.Mesh(GEO.box, basic("#1A1433")); brow.scale.set(0.42 * r_, 0.08 * r_, 0.1 * r_); brow.position.set(0.02 * r_, 0.31 * r_ * hs, zs * 0.06 * r_); brow.rotation.z = -0.15; e.add(brow);
    parts.eyes.push(e);
  }
  // wings: thin closed slab (custom geometry, no ExtrudeGeometry), pivot at the shoulder; elevation = rotation about the body axis (x)
  const wGeo = cachedGeo("wing" + sp.wingSpan, () => { const g = wingGeo(sp.wingSpan); g.rotateX(Math.PI / 2); return g; });
  const wings = [];
  for (const zs of [1, -1]) {
    const piv = new T.Group(); piv.position.set(0.15 * r_, 0.55 * r_, zs * 0.52 * r_ * (sp.bodyW / (0.95 * r_))); rig.add(piv);
    const wm = add(piv, new T.Mesh(wGeo, toon(zs > 0 ? wing : far, { side: T.DoubleSide })), true); wm.userData.flat = true;
    if (zs < 0) wm.scale.z = -1;
    wings.push(piv);
  }
  parts.wingL = wings[0]; parts.wingR = wings[1];
  // tail
  const tGeo = cachedGeo("tail" + sp.tailLen, () => { const g = tailGeo(sp.tailLen); g.rotateX(Math.PI / 2); return g; });
  const tail = new T.Group(); tail.position.set(bx - sp.bodyLen * 0.86, 0.05 * r_, 0); rig.add(tail); parts.tail = tail;
  add(tail, new T.Mesh(tGeo, toon(dark, { side: T.DoubleSide })), true).userData.flat = true;
  // sockets
  const sock = {};
  const mk = (name, parent, x, y, z) => { const o = new T.Object3D(); o.name = "socket:" + name; o.position.set(x, y, z); parent.add(o); sock[name] = o; return o; };
  mk("head", head, 0.05 * r_, hR - 0.6, 0);
  mk("eyes", head, 0.42 * r_ * hs, 0.17 * r_ * hs, 0);
  mk("neck", rig, 0.62 * r_, 0.12 * r_, 0).rotation.z = 0.45; // ring axis tilted ≈ 26°
  mk("back", rig, bx - 0.2 * r_, sp.bodyH - 0.5, 0);
  mk("tail", tail, -2, 0, 0);
  mk("wingL", wings[0], -14, 0, sp.wingSpan * 0.25);
  mk("wingR", wings[1], -14, 0, -sp.wingSpan * 0.25);
  // ink outline (inverted hull) – quality "high" only
  const hullMat = birdHullMat(); // own material: flips to cream on dark worlds (DESIGN_SYSTEM §6.4)
  const hulls = [];
  for (const m of outl) {
    const h = new T.Mesh(m.geometry, hullMat); h.scale.copy(m.scale).multiplyScalar(1.09); h.position.copy(m.position); h.rotation.copy(m.rotation);
    if (m.userData.flat) { h.scale.copy(m.scale).multiply(new T.Vector3(1.06, 2.4, 1.06)); } // thin slab: thicken the hull (geometry thickness is along local y)
    m.parent.add(h); hulls.push(h);
  }
  return { root, rig, parts, sockets: sock, hulls, equip: {}, spec: sp, palKey: palArr.join(",") };
}
/* DESIGN_SYSTEM §2 hitbox rules, measured on a bird in the gameplay pose through the oblique projection:
   coverage = share of the 1.1 px grid samples (309) inside the r = 11 hitbox circle whose view ray hits the body/head/belly/throat
   ellipsoids; beakTip = furthest on-screen x of the beak ahead of the hitbox centre (rule ≤ 27 px). */
function birdMetrics(palArr, specId) {
  const b = makeBird(palArr || ["#3B4CC0", "#232B7A", "#4F63E0", "#1C2266", "#FFF1DC", "#FF6B4A", "#FFB830"], specId || "tornis");
  b.rig.rotation.set(0.26, -0.32, 0); b.root.updateMatrixWorld(true);
  const solids = []; b.rig.traverse(n => { if (n.isMesh && n.geometry === GEO.sph || n.isMesh && n.geometry === GEO.sphLo && n.parent === b.parts.head) if (n.material.side !== T.BackSide) solids.push(n); });
  const inv = solids.map(m => new T.Matrix4().copy(m.matrixWorld).invert());
  const o = new T.Vector3(), d = new T.Vector3();
  let inside = 0, hit = 0;
  for (let i = -10; i <= 10; i++) for (let j = -10; j <= 10; j++) {
    const X = i * 1.1, Y = j * 1.1; if (X * X + Y * Y > 121) continue; inside++;
    for (const M of inv) {
      o.set(X, Y, 0).applyMatrix4(M); d.set(X - KX, Y + K, 1).applyMatrix4(M).sub(o); // view ray (−KX, K, 1) in unit-sphere space
      const a = d.dot(d), bb = 2 * o.dot(d), c = o.dot(o) - 1;
      if (bb * bb - 4 * a * c >= 0) { hit++; break; }
    }
  }
  let tip = -1e9; const v = new T.Vector3(), pos = GEO.cone5.getAttribute("position");
  const beak = b.parts.head.children.find(n => n.isMesh && n.geometry === GEO.cone5);
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(beak.matrixWorld); tip = Math.max(tip, v.x + KX * v.z); }
  disposeTree(b.root);
  return { coverage: hit / inside, samples: inside, beakTip: tip };
}
function birdHullMat() { return basic(INK, { side: T.BackSide, name: "birdHull" }); }
/* DESIGN_SYSTEM §4.4 wing cycle (render-only): angle in rad (+ = up) from the time since the last flap and vy */
const WING_KEYS = [[0, 0.55], [45, -0.15], [90, -0.95], [150, -0.35], [220, 0.35], [320, 0.18]];
function wingCycle(sinceMs, vy, t, rm) {
  if (sinceMs != null) sinceMs *= 0.75; // 6b: same calm factor as R3D_STUDIO FLIGHT_CALM.hz (fallback bird, visual only)
  if (vy > 300) return { a: -0.2, sweep: 0.9 * Math.min(1, (vy - 300) / 300) };
  if (sinceMs == null || sinceMs >= 320) return { a: 0.18 + (rm ? 0 : Math.sin(t * 0.35 * Math.PI * 2) * 0.04), sweep: 0 };
  for (let i = 0; i < WING_KEYS.length - 1; i++) {
    const [t0, a0] = WING_KEYS[i], [t1, a1] = WING_KEYS[i + 1];
    if (sinceMs <= t1) { const u = (sinceMs - t0) / (t1 - t0), e = u * u * (3 - 2 * u); return { a: a0 + (a1 - a0) * e, sweep: 0 }; }
  }
  return { a: 0.18, sweep: 0 };
}
function disposeTree(o) { o.traverse(n => { if (n.geometry && !Object.values(GEO).includes(n.geometry) && ![...GEO_CACHE.values()].includes(n.geometry)) n.geometry.dispose(); }); }
/* attach/replace equipment in a socket (visual only) */
function equip(bird, slot, key, build) {
  const cur = bird.equip[slot];
  if (cur && cur.key === key) return cur.obj;
  if (cur) { cur.obj.parent && cur.obj.parent.remove(cur.obj); disposeTree(cur.obj); }
  if (!key) { delete bird.equip[slot]; return null; }
  const obj = build(); bird.sockets[slot].add(obj); bird.equip[slot] = { key, obj };
  return obj;
}

/* ============================================================
   RENDERER
   ============================================================ */
const R = {
  VERSION, K, KX, ok: false, lost: false, quality: "high", canvas: null, gl: null,
  fg: null, bg: null, fgCam: null, bgCam: null, view: { viewW: 480, viewH: 800, offX: 0, camY: 0 },
  gates: [], gateMap: new WeakMap(), bird: null, ground: null, world: null, worldKey: null, boss: null,
  stats: { frames: 0, cpuMs: [] }, debug: { lastBounds: null }
};

function supported() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; }
}

function init(stage, opts) {
  opts = opts || {};
  R.quality = opts.quality === "low" ? "low" : "high";
  const cv = document.createElement("canvas");
  cv.id = "gl3d"; cv.setAttribute("aria-hidden", "true");
  cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;";
  const ref = document.getElementById("gameCanvas");
  stage.insertBefore(cv, ref || stage.firstChild);
  let gl;
  try {
    gl = new T.WebGLRenderer({ canvas: cv, antialias: R.quality === "high", alpha: false, powerPreference: "high-performance",
      preserveDrawingBuffer: !!opts.preserve, stencil: false });
  } catch (e) { cv.remove(); return false; }
  gl.autoClear = false;
  gl.toneMapping = T.NoToneMapping;
  gl.outputColorSpace = T.SRGBColorSpace;
  R.gl = gl; R.canvas = cv;
  cv.addEventListener("webglcontextlost", e => { e.preventDefault(); R.lost = true; R.ok = false; if (opts.onLost) try { opts.onLost(); } catch (er) {} }, false);
  // scenes
  R.fg = new T.Scene(); R.bg = new T.Scene();
  R.fgCam = new T.OrthographicCamera(0, 480, 0, -800, 1, 4000); R.fgCam.position.set(0, 0, 1000);
  R.bgCam = new T.PerspectiveCamera(55, 0.6, 20, 30000);
  // gameplay lights (sun from upper-left-front, matches the 2D light from the left)
  R.fgHemi = new T.HemisphereLight(0xffffff, 0x444444, 1.5); R.fg.add(R.fgHemi);
  R.fgSun = new T.DirectionalLight(0xffffff, 2.0); R.fgSun.position.set(-0.6, 1, 0.9); R.fg.add(R.fgSun);
  R.fgRim = new T.DirectionalLight(0xffffff, 1.4); R.fgRim.position.set(0.7, 0.4, -1); R.fg.add(R.fgRim);
  buildGround();
  R.bird = makeBird(window.IDENTITY ? IDENTITY.BIRD_PAL.tornis : ["#3B4CC0", "#232B7A", "#4F63E0", "#1C2266", "#FFF1DC", "#FF6B4A", "#FFB830"], "tornis");
  R.fg.add(R.bird.root);
  R.boss = makeBossScene(); R.fg.add(R.boss.group);
  R.featherFx = new T.Group(); R.featherFx.name = "feather-pickup-fx"; R.fg.add(R.featherFx);
  R.featherFxPool = [];
  // THREE_R3D has no Shape/ShapeGeometry/MeshStandardMaterial/Line/LineBasicMaterial (vendored subset).
  // Build the same quadratic silhouette with BufferGeometry + MeshBasicMaterial (Grok P1-0b fix).
  R.featherGeo = (() => {
    const q = (a, b, c, t) => { const u = 1 - t; return [u*u*a[0]+2*u*t*b[0]+t*t*c[0], u*u*a[1]+2*u*t*b[1]+t*t*c[1]]; };
    const ring = [];
    for (let i = 0; i <= 8; i++) ring.push(q([-1, 0], [-0.2, -0.62], [1, -0.08], i / 8));
    for (let i = 1; i <= 8; i++) ring.push(q([1, -0.08], [0.22, 0.58], [-1, 0], i / 8));
    const pos = [];
    for (let i = 1; i < ring.length - 1; i++) pos.push(ring[0][0], ring[0][1], 0, ring[i][0], ring[i][1], 0, ring[i + 1][0], ring[i + 1][1], 0);
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    return g;
  })();
  R.featherStemGeo = (() => {
    const w = 0.05, pos = [-0.92, w, 0.03, 0.94, w - 0.03, 0.03, 0.94, -w - 0.03, 0.03, -0.92, w, 0.03, 0.94, -w - 0.03, 0.03, -0.92, -w, 0.03];
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    return g;
  })();
  R.shadow = new T.Mesh(GEO.cyl10, basic("#1A1433", { transparent: true, opacity: 0.2, depthWrite: false })); R.fg.add(R.shadow);
  R.ok = true;
  setQuality(R.quality);
  return true;
}

function setQuality(q) {
  R.quality = q === "low" ? "low" : "high";
  if (!R.gl) return;
  const dpr = Math.min(window.devicePixelRatio || 1, R.quality === "high" ? 2 : 1);
  R.gl.setPixelRatio(dpr); R.dpr = dpr;
  if (R.cssW) R.gl.setSize(R.cssW, R.cssH, false);
  if (R.bird) for (const h of R.bird.hulls) h.visible = R.quality === "high";
  if (R.world) applyDecorDensity();
}

function resize(cssW, cssH, view) {
  R.cssW = cssW; R.cssH = cssH; Object.assign(R.view, view);
  if (R.gl) R.gl.setSize(cssW, cssH, false);
}

/* ---------- gameplay ground (top face starts exactly at the lethal line gy, z ∈ [0, 80]) ---------- */
function buildGround() {
  const g = new T.Group();
  const mats = [0, 1, 2, 3, 4, 5].map(i => i === 2 ? lam("#6dbe45") : lam("#8a5a2b"));
  const box = new T.Mesh(GEO.box, mats); g.add(box);
  const tufts = new T.InstancedMesh(GEO.cone4, lam("#3f8f2f"), 48); tufts.frustumCulled = false; g.add(tufts);
  const pebbles = new T.InstancedMesh(GEO.sphLo, lam("#000000", { transparent: true, opacity: 0.16 }), 24); pebbles.frustumCulled = false; g.add(pebbles);
  R.fg.add(g);
  R.ground = { g, box, mats, tufts, pebbles };
}
const _m = new T.Matrix4(), _q = new T.Quaternion(), _p = new T.Vector3(), _s = new T.Vector3(), _e = new T.Euler(), _c = new T.Color();
function updateGround(S, P) {
  const gr = R.ground, gy = S.H - S.groundH, v = R.view;
  const x0 = -v.offX - 60, x1 = S.W + v.offX + 60, yBot = S.camY + v.viewH + 60;
  gr.box.position.set((x0 + x1) / 2, -(gy + yBot) / 2, 40); gr.box.scale.set(x1 - x0, yBot - gy, 80);
  gr.mats[2].color.set(P.ground); for (const i of [0, 1, 3, 4, 5]) gr.mats[i].color.set(P.dirt);
  gr.tufts.material.color.set(P.hill[1]);
  const span = 560, n = gr.tufts.count;
  for (let i = 0; i < n; i++) {
    const bx = (i * 37.3) % span, x = ((bx - S.camX) % span + span) % span - 40;
    const z = 6 + ((i * 53) % 70), hgt = 7 + (i % 5) * 2;
    _p.set(x, -gy + hgt / 2, z); _q.identity(); _s.set(2.6, hgt, 2.6); _m.compose(_p, _q, _s); gr.tufts.setMatrixAt(i, _m);
  }
  gr.tufts.instanceMatrix.needsUpdate = true;
  for (let i = 0; i < gr.pebbles.count; i++) {
    const bx = (i * 61.7) % 600, x = ((bx - S.camX) % 600 + 600) % 600 - 60;
    _p.set(x, -gy - 30 - (i % 4) * 14, 81); _q.identity(); _s.set(6 - (i % 3), 3, 0.5); _m.compose(_p, _q, _s); gr.pebbles.setMatrixAt(i, _m);
  }
  gr.pebbles.instanceMatrix.needsUpdate = true;
}

/* ---------- background world (perspective scene) ---------- */
function gradTex(top, bot) {
  const c = document.createElement("canvas"); c.width = 2; c.height = 256;
  const x = c.getContext("2d"), g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top); g.addColorStop(1, bot); x.fillStyle = g; x.fillRect(0, 0, 2, 256);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
}
function glowTex() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,0.35)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
}
function buildWorld() {
  const bg = R.bg, rnd = lcg(0xD1F3), W = {};
  bg.fog = new T.Fog(0xffffff, 900, 11000);
  W.hemi = new T.HemisphereLight(0xffffff, 0x444444, 1.6); bg.add(W.hemi);
  W.sunL = new T.DirectionalLight(0xffffff, 1.8); W.sunL.position.set(0.5, 0.6, -0.4); bg.add(W.sunL);
  W.groundPlane = new T.Mesh(new T.PlaneGeometry(1, 1), lam("#6dbe45")); W.groundPlane.rotation.x = -Math.PI / 2; bg.add(W.groundPlane);
  W.sun = new T.Mesh(GEO.sph, basic("#ffffff", { fog: false })); bg.add(W.sun);
  W.glow = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: glowTex(), transparent: true, depthWrite: false, fog: false, blending: T.AdditiveBlending }));
  bg.add(W.glow);
  // star field (dusk layouts)
  const sp = new Float32Array(260 * 3);
  for (let i = 0; i < 260; i++) { sp[i * 3] = (rnd() - 0.5) * 22000; sp[i * 3 + 1] = rnd() * 9000 - 1500; sp[i * 3 + 2] = -14000; }
  const sg = new T.BufferGeometry(); sg.setAttribute("position", new T.BufferAttribute(sp, 3));
  W.stars = new T.Points(sg, new T.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
  bg.add(W.stars);
  // layers: items {d, x, y, sx, sy, sz, rot}
  const layer = (n, dMin, dMax, f) => { const a = []; for (let i = 0; i < n; i++) a.push(f(i, dMin + rnd() * (dMax - dMin))); return a; };
  W.mountItems = layer(16, 4200, 6800, (i, d) => ({ d, base: rnd() * 40000, h: 900 + rnd() * 900, r: 650 + rnd() * 500, rot: rnd() * 6 }));
  W.hillItems = layer(14, 1100, 2000, (i, d) => ({ d, base: rnd() * 40000, r: 260 + rnd() * 200, rot: rnd() * 6 }));
  W.treeItems = layer(28, 230, 820, (i, d) => ({ d, base: rnd() * 40000, s: 0.85 + rnd() * 0.5, ph: rnd() * 6 }));
  W.cloudItems = layer(11, 900, 3200, (i, d) => ({ d, base: rnd() * 40000, sy: 40 + rnd() * 230, s: 0.8 + rnd() * 0.8, v: 6 + rnd() * 10 }));
  const inst = (geo, mat, n) => { const m = new T.InstancedMesh(geo, mat, n); m.frustumCulled = false; bg.add(m); return m; };
  W.mount = inst(GEO.cone5, lam("#7d95c8", { flatShading: true }), W.mountItems.length);
  W.caps = inst(GEO.cone5, lam("#ffffff", { flatShading: true }), W.mountItems.length);
  W.hills = inst(GEO.ico, lam("#4fa64a", { flatShading: true }), W.hillItems.length);
  W.trunks = inst(GEO.cyl6, lam("#6b4423", { flatShading: true }), W.treeItems.length);
  W.canopy = inst(GEO.ico, lam("#3f8f2f", { flatShading: true }), W.treeItems.length);
  W.pine1 = inst(GEO.cone8, lam("#2e7d4f", { flatShading: true }), W.treeItems.length);
  W.pine2 = inst(GEO.cone8, lam("#3f9a64", { flatShading: true }), W.treeItems.length);
  W.clouds = inst(GEO.ico, lam("#ffffff", { flatShading: true, emissive: new T.Color("#555555") }), W.cloudItems.length * 4);
  R.world = W;
  applyDecorDensity();
}
function applyDecorDensity() {
  const W = R.world, lo = R.quality === "low";
  W.treeN = lo ? 16 : W.treeItems.length; W.cloudN = lo ? 6 : W.cloudItems.length; W.hillN = lo ? 9 : W.hillItems.length;
}
function setWorldPalette(key) {
  if (R.worldKey === key) return;
  R.worldKey = key; const P = palFor(key), W = R.world;
  if (R.bg.background && R.bg.background.dispose) R.bg.background.dispose();
  R.bg.background = gradTex(P.sky[0], P.sky[1]);
  R.bg.fog.color.set(P.fog);
  W.hemi.color.set(P.hemi[0]); W.hemi.groundColor.set(P.hemi[1]); W.sunL.color.set(P.light);
  R.fgHemi.color.set(P.hemi[0]); R.fgHemi.groundColor.set(P.hemi[1]); R.fgSun.color.set(P.light); R.fgRim.color.set(P.sun);
  R.fgRim.intensity = P.stars ? 2.2 : 1.2; birdHullMat().color.set(P.stars ? "#FFF8EC" : INK);
  W.groundPlane.material.color.set(P.ground);
  W.sun.material.color.set(P.sun); W.glow.material.color.set(P.sun);
  W.mount.material.color.set(P.mount); W.caps.visible = !!P.snow;
  W.hills.material.color.set(P.hill[0]);
  W.trunks.material.color.set(P.trunk); W.canopy.material.color.set(P.canopy[0]);
  W.pine1.material.color.set(P.canopy[0]); W.pine2.material.color.set(P.canopy[1]);
  W.clouds.material.color.set(P.cloud); W.clouds.material.emissive.set(P.cloud).multiplyScalar(0.35);
  W.stars.visible = !!P.stars;
  const round = P.tree === "round"; W.trunks.visible = W.canopy.visible = round; W.pine1.visible = W.pine2.visible = !round;
}
/* wrap an item so it stays within ±span/2 of the camera x at its depth (seamless infinite layer) */
function wrapX(base, camx, span) { return base + span * Math.round((camx - base) / span); }
function updateWorld(S, o) {
  const W = R.world, P = palFor(R.worldKey), v = R.view, gy = S.H - S.groundH, t = o.rm ? 0 : (S.time || 0);
  const camx = R.bgCam.position.x;
  const visW = d => v.viewW * (DC + d) / DC;
  W.groundPlane.position.set(camx, -gy, -7000); W.groundPlane.scale.set(60000, 14000, 1);
  // sun fixed on screen (very far away, moves with the camera)
  const sd = 9000, sx = camx + (P.sunPos[0] - 0.5) * visW(sd), syGame = S.camY + P.sunPos[1] * v.viewH;
  const sy3 = R.bgCam.position.y + (-syGame - R.bgCam.position.y) * (DC + sd) / DC;
  W.sun.position.set(sx, sy3, -sd); W.sun.scale.setScalar(P.sunR);
  W.glow.position.set(sx, sy3, -sd + 10); W.glow.scale.setScalar(P.sunR * 7);
  W.stars.position.set(camx, 0, 0);
  W.stars.material.opacity = o.rm ? 0.8 : 0.7 + 0.15 * Math.sin(t * 0.7);
  let i;
  for (i = 0; i < W.mountItems.length; i++) {
    const it = W.mountItems[i], sp = visW(it.d) + 2 * it.r + 600, x = wrapX(it.base, camx, sp);
    _p.set(x, -gy + it.h / 2 - 60, -it.d); _e.set(0, it.rot, 0); _q.setFromEuler(_e); _s.set(it.r, it.h, it.r); _m.compose(_p, _q, _s); W.mount.setMatrixAt(i, _m);
    _p.set(x, -gy - 60 + it.h * 0.86, -it.d + 1); _s.set(it.r * 0.29, it.h * 0.29, it.r * 0.29); _m.compose(_p, _q, _s); W.caps.setMatrixAt(i, _m);
  }
  W.mount.instanceMatrix.needsUpdate = true; W.caps.instanceMatrix.needsUpdate = true;
  for (i = 0; i < W.hillItems.length; i++) {
    const it = W.hillItems[i], sp = visW(it.d) + 2 * it.r * 2.2 + 400, x = wrapX(it.base, camx, sp);
    _p.set(x, -gy - it.r * 0.25, -it.d); _e.set(0, it.rot, 0); _q.setFromEuler(_e); _s.set(it.r * 2.2, it.r * 0.8, it.r);
    if (i >= W.hillN) _s.set(0, 0, 0);
    _m.compose(_p, _q, _s); W.hills.setMatrixAt(i, _m);
    if (i < 2) {}
  }
  W.hills.instanceMatrix.needsUpdate = true;
  const round = P.tree === "round";
  for (i = 0; i < W.treeItems.length; i++) {
    const it = W.treeItems[i], sp = visW(it.d) + 300, x = wrapX(it.base, camx, sp), s = i < W.treeN ? it.s : 0;
    const sway = Math.sin(t * 1.3 + it.ph) * 0.03;
    _e.set(0, 0, sway); _q.setFromEuler(_e);
    if (round) {
      _p.set(x, -gy + 28 * s, -it.d); _s.set(7 * s, 56 * s, 7 * s); _m.compose(_p, _q, _s); W.trunks.setMatrixAt(i, _m);
      _p.set(x, -gy + 80 * s, -it.d); _s.set(40 * s, 36 * s, 38 * s); _m.compose(_p, _q, _s); W.canopy.setMatrixAt(i, _m);
    } else {
      _p.set(x, -gy + 52 * s, -it.d); _s.set(34 * s, 80 * s, 34 * s); _m.compose(_p, _q, _s); W.pine1.setMatrixAt(i, _m);
      _p.set(x, -gy + 100 * s, -it.d); _s.set(24 * s, 60 * s, 24 * s); _m.compose(_p, _q, _s); W.pine2.setMatrixAt(i, _m);
    }
  }
  W.trunks.instanceMatrix.needsUpdate = W.canopy.instanceMatrix.needsUpdate = W.pine1.instanceMatrix.needsUpdate = W.pine2.instanceMatrix.needsUpdate = true;
  _q.identity();
  for (i = 0; i < W.cloudItems.length; i++) {
    const it = W.cloudItems[i], sp = visW(it.d) + 900, x = wrapX(it.base - t * it.v * 4, camx, sp);
    const y3 = -400 + (-it.sy + 400) * (DC + it.d) / DC, k = (DC + it.d) / DC * it.s * (i < W.cloudN ? 1 : 0);
    const puffs = [[0, 0, 46, 18], [-30, -3, 26, 13], [32, -2, 28, 14], [4, 10, 24, 14]];
    for (let j = 0; j < 4; j++) {
      const pf = puffs[j]; _p.set(x + pf[0] * k, y3 + pf[1] * k, -it.d); _s.set(pf[2] * k, pf[3] * k, pf[2] * 0.6 * k); _m.compose(_p, _q, _s);
      W.clouds.setMatrixAt(i * 4 + j, _m);
    }
  }
  W.clouds.instanceMatrix.needsUpdate = true;
}

/* ---------- gates ---------- */
/* Box whose on-screen silhouette under the oblique projection is EXACTLY [x0,x1] × [gyTop,gyBot] (game coords,
   y down) for a depth of 2h centred on z = 0. Projection: x' = x + KX·z, y'(three) = y − K·z. */
function placeExact(m, x0, x1, gyTop, gyBot, h) {
  const a = x0 + KX * h, b = x1 - KX * h, c = -gyBot + K * h, d = -gyTop - K * h;
  if (b - a < 0.2 || d - c < 0.2) { m.visible = false; return false; }
  m.visible = true; m.position.set((a + b) / 2, (c + d) / 2, 0); m.scale.set(b - a, d - c, 2 * h); return true;
}
/* thin decal box lying on a front face at depth z (screen rect [x0,x1]×[gyTop,gyBot] after projection) */
function placeFront(m, x0, x1, gyTop, gyBot, z) {
  if (x1 - x0 < 0.2 || gyBot - gyTop < 0.2) { m.visible = false; return; }
  m.visible = true; m.position.set((x0 + x1) / 2 - KX * z, -(gyTop + gyBot) / 2 + K * z, z); m.scale.set(x1 - x0, gyBot - gyTop, 0.4);
}
/* exact silhouette with an ink rim: the hull (ink) defines the silhouette, the coloured box sits 1.8 px inside */
function placeRimmed(e, idx, x0, x1, gyTop, gyBot, h, hi) {
  const inner = e.inner[idx], hull = e.hull[idx];
  if (gyBot - gyTop < 0.5) { inner.visible = hull.visible = false; return; }
  if (hi) { placeExact(hull, x0, x1, gyTop, gyBot, h); placeExact(inner, x0 + 1.8, x1 - 1.8, gyTop + 1.8, gyBot - 1.8, h - 0.6); }
  else { hull.visible = false; placeExact(inner, x0, x1, gyTop, gyBot, h); }
}
function newGate() {
  const g = new T.Group(), e = { g, inner: [], hull: [], lamps: [], posts: [], air: null };
  for (let i = 0; i < 8; i++) { // 0 topBody 1 topBand 2 botBand 3 botBody 4..7 rail parts
    const hull = new T.Mesh(GEO.box, basic(INK, { side: T.BackSide })); const inner = new T.Mesh(GEO.box, lam("#ffffff"));
    g.add(hull); g.add(inner); e.hull.push(hull); e.inner.push(inner);
  }
  for (let i = 0; i < 2; i++) { const l = new T.Mesh(GEO.sphLo, basic("#8DF2DC")); g.add(l); e.lamps.push(l); }
  // r2.2 contrast: two-tone outline – a 1 px HALO outside the pillar's vertical sides (cream on light worlds, ink on dark worlds)
  // so the edge separates from dark forest AND from bright sky. Only x grows (±1 px, DESIGN_SYSTEM ±1 px rule); gap-facing edges are untouched.
  e.halo = [0, 1, 2, 3].map(() => new T.Object3D()); // r3: placement proxies only — all halos of all gates draw as ONE instanced mesh (R.haloI, 1 call)
  e.gloss = [0, 1].map(() => { const m = new T.Mesh(GEO.box, basic("#ffffff", { transparent: true, opacity: 0.25, depthWrite: false })); g.add(m); return m; });
  for (let i = 0; i < 2; i++) { const p = new T.Mesh(GEO.cyl6, lam("#8a99aa")); g.add(p); e.posts.push(p); }
  e.air = new T.Mesh(GEO.box, new T.MeshBasicMaterial({ color: 0x3fa9e0, transparent: true, opacity: 0.12, depthWrite: false, blending: T.AdditiveBlending }));
  g.add(e.air);
  // B-14 / B2: pulse gate state is communicated by shape as well as colour.
  // The paired arrows point outward while the opening grows and inward while it closes.
  const pulseGlyph = new T.Group(); pulseGlyph.name = "pulse-gate-direction"; pulseGlyph.visible = false;
  const pulseBack = new T.Mesh(new T.BoxGeometry(22, 14, 1), basic("#1A1433")); pulseBack.position.z = 0;
  pulseGlyph.add(pulseBack);
  const pulseArrows = [];
  for (const side of [-1, 1]) {
    const shaft = new T.Mesh(new T.BoxGeometry(6, 1.8, 0.9), basic("#FFFFFF"));
    const head = new T.Mesh(new T.ConeGeometry(2.7, 5.5, 3), basic("#FFFFFF"));
    pulseGlyph.add(shaft, head); pulseArrows.push({ side, shaft, head });
  }
  e.pulseGlyph = { group: pulseGlyph, back: pulseBack, arrows: pulseArrows };
  g.add(pulseGlyph);
  R.fg.add(g); R.gates.push(e);
  return e;
}
const PAIR = { classic: 1, drift: 1, pulse: 1, weave: 1 };
function updateGates(S, o) {
  const gy = S.H - S.groundH, hi = R.quality === "high", pal = o.gatePal, v = R.view;
  for (const e of R.gates) { e.used = false; }
  const gateMat = lam(pal.gate), bandMat = lam(pal.band), lampMat = basic(pal.lamp), railMat = lam(pal.gate);
  // readability: the ink rim of the 2D look disappears on dark worlds (dusk/neon/night) ⇒ rim in the world's band accent there
  _c.set(pal.gate); const dark = (0.2126 * _c.r + 0.7152 * _c.g + 0.0722 * _c.b) < 0.06;
  const rimMat = basic(dark ? "#" + new T.Color(pal.band).lerp(new T.Color("#FFFFFF"), 0.3).getHexString() : "#1A1433", { side: T.BackSide }), // r3: neon rim = band accent lifted 30 % toward white (≥ 4.5:1 on the Magi night sky)
    haloMat = basic(dark ? "#05030B" : "#FFF4DC", { side: T.BackSide }), hw = dark ? 2 : 1; // r3: dark worlds get a near-black 2 px halo (neon rim | halo | dusk sky ≥ 3:1)
  let free = 0;
  R.debug.lastBounds = null;
  const used = [];
  for (const ob of S.pipes) {
    if (ob.x > S.W + v.offX + 140 || ob.x + (ob.w || 78) < -v.offX - 140) continue;
    let e = R.gateMap.get(ob);
    if (!e || e.used) {
      while (free < R.gates.length && (R.gates[free].used || R.gates[free].owner && S.pipes.indexOf(R.gates[free].owner) >= 0 && R.gates[free].owner !== ob)) free++;
      e = free < R.gates.length ? R.gates[free] : newGate();
      R.gateMap.set(ob, e); e.owner = ob;
    }
    e.used = true; e.g.visible = true; used.push({ ob, e });
    const w = ob.w || 78, x = ob.x, top = ob.gapY - ob.gap / 2, bot = ob.gapY + ob.gap / 2;
    for (const m of e.inner) m.visible = false; for (const m of e.hull) m.visible = false;
    for (const m of e.lamps) m.visible = false; for (const m of e.posts) m.visible = false; e.air.visible = false;
    if (e.pulseGlyph) e.pulseGlyph.group.visible = false;
    for (const m of e.gloss) m.visible = false; for (const m of e.hull) m.material = rimMat; for (const m of e.halo) m.visible = false;
    if (PAIR[ob.fam]) {
      // identity.js drawGatePair: pillars [x, x+w], bands [x−6, x+w+6] × 22 px at the gap
      for (const i of [0, 3]) e.inner[i].material = gateMat; for (const i of [1, 2]) e.inner[i].material = bandMat;
      if (top > -20) { placeRimmed(e, 0, x, x + w, S.camY - 80, top - 12, 26, hi); placeExact(e.halo[0], x - hw, x + w + hw, S.camY - 80, top - 12, 26.6); }
      // r3: the bands get the same side halo, stopping 3 px short of the gap edge so the gap edge stays pure ink (R6)
      if (top > 0) { placeRimmed(e, 1, x - 6, x + w + 6, top - 22, top, 32, hi); placeExact(e.halo[2], x - 6 - hw, x + w + 6 + hw, top - 22, top - 3, 32.6); }
      if (bot < gy) { placeRimmed(e, 2, x - 6, x + w + 6, bot, bot + 22, 32, hi); placeExact(e.halo[3], x - 6 - hw, x + w + 6 + hw, bot + 3, bot + 22, 32.6); }
      if (bot < gy + 20) { placeRimmed(e, 3, x, x + w, bot + 12, gy + 40, 26, hi); placeExact(e.halo[1], x - hw, x + w + hw, bot + 12, gy + 40, 26.6); }
      // gloss line (identity.js: 6 px white 25 % on the pillar), lying on the front face
      if (top - 40 > S.camY) placeFront(e.gloss[0], x + 10, x + 16, S.camY - 10, top - 40, 26.3);
      if (gy - 10 > bot + 40) placeFront(e.gloss[1], x + w - 18, x + w - 12, bot + 40, gy - 10, 26.3);
      // gap lanterns on the band fronts (projected centre = the 2D lantern position)
      const lz = 33;
      if (top > 0) { const l = e.lamps[0]; l.visible = true; l.material = lampMat; l.scale.setScalar(4.2); l.position.set(x + w / 2 - KX * lz, -(top - 11) + K * lz, lz); }
      if (bot < gy) { const l = e.lamps[1]; l.visible = true; l.material = lampMat; l.scale.setScalar(4.2); l.position.set(x + w / 2 - KX * lz, -(bot + 11) + K * lz, lz); }
      if (ob.fam === "pulse" && e.pulseGlyph) {
        const openness = (ob.gap - 130) / Math.max(1, ob.baseGap + ob.amp - 130);
        const direction = Math.cos((ob.t / ob.period) * Math.PI * 2 + ob.ph) > 0 ? 1 : -1;
        const glyph = e.pulseGlyph; glyph.group.visible = true;
        glyph.group.position.set(x + w / 2 - KX * 34, -(top - 11) + K * 34, 34);
        glyph.back.material.color.set(openness > 0.45 ? "#245D46" : "#713B43");
        for (const a of glyph.arrows) {
          const point = direction > 0 ? a.side : -a.side;
          a.head.position.set(a.side * 7, 0, 1.2);
          a.head.rotation.z = point > 0 ? -Math.PI / 2 : Math.PI / 2;
          a.shaft.position.set(a.side * 7 - point * 3.1, 0, 1.0);
        }
      }
    } else {
      // identity.js drawGateRails: two 8 px rails at x+1 and x+w−9 with 12×8 bands at the gap (same corridor as corridorHit)
      let k = 4;
      for (const rx of [x + 1, x + w - 9]) {
        for (const i of [k, k + 1]) { e.inner[i].material = railMat; }
        if (top > 0) { placeRimmed(e, k, rx, rx + 8, S.camY - 40, top - 6, 5, hi); }
        if (bot < gy) { placeRimmed(e, k + 1, rx, rx + 8, bot + 6, gy + 10, 5, hi); }
        k += 2;
      }
      // rail bands reuse slots 1/2 (left rail) — drawn as wide pads at the gap edges on both rails
      if (top > 0) { e.inner[1].material = bandMat; placeRimmed(e, 1, x - 1, x + w + 1, top - 8, top, 6, hi); }
      if (bot < gy) { e.inner[2].material = bandMat; placeRimmed(e, 2, x - 1, x + w + 1, bot, bot + 8, 6, hi); }
      if (ob.fam === "wind") {
        // wind: the metal posts, pennants and stream arrows stay in the 2D overlay (obstacles.js is not edited on feat/3d);
        // 3D adds only a faint air column behind the gameplay plane
        e.air.visible = true;
        const windRules = window.WIND_RULES_ON === true;
        e.air.material.color.set(windRules ? (ob.dir < 0 ? "#3FD9A8" : "#F2A33A") : (ob.dir < 0 ? "#3FA9E0" : "#EF7D23"));
        e.air.position.set(x + w / 2, -(S.camY + gy) / 2, -30); e.air.scale.set(w - 22, gy - S.camY, 20);
      }
    }
  }
  for (const e of R.gates) if (!e.used) { e.g.visible = false; e.owner = null; }
  if (!R.haloI) { R.haloI = new T.InstancedMesh(GEO.box, haloMat, 64); R.haloI.frustumCulled = false; R.fg.add(R.haloI); }
  let nh = 0; R.haloI.material = haloMat;
  for (const { e } of used) for (const m of e.halo) if (m.visible && nh < 64) { m.updateMatrix(); R.haloI.setMatrixAt(nh++, m.matrix); }
  R.haloI.count = nh; R.haloI.visible = nh > 0; R.haloI.instanceMatrix.needsUpdate = true;
  R._used = used;
}

/* ---------- bird ---------- */
function updateBird(S, o) {
  const B = o.bird;
  let bird = R.bird;
  const palKey = B.pal.join(",") + "|" + B.palId;
  if (bird.palKey !== palKey) { // rebuild for a new bird (geometry shared, materials cached)
    const eq = Object.assign({}, bird.equipKeys || {});
    R.fg.remove(bird.root); disposeTree(bird.root);
    bird = R.bird = makeBird(B.pal, B.palId); bird.palKey = palKey; bird.equipKeys = eq; R.fg.add(bird.root);
    for (const h of bird.hulls) h.visible = R.quality === "high";
  }
  // equipment through sockets
  const hatDef = B.hat && EQUIP[B.hat];
  equip(bird, "head", hatDef && hatDef.slot === "head" ? B.hat : null, () => hatDef.build());
  equip(bird, "eyes", hatDef && hatDef.slot === "eyes" ? B.hat : null, () => hatDef.build());
  equip(bird, "neck", B.scarf ? "scarf:" + B.scarf + ":" + (B.scarf2 || "") : "scarf:" + B.pal[5], () => buildScarf(B.scarf || B.pal[5], B.scarf2));
  equip(bird, "tail", B.trail ? "trail:" + B.trail.col + ":" + (B.trail.dots || "") : null, () => buildTrail(B.trail.col, B.trail.dots));
  const t = S.time || 0, rm = o.rm;
  const root = bird.root;
  root.position.set(B.x, -B.y, 0); root.scale.setScalar(B.scale);
  root.rotation.set(0, 0, -B.rot);
  // slight yaw/bank so the near flank and the top of the wings read as 3D
  bird.rig.rotation.set(B.menu && !rm ? 0.28 + Math.sin(t * 0.6) * 0.1 : 0.26, B.menu && !rm ? -0.35 + Math.sin(t * 0.5) * 0.25 : -0.32, 0);
  // wings: wingDeg (identity.wingAngle: −28 at the flap peak, +8 diving, ±3 gliding) → elevation about the body axis
  const wc = B.dead ? { a: -0.3, sweep: 0.4 } : B.menu ? { a: 0.25 + (rm ? 0 : Math.sin(t * 0.45 * Math.PI * 2) * 0.12), sweep: 0 } : wingCycle(B.since != null ? B.since * 1000 : null, B.vy, t, rm);
  bird.parts.wingL.rotation.set(-wc.a, wc.sweep * 0.5, 0);
  bird.parts.wingR.rotation.set(wc.a, -wc.sweep * 0.5, 0);
  bird.parts.tail.rotation.z = rm ? 0 : Math.sin(t * 3.1) * 0.06 - Math.max(-0.2, Math.min(0.25, B.vy / 2400));
  // eyes: blink / dead / happy
  for (const e of bird.parts.eyes) e.scale.y = B.dead ? 0.15 : B.blink ? 0.12 : B.happy ? 0.55 : 1;
  // equipment animation
  const neck = bird.equip.neck && bird.equip.neck.obj.getObjectByName("scarfTails");
  if (neck) for (const s of neck.children) { const i = s.userData.i; s.rotation.z = rm ? -0.2 : -0.2 + Math.sin(t * 2.2 * Math.PI * 2 + i) * 0.18 - Math.max(-0.3, Math.min(0.4, B.vy / 900)); }
  const hd = bird.equip.head && bird.equip.head.obj.getObjectByName("spin"); if (hd) hd.rotation.y = rm ? 0.6 : t * 14;
  const tr = bird.equip.tail && bird.equip.tail.obj; if (tr) for (const s of tr.children) if (s.userData.i != null) s.rotation.z = rm ? 0 : Math.sin(t * 9 + s.userData.i * 2) * 0.12;
  // contact shadow on the ground top face
  const gy = S.H - S.groundH, hF = Math.max(0, Math.min(1, 1 - (gy - B.y) / 500));
  R.shadow.visible = !B.menu && hF > 0.02;
  R.shadow.position.set(B.x, -gy + 0.5, 22); R.shadow.scale.set(30 - 20 * hF, 0.2, 7); R.shadow.material.opacity = 0.22 * hF;
}

/* ---------- cameras ---------- */
function updateCameras(S, o) {
  const v = R.view, cam = R.fgCam;
  cam.left = -v.offX; cam.right = S.W + v.offX; cam.top = -v.camY; cam.bottom = -(v.camY + v.viewH);
  cam.position.set(-o.shx, o.shy, 1000);
  cam.updateProjectionMatrix();
  // oblique shear in view space: x' = x + KX·(zv + 1000), y' = y − K·(zv + 1000)  (zv + 1000 = world z)
  const sh = new T.Matrix4().set(1, 0, KX, KX * 1000, 0, 1, -K, -K * 1000, 0, 0, 1, 0, 0, 0, 0, 1);
  cam.projectionMatrix.multiply(sh);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  cam.updateMatrixWorld();
  const bc = R.bgCam;
  bc.aspect = v.viewW / v.viewH;
  bc.fov = 2 * Math.atan((v.viewH / 2) / DC) * 180 / Math.PI;
  bc.position.set(S.W / 2 + S.camX - o.shx, -(v.camY + v.viewH / 2) + o.shy, DC);
  bc.updateProjectionMatrix(); bc.updateMatrixWorld();
}

/* ---------- Round 7: Ålmor depth-only boss visuals (never part of collision/simulation) ---------- */
function makeBossScene() {
  const group = new T.Group(); group.visible = false;
  const eel = new T.Group(); group.add(eel);
  const body = [];
  for (let i = 0; i < 19; i++) {
    const f = i / 18, radius = 15.5 * (1 - f * 0.72);
    const m = new T.Mesh(GEO.sph, toon(i < 12 ? (i % 3 ? "#4faaa0" : "#397f82") : "#73c8b0"));
    m.scale.set(radius * 1.12, radius * 0.76, radius * 0.82); eel.add(m); body.push(m);
  }
  const head = new T.Group(); eel.add(head);
  const skull = new T.Mesh(GEO.sph, toon("#72cbb5")); skull.scale.set(27, 20, 16); head.add(skull);
  const snout = new T.Mesh(GEO.sph, toon("#a5e5ce")); snout.position.set(18, -3, 1); snout.scale.set(15, 10, 13); head.add(snout);
  const eyeMat = basic("#123b43"); const eyeGlow = basic("#f6fff0");
  for (const side of [-1, 1]) {
    const eye = new T.Mesh(GEO.sph, eyeGlow); eye.position.set(5, 6, side * 13); eye.scale.set(4.8, 5.4, 3.2); head.add(eye);
    const pupil = new T.Mesh(GEO.sph, eyeMat); pupil.position.set(7, 6, side * 15.2); pupil.scale.set(2, 3.2, 1.3); head.add(pupil);
    const gill = new T.Mesh(GEO.sph, lam("#d0f6d9")); gill.position.set(-10, -3, side * 12); gill.scale.set(2.2, 8, 1.2); head.add(gill);
  }
  const crest = new T.Mesh(GEO.cone5, toon("#f1c982")); crest.position.set(-4, 20, 0); crest.rotation.z = -0.35; crest.scale.set(7, 13, 5); head.add(crest);
  const fins = [];
  for (let i = 0; i < 3; i++) {
    const fin = new T.Mesh(GEO.cone4, toon(i === 1 ? "#f2c981" : "#78c8ad"));
    fin.position.set(-17 - i * 10, 7 + i * 2, 0); fin.rotation.z = Math.PI / 2; fin.scale.set(7 - i, 14 - i * 2, 3); eel.add(fin); fins.push(fin);
  }
  const hazards = new T.Group(); group.add(hazards);
  const slots = [];
  for (let i = 0; i < 8; i++) {
    const g = new T.Group(); hazards.add(g);
    const mat = lam("#65d9e8", { transparent: true, opacity: 0.68, depthWrite: false });
    const edge = basic("#d7fbff", { transparent: true, opacity: 0.8, depthWrite: false });
    const bodyMesh = new T.Mesh(GEO.box, mat); g.add(bodyMesh);
    const accent = new T.Mesh(GEO.box, edge); g.add(accent);
    const fish = new T.Group(); g.add(fish);
    const fishBody = new T.Mesh(GEO.sph, lam("#f0d895", { transparent: true, opacity: 0.9, depthWrite: false }));
    fishBody.scale.set(38, 15, 8); fish.add(fishBody);
    const tail = new T.Mesh(GEO.cone4, lam("#ffe6a3", { transparent: true, opacity: 0.9, depthWrite: false }));
    tail.position.set(-43, 0, 0); tail.rotation.z = Math.PI / 2; tail.scale.set(13, 17, 4); fish.add(tail);
    const tide = new T.Mesh(new T.PlaneGeometry(1, 1), basic("#59cfe6", { transparent: true, opacity: 0.36, depthWrite: false, side: T.DoubleSide }));
    g.add(tide);
    slots.push({ group: g, body: bodyMesh, accent, fish, tide });
  }
  return { group, eel, body, head, fins, slots };
}
function updateAlmorBossScene(view, reducedMotion, B) { if (!B) return;
  const active = !!(view && view.active);
  B.group.visible = active;
  if (!active) return;
  const t = reducedMotion ? 0 : Number(view.t) || 0;
  const inhale = reducedMotion ? 0 : Math.max(0, Math.min(1, Number(view.inhale) || 0));
  // 7a: oblique compensation uses the WORLD z (as gates do, x' = x + KX·z); the earlier 1000 + z put every boss mesh
  // ≈120 px left and ≈140 px too high. Ålmor now lives in the lake by the waterfall at the right edge (BOSS_DESIGN_R2 §2:
  // S-loops at the right edge, rising and sinking with the tide), head facing the bird.
  const z = -220, dx = KX * z, dy = K * z;
  const tideLift = view.tide ? -22 : 0;
  for (let i = 0; i < B.body.length; i++) {
    const f = i / (B.body.length - 1), gx = 330 + f * 150;
    const gy = 392 + tideLift + Math.sin(f * 7.1 + t * 0.86) * (16 + f * 18) + Math.sin(f * 12 - t * 0.42) * 6;
    const m = B.body[i]; m.position.set(gx - dx, -gy + dy, z); m.rotation.z = Math.cos(f * 7.1 + t * 0.86) * 0.18;
  }
  const hx = 312 + inhale * 10, hy = 380 + tideLift + Math.sin(t * 0.86) * 9; // inhale: the head draws back before each tell
  B.head.position.set(hx - dx, -hy + dy, z + 1); B.head.rotation.set(0, Math.PI, reducedMotion ? 0 : Math.sin(t * 0.7) * 0.08); // turned: snout and eyes face the bird
  B.head.scale.setScalar(1 + inhale * 0.075);
  B.fins.forEach((f, i) => { f.rotation.z = Math.PI / 2 + (reducedMotion ? 0 : Math.sin(t * 1.4 + i) * 0.13); });
  B.eel.position.set(0, 0, 0);
  const visible = (view.hazards || []).slice(0, B.slots.length);
  for (let i = 0; i < B.slots.length; i++) {
    const slot = B.slots[i], h = visible[i];
    slot.group.visible = !!h;
    if (!h) continue;
    const r = h.rect || {}, x0 = Number(r.x0) || 0, x1 = Number(r.x1) || 0, y0 = Number(r.y0) || 0, y1 = Number(r.y1) || 0;
    const progress = Math.max(0, Math.min(1, Number(h.progress) || 0));
    const depthDistance = Math.max(0, Number(h.depthDistance) || 190);
    // 7a: compensate with the world z (hz) so the 3D tell sits exactly on its warning contour, and let the
    // animation follow the warning: pillars and tide rise out of the water, the sweep extends from Ålmor's side,
    // the fish swims in from the right – each reaching its full lethal shape exactly at impact (progress 1).
    const hz = -depthDistance * (1 - progress);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = Math.max(8, x1 - x0), hh = Math.max(8, y1 - y0);
    const grow = 0.12 + 0.88 * progress;
    const isFish = h.kind === "fish", isTide = h.kind === "tide", isSweep = h.kind === "sweep";
    let px = cx, py = cy;
    const fromTop = h.lane === "cascade" || h.lane === "deep" || h.lane === "dive"; // 7a: attacks from above
    if (h.kind === "pillar" || isTide) py = fromTop ? y0 + hh * grow / 2 : y1 - hh * grow / 2; // anchored at the water line (or the top), grows toward the lane
    if (isSweep) px = x1 - w * grow / 2;                         // extends leftward from Ålmor's side
    if (isFish) { px = cx + 140 * (1 - progress); py = fromTop ? y1 - 37 - 60 * (1 - progress) : y0 + 37 + 60 * (1 - progress); } // leaps (or dives) in from the right to the arc tip
    slot.group.position.set(px - KX * hz, -py + K * hz, hz);
    slot.body.visible = !isFish && !isTide;
    slot.accent.visible = !isFish && !isTide;
    slot.fish.visible = isFish;
    slot.tide.visible = isTide;
    if (isFish) { slot.fish.scale.setScalar(0.8 + progress * 0.2); }
    else if (isTide) { slot.tide.scale.set(w, hh * grow, 1); slot.tide.position.set(0, 0, -1); }
    else {
      const sw = isSweep ? w * grow : w, sh = isSweep ? hh : hh * grow;
      slot.body.scale.set(sw, sh, isSweep ? 24 : 18);
      slot.accent.scale.set(isSweep ? sw * 0.96 : Math.max(4, w * 0.16), Math.max(3, sh * 0.045), 20);
      slot.accent.position.set(0, isSweep ? 0 : (fromTop ? -(sh / 2 - 2) : sh / 2 - 2), 10); // crest marks the exact lethal edge
    }
    const opacity = 0.25 + progress * 0.48;
    if (slot.body.material && slot.body.material.opacity != null) slot.body.material.opacity = opacity;
  }
}
if (window.DipwingBossRenderRegistry) window.DipwingBossRenderRegistry.register("almor", updateAlmorBossScene);
function updateBossScene(view, reducedMotion) {
  const B = R.boss; if (!view || !B) { if (B) B.group.visible = false; return; }
  B.group.visible = !!view.active;
  if (!view.active) return;
  if (window.DipwingBossRenderRegistry && window.DipwingBossRenderRegistry.render(view.bossId || "almor", view, reducedMotion, B)) return;
  // Unknown boss IDs remain invisible rather than drawing the wrong creature.
}

/* ---------- frame ---------- */
/* Visual Studio round 2 (studio/r2): every frame step goes through this table so an optional add-on
   (src/r3d-studio.js, window.R3D_STUDIO) can wrap or replace a step WITHOUT editing the functions above.
   Without the add-on the table holds exactly the original functions (behaviour unchanged). */
const H = { buildWorld, setWorldPalette, updateWorld, updateGround, updateGates, updateBird, updateCameras, after: null };
function updateFeatherFx(S) {
  if (!R.featherFx) return;
  const items = (S.particles || []).filter(p => p && (p.kind === "feather" || p.feather));
  while (R.featherFxPool.length < items.length) {
    const g = new T.Group();
    const mat = new T.MeshBasicMaterial({ color: "#F5E7CD", side: T.DoubleSide, transparent: true, depthWrite: false });
    const stemMat = new T.MeshBasicMaterial({ color: "#66717B", side: T.DoubleSide, transparent: true, depthWrite: false });
    const m = new T.Mesh(R.featherGeo, mat); g.add(m);
    const stem = new T.Mesh(R.featherStemGeo, stemMat); g.add(stem);
    R.featherFx.add(g); R.featherFxPool.push(g);
  }
  for (let i = 0; i < R.featherFxPool.length; i++) {
    const g = R.featherFxPool[i], p = items[i];
    g.visible = !!p;
    if (!p) continue;
    const k = Math.max(0, Math.min(1, 1 - p.t / Math.max(0.001, p.life)));
    const size = Math.max(3.2, p.r * 1.8);
    g.position.set(p.x, -p.y, 5 + i * 0.001);
    g.rotation.z = -(Number(p.rot) || 0);
    g.scale.set(size, size * 0.56, 1);
    g.children[0].material.color.set("rgb(" + String(p.col || "245,231,205") + ")");
    g.children[0].material.opacity = k;
    g.children[1].material.opacity = k * 0.9;
  }
}
function frame(S, o) {
  if (!R.ok || R.lost) return false;
  const t0 = performance.now(); // statistics only (never game time)
  R.lastView = S; // B-11: S here is Sim3D.renderView(S) – a copy from the shared sim, never the live game state
  if (!R._ext && window.R3D_STUDIO && window.R3D_STUDIO.install) { R._ext = true; try { window.R3D_STUDIO.install(window.Render3D); } catch (e) { R.extError = String(e && e.message || e); } }
  if (!R.world) H.buildWorld();
  H.setWorldPalette(o.worldKey);
  H.updateCameras(S, o);
  H.updateWorld(S, o);
  H.updateGround(S, palFor(R.worldKey));
  H.updateGates(S, o);
  H.updateBird(S, o);
  updateFeatherFx(S);
  if (H.after) H.after(S, o);
  updateBossScene(window.DipwingBossView, o.rm);
  const gl = R.gl;
  gl.clear();
  gl.render(R.bg, R.bgCam);
  gl.clearDepth();
  gl.render(R.fg, R.fgCam);
  const ms = performance.now() - t0;
  const st = R.stats; st.frames++; st.cpuMs.push(ms); if (st.cpuMs.length > 240) st.cpuMs.shift();
  return true;
}

/* ---------- debug / verification ---------- */
const _v3 = new T.Vector3();
function toGame(x, y, z) {
  _v3.set(x, y, z).project(R.fgCam); const v = R.view;
  return [(_v3.x + 1) / 2 * v.viewW - v.offX, v.camY + (1 - _v3.y) / 2 * v.viewH];
}
/* screen bounds (game px) of a box mesh: project its 8 corners with the real camera matrices */
function meshBounds(m) {
  m.updateMatrixWorld(true);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const cx of [-0.5, 0.5]) for (const cy of [-0.5, 0.5]) for (const cz of [-0.5, 0.5]) {
    _v3.set(cx, cy, cz).applyMatrix4(m.matrixWorld); const [gx, gyy] = toGame(_v3.x, _v3.y, _v3.z);
    x0 = Math.min(x0, gx); x1 = Math.max(x1, gx); y0 = Math.min(y0, gyy); y1 = Math.max(y1, gyy);
  }
  return { x0, x1, y0, y1 };
}
/* Per visible obstacle: projected silhouette of the 3D gate pieces. Used by the parity test and the debug overlay. */
function debugBounds() {
  const out = [];
  for (const { ob, e } of (R._used || [])) {
    const pieces = [];
    for (let i = 0; i < 8; i++) {
      const m = e.hull[i].visible ? e.hull[i] : e.inner[i].visible ? e.inner[i] : null;
      if (m) pieces.push(Object.assign({ slot: i }, meshBounds(m)));
    }
    out.push({ fam: ob.fam, x: ob.x, w: ob.w || 78, gapY: ob.gapY, gap: ob.gap, pieces });
  }
  return out;
}
function info() {
  const g = R.gl, a = R.stats.cpuMs.slice().sort((p, q) => p - q);
  return { version: VERSION, ok: R.ok, lost: R.lost, quality: R.quality, dpr: R.dpr,
    calls: g ? g.info.render.calls : 0, triangles: g ? g.info.render.triangles : 0,
    geometries: g ? g.info.memory.geometries : 0, textures: g ? g.info.memory.textures : 0,
    gates: R.gates.length, cpuP50: a.length ? a[a.length >> 1] : null, cpuP95: a.length ? a[Math.floor(a.length * 0.95)] : null,
    webgl2: g ? g.capabilities.isWebGL2 : null, three: T.REVISION };
}
function dispose() {
  try { R.gl && R.gl.dispose(); } catch (e) {}
  try { R.canvas && R.canvas.remove(); } catch (e) {}
  R.ok = false;
}

window.Render3D = { VERSION, K, KX, supported, init, resize, frame, setQuality, debugBounds, info, dispose,
  EQUIP, BIRD_SPECS, makeBird, buildScarf, wingCycle, birdMetrics, _R: R,
  /* studio/r2 add-on surface (read-only helpers + the step table) */
  _H: H, _lib: { T, lam, basic, GEO, slab, bez, lcg, wrapX, placeExact, placeFront, palFor, equip, disposeTree, gradTex, glowTex, toGame, meshBounds, INK, DC } };
})();
