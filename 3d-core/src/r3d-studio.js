/* ============================================================
   DIPWING — src/r3d-studio.js  (Visual Studio round 2 add-on for the 3D PROTOTYPE, branch studio/r2)
   Loaded after src/render3d.js only when the 3D path is active and ?studio != 0.
   Adds, render-only:
     1. Tornis as a COMMON SWIFT (tornseglare): variant "A" (sickle, recommended) or "B" (mascot), merged meshes.
     2. Modular equipment on a socket rig derived from each bird's body plan (+ studio gear preview, visual only).
     3. Green Valley world kit (meadow worldKey): layered ridges, waterfall, forest, meadow, light, ambient life.
     4. Pendulum obstacle family drawn in 3D (same OBSTACLES.pendulum.bob() the collision uses; 2D painter muted
        only while this add-on draws, restored on fallback).
   CONTRACT: reads S and the pose only. Never writes S, never calls the game RNG (own lcg), never touches input,
   storage (except reading two preview flags), timing or physics. Decor time = S.time (frozen under reduced motion).
   ============================================================ */
(function () {
"use strict";
const T = window.THREE_R3D; if (!T) return;
const VERSION = "studio-r2.8-b12b-birds";
const INK = 0x1A1433;
const flag = (q, k, d) => { try { const v = new URLSearchParams(location.search).get(q); if (v != null && v !== "") return v; } catch (e) {}
  try { const s = window.localStorage.getItem(k); if (s != null && s !== "") return s; } catch (e) {} return d; };
const CFG = { variant: "A", gear: flag("gear", "pfb_studio_gear", "off") }; // Martin 2026-11-14: Tornis A "Sickle" chosen; B archived (dipwing-visual-studio/character/archive/)

/* ---------- geometry helpers (self-contained: also used by the studio lab pages) ---------- */
function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
function bez(p0, p1, p2, p3, n) { const o = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t;
  o.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); } return o; }
/* flat slab between two polylines (x,y), thickness along z */
function slabPos(lead, trail, depth) {
  const pos = [], h = depth / 2; const P = (p, z) => [p[0], p[1], z];
  const tri = (a, c, b) => pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  for (let i = 0; i < lead.length - 1; i++) { const a = lead[i], b = lead[i + 1], c = trail[i + 1], d = trail[i];
    tri(P(a, h), P(d, h), P(b, h)); tri(P(b, h), P(d, h), P(c, h)); tri(P(a, -h), P(b, -h), P(d, -h)); tri(P(b, -h), P(c, -h), P(d, -h));
    for (const [u, v] of [[a, b], [c, d]]) { tri(P(u, h), P(v, h), P(v, -h)); tri(P(u, h), P(v, -h), P(u, -h)); } }
  for (const [u, v] of [[trail[0], lead[0]], [lead[lead.length - 1], trail[trail.length - 1]]]) { tri(P(u, h), P(v, h), P(v, -h)); tri(P(u, h), P(v, -h), P(u, -h)); }
  return pos;
}
/* a "part" = non-indexed positions + normals + one colour, already transformed */
function part(geo, mtx, col) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (!g.getAttribute("normal")) g.computeVertexNormals();
  if (mtx) g.applyMatrix4(mtx);
  const n = g.getAttribute("position").count, c = new T.Color(col), cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
  g.setAttribute("color", new T.Float32BufferAttribute(cols, 3));
  return g;
}
function slabPart(lead, trail, depth, mtx, col) { const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(slabPos(lead, trail, depth), 3)); g.computeVertexNormals(); return part(g, mtx, col); }
function merge(parts) {
  let n = 0; for (const p of parts) n += p.getAttribute("position").count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
  for (const p of parts) { pos.set(p.getAttribute("position").array, o * 3); nor.set(p.getAttribute("normal").array, o * 3); col.set(p.getAttribute("color").array, o * 3); o += p.getAttribute("position").count; p.dispose(); }
  const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(pos, 3)); g.setAttribute("normal", new T.BufferAttribute(nor, 3)); g.setAttribute("color", new T.BufferAttribute(col, 3));
  g.computeBoundingSphere(); return g;
}
const M4 = () => new T.Matrix4();
function trs(x, y, z, rx, ry, rz, sx, sy, sz) { const m = M4(); m.compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx || 0, ry || 0, rz || 0)), new T.Vector3(sx == null ? 1 : sx, sy == null ? (sx == null ? 1 : sx) : sy, sz == null ? (sx == null ? 1 : sx) : sz)); return m; }
/* tapered ellipsoid (torpedo): unit sphere, y/z shrink toward the rear */
function torpedo(seg, rings, L, H, W, taperRear, taperFront) {
  const g = new T.SphereGeometry(1, seg, rings), p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); const f = x < 0 ? 1 - taperRear * x * x : 1 - taperFront * x * x;
    p.setXYZ(i, x * L, p.getY(i) * H * f, p.getZ(i) * W * f); }
  g.computeVertexNormals(); return g;
}
/* AO:BEGIN – baked in Blender 4.5.16 LTS (character/blender/bake_tornis.py); [vertexCount, base64 bytes]. Regenerate with embed_ao.py */
const TORNIS_AO = {"body": [1812, "///////////7//fz/+/z////////////////////////////////////////////////////6/ff+//j2+er69Oz5+PP67PP8+8E79cE+/8E+wQA//8E+wQE///3/wT3//v7+/f3///7//P7//////v////////7///////////3/+v3+///////0/vj9//jh8uTx+eXq4e7k4fPALsAv7cABAgADAAAAAAABAAA7wTTBADD4+e778/D69/r48Pj//f/+/v////7///////v//vr99fL3wTX//v/++v/6//7///7t+vj5/Pfw7cAq9sAALsAuwAAAAAEBAAAAAAAAAgAuwAAAAAEm7+HywCD25Pnl4fj/+v77+f7+//z///74/cE/+sE3wDrAIfr//f/+/f/////////8/v/+///AO8A8/sAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAArwDbAADj46v3p9vz/+//6/v/+//3///7BO+n8++j92T7SATz////9/v/////////////////AP/7///7AAAAAPMAAAAAAAAAAAAAAAAAAADzAADz6wD/APf//+//8/////v/+///9//7///3UOME3+ME9wT/BPP///v/+/v/////////////////////////APvf9/vXAAAAANsAAADbAADb+wD/ANv7////////////////////////7//////7AN/z3//z+/P/9//////////////////////////////7///75/8A//8AAO8A3wAA7wAAAAAA++//6wD///////v/////////////////+///////9//////////////////////////////7////////+///////APsA//8AAAAAAAAAAAAAAAAA+wD/AAD///////v/////////////////////////////////////////////////////AP//AAD/AAD//wD///////////////////////v///v////////7///////7//v7////////////7/PP9xzT+/fj99Pr8/MA7/MA9+/b8wDb//v7//P////v///z7/sA/98A9/fr9wD3+/fv+/Pv8/sc9+cYmzQkPFg037/brxDXAOMA3+cAywAAAAAA++v/7wD/7/8A//8AAMcAxwAA5wDrAADr498U498YNMNcwzRYLHhUfEhU1xDjDCjnAPcA8/sAAACTAACX/wDbANPPAPvX+9PPAAAAAJcA6wDrAADzFN8o188kbERIRExIPHBYcJNQ5yDnKBzrAPv/////qwDfAPvnp98A478A46O/owC7AKPvp9v79wD/APv/JNcc4+ckbDybQFCfYKNQp3RU5ywEJCQA//f/+wD3v/sA++cAAJsAnwAAmwAAAAAA+8vzwwD3+/8A//8AKOMk3wAop1iAYFB4SFgsUDQwBCAUJBgU9wDzAATrAOsA8+sAAAAAAAAAAAAAAAAA8wDnAADnAPsA++sAKAAcAAwYTDwwPCw0GBQIEBAI4wgEAOMEAAAAAAAA4wAEBN8EFAgEGBAQPExIOEQsMCQgJBQUJBQYJBwoNDhAQFBcVFwsXAAwLDwINCgIDAgIEAgICAgABAgABAAQCAAQFAgAEAwENCgkKAggYFAATCwAHAAMAAgMABDLEAzPAATXBNPfAASHBOOLCADnAIvfBADXAOPTDAQMAMMIABwAGAwEBAC7BAiv8wD7AOP7///////70/v3///7+9P/2/v7+/v/+///APvn7/vnBAAEALcI3wDrAADn+/v79///////////////////////////////////9///+//7ANsA3+sA+wT7////////////////////+///AP//XOOjYJt4UHRIPEwQUBgISAgQUBRIWEx0WICfXKffl+uf48OfWHxMfHw8LEwkTDgcDBwMLBwQDCQAICgAHBAsDAAoJAwgEBQYSCBAJCBAeFB0ZFyH55u/m5/Dh6+Ap3SDNFgkVFQkDBwEFBQIBAQACAgAABQAFAQAEAAAAAAACAAEAAAAEAgcEAgYVCxEMCRUt5t0cGRcKCQgKCwgCBwQJCAMAAgECAgEAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAABAgIBAQIHBAkDAwgKCQkIBwoBAQIAAQABAgECAgEBAD7BAD7AAD7AP//AAD7APf3AAD/APv/AAD/APv/AAAAAP8ACAgEAAQICAQEAAwEAAQEAAQAAAAEBAQE/wD/AAD/////////////////////////////////AP8A//8AAAQAAAAACAAABAAEAAD/AAD//wD/////////////////AP//AAD/AAD7AAD7AAD3AAD7AAjzFAz7BAD3AAgEAAAAEAAEIBAMIBAADBgE"], "wingL": [228, "FO8w8+soKHjT13jbALu3AEi703Rw08uA7//v///zz9v//9v/z///09P//8fH//vH///////////////////////7///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////7////////////////////////////////////////////////////////////////fDwcgJs0////+/vz"], "wingR": [228, "DDTX00DDCO8o7+80SL+/SMNI03Rwz2TT18v//8v/8//z///v0///0//X/8fT/8v/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////n1BEhzCn////////"], "tail": [72, "GP8g//8gCAz//wzfHP//IBz/vwQcu58Eh4OHh0iH/8fP///DCOsI2/8IHBz//xz/AL+jABC//yQg//8kg4tch4+Hv///t9f/"]};
/* AO:END */
/* apply baked AO to a non-indexed vertex-coloured geometry (colour × (0.62 + 0.38·AO)); skipped if the vertex count does not match */
function applyAO(g, key) { const e = TORNIS_AO[key], C = g.getAttribute("color"); if (!e || !C || C.count !== e[0]) return false;
  const b = atob(e[1]); for (let i = 0; i < C.count; i++) { const k = 0.62 + 0.38 * b.charCodeAt(i) / 255; C.setXYZ(i, C.getX(i) * k, C.getY(i) * k, C.getZ(i) * k); } C.needsUpdate = true; return true; }
const MAT = new Map();
function vc(kind) { // vertex-coloured shared materials
  if (!MAT.has(kind)) MAT.set(kind, kind === "basic" ? new T.MeshBasicMaterial({ vertexColors: true }) :
    kind === "lamD" ? new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide }) : new T.MeshLambertMaterial({ vertexColors: true }));
  return MAT.get(kind);
}
function lam(hex, extra) { const k = "L" + hex + (extra ? JSON.stringify(extra) : ""); if (!MAT.has(k)) MAT.set(k, new T.MeshLambertMaterial(Object.assign({ color: new T.Color(hex) }, extra || {}))); return MAT.get(k); }
function basic(hex, extra) { const k = "B" + hex + (extra ? JSON.stringify(extra) : ""); if (!MAT.has(k)) MAT.set(k, new T.MeshBasicMaterial(Object.assign({ color: new T.Color(hex) }, extra || {}))); return MAT.get(k); }
/* inverted-hull ink outline: normals pushed out in the vertex shader, one program per width */
function hullMat(w, col) {
  const k = "H" + w + "|" + (col || INK);
  if (!MAT.has(k)) { const m = new T.MeshBasicMaterial({ color: new T.Color(col == null ? INK : col), side: T.BackSide });
    m.onBeforeCompile = s => { s.vertexShader = s.vertexShader.replace("#include <begin_vertex>", "vec3 transformed = vec3(position) + normal * " + w.toFixed(3) + ";"); };
    m.customProgramCacheKey = () => "dwhull" + w.toFixed(3); MAT.set(k, m); }
  return MAT.get(k);
}
/* wing material: Lambert × vertex colour, emissive = 0.55 × vertex colour (self-lit underside) – lets wing items merge into the wing mesh */
function wingVC() { if (!MAT.has("wingVC")) { const m = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide, emissive: new T.Color(0.55, 0.55, 0.55) });
  m.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace("vec3 totalEmissiveRadiance = emissive;", "vec3 totalEmissiveRadiance = emissive * vColor.rgb;"); };
  m.customProgramCacheKey = () => "dwwingvc"; MAT.set("wingVC", m); } return MAT.get("wingVC"); }
/* reverse triangle winding of a non-indexed geometry (needed after a mirroring transform so the BackSide ink hull stays behind) */
function flipWinding(g) { for (const k of ["position", "normal", "color"]) { const a = g.getAttribute(k); if (!a) continue; const v = a.array;
  for (let i = 0; i < v.length; i += 9) for (let j = 0; j < 3; j++) { const t = v[i + 3 + j]; v[i + 3 + j] = v[i + 6 + j]; v[i + 6 + j] = t; } a.needsUpdate = true; } return g; }
function withHull(geo, mat, w, parent, name) {
  const g = new T.Group(); if (name) g.name = name; const m = new T.Mesh(geo, mat); g.add(m);
  const h = new T.Mesh(geo, hullMat(w)); h.userData.hull = true; g.add(h); parent.add(g); return { g, m, h };
}

/* ============================================================
   1. TORNIS – COMMON SWIFT. Units = game px, origin = hitbox centre (r = 11), +x forward, y up, z = near side.
   Silhouette follows the original 2D drawing (identity.js, × 0.84): body ±20, beak tip ≈ 24.8, fork ≈ −31,
   near-wing tip far back-up. Variant A = sickle swift (recommended); B = mascot swift (bigger head/eyes).
   ============================================================ */
const PLANS = {
  tornisA: { kind: "swift", L: 20.5, H: 8.6, W: 7.8, tr: 0.62, tf: 0.18, headR: 7.4, head: [12.6, 1.8], eyeR: 3.7, eyeK: 0.62, beak: 4.6,
    span: 46, chordRoot: 10.5, sickle: 1.0, tailL: 15, fork: 0.62, tailSpread: 7.5, throat: true, brow: 0.18, anat: { elbow: 0.32, wrist: 0.58, primaries: 4, fLen: 0.7, fWid: 0.22, fanBack: 0.35 } },
  glod: { kind: "robin", L: 17.5, H: 11, W: 10.5, tr: 0.3, tf: 0.12, headR: 9, head: [11, 3.4], eyeR: 3.6, eyeK: 0.6, beak: 4.2,
    span: 30, chordRoot: 14, sickle: 0.1, tailL: 10, fork: 0.15, tailSpread: 5, throat: false, brow: 0.1, anat: { elbow: 0.4, wrist: 0.66, primaries: 5, fLen: 0.8, fWid: 0.24, fanBack: 0.65 } },
  frost: { kind: "tern", L: 21, H: 7.6, W: 7.2, tr: 0.7, tf: 0.15, headR: 6.6, head: [13, 1.6], eyeR: 3.0, eyeK: 0.6, beak: 7.5,
    span: 48, chordRoot: 9, sickle: 0.45, tailL: 21, fork: 0.85, tailSpread: 9, throat: false, brow: 0.05, anat: { elbow: 0.36, wrist: 0.62, primaries: 4, fLen: 0.8, fWid: 0.22, fanBack: 0.5 } }
};
const BIRD_PLAN = { tornis: "tornisA", sunny: "tornisA", guld: "tornisA", natt: "tornisA",
  neon: "tornisA", kosmos: "tornisA", lagoon: "tornisA", ang: "tornisA", glod: "glod", frost: "frost" };

function wingOutline(p) {
  const S = p.span, c = p.chordRoot, k = p.sickle;
  // leading edge: shoulder → bows forward → sweeps back to a sharp tip; trailing edge: concave sickle
  const tip = [-S * (0.45 + 0.3 * k), S];
  const lead = bez([c * 0.45, 0], [c * 0.6 + 2 * k, S * 0.32], [-S * (0.08 + 0.12 * k), S * 0.82], tip, 9);
  const trail = bez([-c * 0.55, 0], [-c * 0.7, S * 0.28], [-S * (0.2 + 0.25 * k), S * (0.62 + 0.1 * k)], tip, 9);
  return { lead, trail };
}
/* ---------- B-12 wing anatomy: joints (shoulder → elbow → wrist) and primary feathers, in the 2D outline space (x = chord, y = span) ---------- */
function edgeAt(poly, u) { for (let i = 0; i < poly.length - 1; i++) { const a = poly[i], b = poly[i + 1]; if (u <= b[1] || i === poly.length - 2) { const k = (u - a[1]) / ((b[1] - a[1]) || 1); return [a[0] + (b[0] - a[0]) * k, u, b[0] - a[0], b[1] - a[1]]; } } return poly[poly.length - 1]; }
function wingJoints(p, lead, trail) { const S = p.span, A = p.anat || {}, uE = S * (A.elbow || 0.36), uW = S * (A.wrist || 0.64);
  const mid = u => (edgeAt(lead, u)[0] + edgeAt(trail, u)[0]) / 2; return { uE, uW, xE: mid(uE), xW: mid(uW), dE: S * 0.07, dW: S * 0.06 }; }
function featherSpec(p, lead, trail) { const A = p.anat || {}, n = A.primaries || 4, S = p.span, out = [];
  for (let k = 0; k < n; k++) { const u = S * (0.6 + 0.36 * k / Math.max(1, n - 1)), te = edgeAt(trail, u), le = edgeAt(lead, u), chord = Math.max(2.5, le[0] - te[0]);
    const tl = Math.hypot(te[2], te[3]) || 1, tx = te[2] / tl, ty = te[3] / tl, back = A.fanBack == null ? 0.55 : A.fanBack; // edge direction rotated toward the trailing side
    let dx = tx * (1 - back) - back, dy = ty * (1 - back) + 0.15 * back; const dl = Math.hypot(dx, dy); dx /= dl; dy /= dl;
    const L = chord * (A.fLen || 0.75) * (1 - 0.25 * k / n) + 2, w = chord * (A.fWid || 0.26) + 0.8;
    out.push({ root: [te[0] + chord * 0.12, u], dir: [dx, dy], L, w, u }); }
  return out; }
function featherGeo(f, k, col, mirror) { const [rx, ry] = f.root, [dx, dy] = f.dir, px = -dy, py = dx, L = f.L, w = f.w;
  const a0 = [rx - dx * L * 0.35 + px * w / 2, ry - dy * L * 0.35 + py * w / 2], b0 = [rx - dx * L * 0.35 - px * w / 2, ry - dy * L * 0.35 - py * w / 2], tip = [rx + dx * L * 0.65, ry + dy * L * 0.65];
  const c = new T.Color(col).multiplyScalar(0.84 - 0.03 * k);
  const g = slabPart([a0, tip], [b0, tip], 0.6, trs(0, 0, -0.35 - 0.12 * k), "#" + c.getHexString()); g.rotateX(Math.PI / 2); if (mirror) { g.scale(1, 1, -1); flipWinding(g); } return g; }
function makeSwift(pal, planId, opts) {
  opts = opts || {};
  const p = PLANS[planId] || PLANS.tornisA;
  const [body, dark, wing, far, belly, scarf, iris] = pal;
  const root = new T.Group(), rig = new T.Group(); root.add(rig); root.name = "studioBird:" + planId;
  /* opts.hi = reference tessellation (for the optimisation report); default = optimised game mesh (~1.3–1.5k tris) */
  const hi = !!opts.hi, seg = hi ? [16, 11] : [14, 10], hseg = hi ? [12, 8] : [10, 8], sseg = hi ? [10, 7] : [8, 6];
  // --- merged body: torpedo + head + belly + throat + beak (1 mesh + 1 hull)
  const parts = [];
  parts.push(part(torpedo(seg[0], seg[1], p.L, p.H, p.W, p.tr, p.tf), trs(-1.5, 0, 0), body));
  parts.push(part(new T.SphereGeometry(1, hseg[0], hseg[1]), trs(p.head[0], p.head[1], 0, 0, 0, 0, p.headR, p.headR * 0.92, p.headR * 0.95), body));
  // pale throat patch (common swift) / belly band (Tornis cream) — pushed slightly out so it reads
  if (p.throat) parts.push(part(new T.SphereGeometry(1, sseg[0], sseg[1]), trs(p.head[0] + p.headR * 0.42, p.head[1] - p.headR * 0.52, 0, 0, 0, 0.25, p.headR * 0.62, p.headR * 0.42, p.headR * 0.72), belly));
  parts.push(part(torpedo(hi ? 12 : 10, hi ? 8 : 7, p.L * 0.72, p.H * 0.62, p.W * 0.78, p.tr * 1.2, p.tf), trs(1.6, -p.H * 0.36, 0), belly));
  const beakG = new T.ConeGeometry(p.headR * 0.26, p.beak, 6); beakG.rotateZ(-Math.PI / 2);
  parts.push(part(beakG, trs(p.head[0] + p.headR * 0.86 + p.beak * 0.42, p.head[1] - p.headR * 0.18, 0), "#3A2E4F"));
  const bodyGeo = merge(parts); const ao = planId === "tornisA" && !hi && !opts.noAO; if (ao) applyAO(bodyGeo, "body");
  const bodyM = withHull(bodyGeo, vc("lam"), 0.55, rig, "body");
  // --- eyes (unlit, merged per eye; big and expressive: white, iris, pupil, glint, brow)
  const eyes = [], eyeParts = [];
  const eyeG = new T.Group(); eyeG.position.set(p.head[0] + p.headR * 0.38, p.head[1] + p.headR * 0.2, 0); rig.add(eyeG); eyes.push(eyeG);
  for (const zs of [1, -1]) {
    const ez = zs * p.headR * p.eyeK;
    const ep = [];
    if (hi) {
      ep.push(part(new T.SphereGeometry(1, 12, 9), trs(0, 0, 0, 0, 0, 0, p.eyeR, p.eyeR * 1.08, p.eyeR * 0.62), "#FFFFFF"));
      ep.push(part(new T.SphereGeometry(1, 10, 7), trs(p.eyeR * 0.28, 0.1, zs * p.eyeR * 0.34, 0, 0, 0, p.eyeR * 0.6, p.eyeR * 0.66, p.eyeR * 0.36), iris));
      ep.push(part(new T.SphereGeometry(1, 8, 6), trs(p.eyeR * 0.42, 0.1, zs * p.eyeR * 0.5, 0, 0, 0, p.eyeR * 0.32, p.eyeR * 0.36, p.eyeR * 0.22), "#1A1433"));
      ep.push(part(new T.SphereGeometry(1, 6, 4), trs(p.eyeR * 0.55, p.eyeR * 0.4, zs * p.eyeR * 0.6, 0, 0, 0, p.eyeR * 0.13), "#FFFFFF"));
    } else { // optimised: white ellipsoid + flat iris/pupil discs + ico glint (≈ 230 tris per eye instead of ≈ 440)
      ep.push(part(new T.SphereGeometry(1, 10, 7), trs(0, 0, 0, 0, 0, 0, p.eyeR, p.eyeR * 1.08, p.eyeR * 0.62), "#FFFFFF"));
      ep.push(part(new T.CylinderGeometry(1, 1, 1, 12), trs(p.eyeR * 0.26, 0.1, zs * p.eyeR * 0.5, Math.PI / 2, 0, 0, p.eyeR * 0.6, p.eyeR * 0.3, p.eyeR * 0.66), iris));
      ep.push(part(new T.CylinderGeometry(1, 1, 1, 10), trs(p.eyeR * 0.36, 0.1, zs * p.eyeR * 0.62, Math.PI / 2, 0, 0, p.eyeR * 0.33, p.eyeR * 0.2, p.eyeR * 0.37), "#1A1433"));
      ep.push(part(new T.IcosahedronGeometry(1, 0), trs(p.eyeR * 0.5, p.eyeR * 0.38, zs * p.eyeR * 0.7, 0, 0, 0, p.eyeR * 0.14), "#FFFFFF"));
    }
    const bl = [[-p.eyeR * 0.9, p.eyeR * 1.05], [p.eyeR * 0.9, p.eyeR * (1.05 + p.brow * 3)]], bt = [[-p.eyeR * 0.9, p.eyeR * 0.82], [p.eyeR * 0.9, p.eyeR * (0.85 + p.brow * 3)]];
    ep.push(slabPart(bl, bt, 0.8, trs(0, 0, zs * p.eyeR * 0.45), "#1A1433"));
    const eg = merge(ep); eg.translate(0, 0, ez); eyeParts.push(eg);
  }
  eyeG.add(new T.Mesh(merge(eyeParts), vc("basic"))); // r2.2: both eyes merged (was 2 meshes)
  // --- wings: long pointed sickle slabs, pivot at the shoulder, span along +z (near) / −z (far)
  const { lead, trail } = wingOutline(p);
  const wingGeoFor = (col, mirror) => { const g = slabPart(lead, trail, 1.3, null, col); g.rotateX(Math.PI / 2); if (mirror) { g.scale(1, 1, -1); flipWinding(g); } return g; };
  const FS = featherSpec(p, lead, trail); // B-12: primary feathers (separate slabs, skinned individually)
  // the camera mostly sees the UNDERSIDE of the raised near wing (as the 2D drawing does) → self-lit wing material so it keeps the wing colour
  const wingMat = () => wingVC();
  const wings = [];
  for (const zs of [1, -1]) {
    const piv = new T.Group(); piv.position.set(0.6, p.H * 0.55, zs * p.W * 0.55); rig.add(piv); // B-12: shoulder on the back, behind the head (the wing is now seen face-on)
    const wg = new T.Group(); piv.add(wg);
    if (FW_PLANS[planId] && !opts.slab) { piv.matrixAutoUpdate = false; wings.push(piv); continue; } // B-12b: feather wing (built below), pivot follows the forearm
    let wgeo = wingGeoFor(zs > 0 ? wing : far, zs < 0); if (ao) applyAO(wgeo, zs > 0 ? "wingL" : "wingR");
    const slabN = wgeo.getAttribute("position").count, fparts = FS.map((f, k) => featherGeo(f, k, zs > 0 ? wing : far, zs < 0));
    const fRanges = []; let at = slabN; for (const g of fparts) { const n = g.getAttribute("position").count; fRanges.push([at, n]); at += n; }
    wgeo = merge([wgeo, ...fparts]);
    const wh = withHull(wgeo, wingMat(zs > 0 ? wing : far), 0.6, wg, "wing");
    wh.m.frustumCulled = wh.h.frustumCulled = false; // B-12: vertices move every frame (CPU skin) – never cull on the rest-pose bounds
    wh.m.userData.skinInfo = { side: zs, span: p.span, joints: wingJoints(p, lead, trail), feathers: FS.map((f, k) => ({ range: fRanges[k], root: f.root, u: f.u })) };
    wings.push(piv);
  }
  // --- tail: characteristic fork, two blades (vertical spread reads from the side, slight z splay)
  const tail = new T.Group(); tail.position.set(-p.L * 0.86, 0.4, 0); rig.add(tail);
  const tl = p.tailL, sp = p.tailSpread, nd = tl * (1 - p.fork);
  const up = slabPart([[0, 2], [-tl, sp]], [[0, 0], [-nd, 0.6]], 1.6, trs(0, 0, 0, 0.0, 0.12, 0), dark);
  const dn = slabPart([[0, 0], [-nd, -0.6]], [[0, -2], [-tl, -sp]], 1.6, trs(0, 0, 0, 0.0, -0.12, 0), dark);
  const tgeo = merge([up, dn]); if (ao) applyAO(tgeo, "tail"); withHull(tgeo, vc("lamD"), 0.55, tail, "tail");
  // --- sockets derived from the plan (same names as render3d.js, plus back2/trail/fx)
  const sock = {};
  const mk = (name, parent, x, y, z) => { const o = new T.Object3D(); o.name = "socket:" + name; o.position.set(x, y, z); parent.add(o); sock[name] = o; return o; };
  const neckX = p.head[0] - p.headR * 0.65, nf = 1 - p.tf * Math.pow((neckX + 1.5) / p.L, 2) * (neckX > -1.5 ? 1 : 0);
  const metrics = { headR: p.headR, eyeR: p.eyeR, eyeZ: p.headR * p.eyeK, neckY: p.H * nf * 0.98, neckZ: p.W * nf * 0.98, bodyH: p.H, chord: p.chordRoot, span: p.span, tailL: p.tailL };
  mk("head", rig, p.head[0] - 0.5, p.head[1] + p.headR * 0.86, 0);
  mk("eyes", rig, p.head[0] + p.headR * 0.38, p.head[1] + p.headR * 0.2, 0);
  mk("neck", rig, neckX, p.head[1] * 0.35, 0).rotation.z = 0.32;
  mk("back", rig, -5, p.H * 0.88, 0);
  mk("tail", tail, -2.5, 0.6, p.W * 0.32);
  // wing band socket: centre of the chord at ~56 % span, oriented along the local chord (lead[5] ↔ trail[5])
  const la = lead[5], ta = trail[5], bandLen = Math.hypot(la[0] - ta[0], la[1] - ta[1]) * 1.25, bandRot = Math.atan2(la[1] - ta[1], la[0] - ta[0]);
  metrics.bandLen = bandLen;
  let fw = null;
  if (FW_PLANS[planId] && !opts.slab) { // B-12b: band on the forearm (both sockets authored on the near side; the far pivot gets the mirrored forearm frame)
    const fb = FW_PLANS[planId].bones; metrics.bandLen = 9.5;
    mk("wingL", wings[0].children[0], -1.4, 0.9, fb.fore * 0.55).rotation.y = Math.PI / 2; mk("wingR", wings[1].children[0], -1.4, 0.9, fb.fore * 0.55).rotation.y = Math.PI / 2;
    fw = buildFeatherWings({ rig, plan: planId }, pal); fw.sock = [[wings[0], 1], [wings[1], -1]]; poseFeather(fw, { phi: 0, w: 0, profile: FLIGHT_BASE[planId] || FLIGHT_BASE.tornisA });
  } else {
  mk("wingL", wings[0].children[0], (la[0] + ta[0]) / 2, 0, (la[1] + ta[1]) / 2).rotation.y = -bandRot;
  mk("wingR", wings[1].children[0], (la[0] + ta[0]) / 2, 0, -(la[1] + ta[1]) / 2).rotation.y = bandRot; }
  mk("trail", rig, -p.L - 2, 0, 0);
  mk("fx", rig, 0, 0, 0);
  const hulls = []; root.traverse(o => { if (o.userData.hull) hulls.push(o); });
  return { root, rig, parts: { body: bodyM, eyes, wingL: wings[0], wingR: wings[1], tail }, sockets: sock, metrics, hulls, equip: {}, plan: planId, p, fw };
}
function triCount(obj, withHulls) { let t = 0; obj.traverse(o => { if (o.isMesh && (withHulls || !o.userData.hull)) { const g = o.geometry, per = (g.index ? g.index.count : g.getAttribute("position").count) / 3; t += per * (o.isInstancedMesh ? Math.max(0, o.count || 0) : 1); } }); return Math.round(t); }
function meshCount(obj, withHulls) { let n = 0; obj.traverse(o => { if (o.isMesh && (withHulls || !o.userData.hull)) n++; }); return n; }

/* ---------- 2. equipment, authored once in socket space, sized by the bird's metrics ---------- */
const cyl = (n) => new T.CylinderGeometry(1, 1, 1, n || 12);
const ITEMS = {
  straw: { slot: "head", build(m) { const k = m.headR / 7.4, g = [];
    g.push(part(cyl(14), trs(0, 0.6 * k, 0, 0, 0, 0, 8.6 * k, 1.1 * k, 8.6 * k), "#F2D14B"));
    g.push(part(cyl(12), trs(0, 3.4 * k, 0, 0, 0, 0, 4.4 * k, 5 * k, 4.4 * k), "#F2D14B"));
    g.push(part(cyl(12), trs(0, 1.9 * k, 0, 0, 0, 0, 4.6 * k, 1.6 * k, 4.6 * k), "#FF6B4A")); return merge(g); } },
  beanie: { slot: "head", build(m) { const k = m.headR / 7.4; return merge([part(new T.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), trs(0, -1 * k, 0, 0, 0, 0, 6.8 * k, 6.2 * k, 6.8 * k), "#4AA8FF"),
    part(new T.SphereGeometry(1, 8, 6), trs(0, 5.6 * k, 0, 0, 0, 0, 2.4 * k), "#FFFFFF")]); } },
  crown: { slot: "head", build(m) { const k = m.headR / 7.4, g = [part(cyl(10), trs(0, 1.6 * k, 0, 0, 0, 0, 5 * k, 3 * k, 5 * k), "#F2C14E")];
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; g.push(part(new T.ConeGeometry(1, 1, 4), trs(Math.cos(a) * 4.2 * k, 4.8 * k, Math.sin(a) * 4.2 * k, 0, 0, 0, 1.5 * k, 3.8 * k, 1.5 * k), "#F2C14E")); }
    g.push(part(new T.SphereGeometry(1, 6, 4), trs(5 * k, 1.8 * k, 0, 0, 0, 0, 1.3 * k), "#FF6B4A")); return merge(g); } },
  propeller: { slot: "head", build(m) { const k = m.headR / 7.4; return merge([part(new T.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), trs(0, -0.6 * k, 0, 0, 0, 0, 5.6 * k, 4.2 * k, 5.6 * k), "#FF6B4A"),
    part(cyl(6), trs(0, 4.4 * k, 0, 0, 0, 0, 0.7 * k, 3 * k, 0.7 * k), "#FFB830"), part(new T.BoxGeometry(1, 1, 1), trs(0, 6.2 * k, 0, 0, 0.6, 0, 12 * k, 0.6 * k, 2.2 * k), "#FFB830")]); } },
  /* goggles: lens rings sit ON the eyes (eye socket z = ±eyeZ, lens radius from eyeR) – fixes the "too low on Glöd" bug of v0.1 */
  goggles: { slot: "eyes", build(m) { const g = [], r = m.eyeR * 1.12;
    for (const zs of [1, -1]) { g.push(part(cyl(14), trs(0, 0, zs * (m.eyeZ + m.eyeR * 0.55), Math.PI / 2, 0, 0, r, 1.1, r), "#8A5A2B"));
      g.push(part(cyl(14), trs(0, 0, zs * (m.eyeZ + m.eyeR * 0.62), Math.PI / 2, 0, 0, r * 0.74, 1.1, r * 0.74), "#8DF2DC")); }
    g.push(part(cyl(16), trs(-m.headR * 0.45, 0, 0, 0, 0, 0, m.headR * 0.92, 1.4, m.headR * 1.02), "#5B3A1A")); return merge(g); } },
  backpack: { slot: "back", build(m) { const k = m.bodyH / 8.6; return merge([part(new T.BoxGeometry(1, 1, 1), trs(0, 2.2 * k, 0, 0, 0, 0, 9 * k, 4.6 * k, 7.5 * k), "#FF6B4A"),
    part(new T.BoxGeometry(1, 1, 1), trs(2.6 * k, 3.6 * k, 0, 0, 0, 0, 4 * k, 2.6 * k, 7.9 * k), "#FFB830"),
    part(cyl(8), trs(-4.8 * k, 2.6 * k, 0, Math.PI / 2, 0, 0, 1.6 * k, 7.6 * k, 1.6 * k), "#C9D2FF")]); } },
  wingband: { slot: "wing", build(m) { return merge([part(new T.BoxGeometry(1, 1, 1), trs(0, 0, 0, 0, 0, 0, 3.4, 2.6, m.bandLen), "#FFD45E")]); } },
  /* tail ribbon: bigger bow + two streamers (v0.1 ribbon was too small to read at gameplay scale) */
  ribbon: { slot: "tail", build(m) { const g = [];
    g.push(part(new T.SphereGeometry(1, 8, 6), trs(0, 0, 0, 0, 0, 0, 3.2, 3.2, 3.2), "#FF6B4A"));
    for (const s of [1, -1]) { g.push(part(new T.ConeGeometry(1, 1, 4), trs(2.2, s * 4.6, 0, 0, 0, s * 1.15, 4.2, 8.0, 2.0), "#FF6B4A"));
      g.push(slabPart([[0, s * 1.2], [-9, s * 6], [-17, s * 8.5]], [[0, s * -0.8], [-9, s * 2.4], [-16, s * 4.2]], 1.4, null, "#FFB830")); }
    return merge(g); } }
};
const GEAR_PRESETS = { off: [], hat: ["straw", "goggles"], full: ["straw", "goggles", "backpack", "wingband", "ribbon"], crown: ["crown", "ribbon"], prop: ["propeller", "goggles", "backpack"] };
function equipItem(bird, id) {
  const def = ITEMS[id]; if (!def) return null;
  const slots = def.slot === "wing" ? ["wingL", "wingR"] : [def.slot]; const out = [];
  for (const sl of slots) { const geo = def.build(bird.metrics); const grp = withHull(geo, vc("lam"), 0.45, bird.sockets[sl], "item:" + id).g;
    if (sl === "wingR") grp.scale.y = -1; out.push(grp); bird.hulls.push(...grp.children.filter(c => c.userData.hull)); }
  return out;
}
function buildScarf(bird, col, col2) {
  const m = bird.metrics, g = new T.Group(); g.name = "scarf";
  const ring = [part(cyl(14), trs(0, 0, 0, 0, 0, Math.PI / 2, m.neckY + 1.2, 4.2, m.neckZ + 1.2), col)];
  if (col2) ring.push(part(cyl(14), trs(0, 0, 0, 0, 0, Math.PI / 2, m.neckY + 1.35, 1.4, m.neckZ + 1.35), col2));
  withHull(merge(ring), vc("lam"), 0.45, g);
  const tails = new T.Group(); tails.name = "scarfTails"; tails.position.set(-1.5, m.neckY * 0.6, m.neckZ * 0.7); g.add(tails);
  const tm = new T.Mesh(scarfTailsGeo(col, col2), vc("lam")); tm.frustumCulled = false; tails.add(tm); // B-12b: volumetric ribbons (see poseScarfTails)
  return g;
}

/* ============================================================
   B-12 FLIGHT ANIMATION (shared by every bird, render-only). Root cause of the "shrinking wings" (checkpoints/B12.md):
   the old rig swung one rigid wing slab about the body's long axis, i.e. towards/away from the near-orthographic side
   camera, so its projected length followed sin(elevation): 27→58 px on Tornis (min/max 0.47), far wing 0.25.
   New system: the wing plane stays facing the camera (constant small lean), the stroke is a rotation in that plane from
   the shoulder, the hand bends at the elbow and the wrist (fold on the upstroke, lag behind the motion), primary feathers
   rotate individually with a phase offset, the body bobs/pitches with the stroke. Bone lengths never change; only the
   deliberate upstroke/dive fold shortens the span. Inputs: the flap event (B.since restarting), B.vy, S.time — the same
   presentation copy the old pose used. Never touches S, physics or the hitbox (the rig is a child of the bird root).
   Each bird has its own flight character (FLIGHT table). Reduced motion: one soft beat per tap, smaller amplitude, no bob,
   no feather flutter, no idle/glide oscillation, static menu pose.
   ============================================================ */
const FLIGHT_DEFAULTS = { twist0: 0.3 }; // constant feathering; 0.5 cost 7 % projected span (metric 19 nov)
const FLIGHT_BASE = {
  // tip elevation above horizontal-back (deg) for the stroke top/bottom, glide and dive; hz = wingbeats/s; beats per tap;
  // dsf = downstroke share of the cycle; fold (0..1 of foldE/foldW rad) on the upstroke; lag = hand lag (rad); feather = primary flutter (rad)
  // These flight values are restored to the approved O2 feather-wing motion. Keep the approved Tornis stroke at 100° (66° / −34°).
  tornisA: { top: 66, bot: -34, glide: 18, dive: 6, hz: 9, beats: 2, dsf: 0.55, foldE: 0.10, foldW: 0.10, diveFold: 0.85, lag: 0.06, feather: 0.06,
    tilt: 0.08, twist: 0.03, bob: 0.35, pitch: 0.03, glideOsc: 0.025, glideFold: 0.22, spread: 0.04 }, // swift: approved O2 flight profile
  glod: { top: 70, bot: -32, glide: 22, dive: 2, hz: 11, beats: 3, dsf: 0.55, foldE: 0.30, foldW: 0.42, diveFold: 0.92, lag: 0.12, feather: 0.10,
    tilt: 0.06, twist: 0.05, bob: 0.8, pitch: 0.06, glideOsc: 0.02, glideFold: 0.30, spread: 0.09 },    // robin: O2 glide/fold profile restored
  frost: { top: 66, bot: -26, glide: 30, dive: 8, hz: 4.8, beats: 2, dsf: 0.56, foldE: 0.18, foldW: 0.26, diveFold: 0.65, lag: 0.16, feather: 0.1,
    tilt: 0.08, twist: 0.05, bob: 0.5, pitch: 0.045, glideOsc: 0.03, glideFold: 0.08, spread: 0.06 }  // tern: O2 glide/fold profile restored
};
const FLIGHT_BIRD = { // individual flight character per skin; species baselines live in FLIGHT_BASE
  tornis: {}, sunny: { hz: 8.4, glideOsc: 0.032 }, guld: { hz: 7.8, top: 62, bot: 2, lag: 0.08 }, natt: { hz: 7, lag: 0.1, feather: 0.09, bob: 0.3 },
  neon: { hz: 10.5, beats: 3, top: 54, bot: 10, lag: 0.04 }, kosmos: { hz: 6.6, beats: 2, glideOsc: 0.05, top: 62, bot: 0, feather: 0.08 },
  lagoon: { hz: 8, lag: 0.09, bot: 2 }, ang: { hz: 9.6, glideOsc: 0.035, spread: 0.05 },
  glod: { hz: 11.4, beats: 3, lag: 0.15, feather: 0.12, bob: 0.95, pitch: 0.07 }, // species glide/fold values live in FLIGHT_BASE.glod
  frost: { hz: 4.4, beats: 2, lag: 0.2, feather: 0.08, bob: 0.42, glideOsc: 0.018, spread: 0.045 } // tern: slow, broad strokes and long glides
};
/* 6b (Martin t161u, "the wingbeat could be calmed down a bit"): one global calm factor on the visual flight timing for all
   species. Wingbeat frequency −25 %, body bob/pitch and primary flutter −20 %. The approved stroke angles (Tornis 66°/−34°)
   and beats per tap are unchanged, so a tap still enters the downstroke in the same frame. Never touches S or physics. */
const FLIGHT_CALM = { hz: 0.75, body: 0.8 };
const D2R = Math.PI / 180, TAU2 = Math.PI * 2;
const sstep = x => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
function flightParams(b, palId, rm) {
  const k = palId + "|" + b.plan + "|" + (rm ? 1 : 0); if (b._flk === k) return b._flp;
  const P = Object.assign({}, FLIGHT_DEFAULTS, FLIGHT_BASE[b.plan] || FLIGHT_BASE.tornisA, FLIGHT_BIRD[palId] || {});
  P.hz *= FLIGHT_CALM.hz; P.bob *= FLIGHT_CALM.body; P.pitch *= FLIGHT_CALM.body; P.feather *= FLIGHT_CALM.body; // 6b: calmer wingbeat for every species (visual timing only)
  const sk = b.p.sickle, sweep = Math.atan2(b.p.span * (0.45 + 0.3 * sk), b.p.span) / D2R; // tip direction vs. span axis (sickle)
  const th = e => (90 - e - sweep) * D2R; // tip elevation → stroke angle (rotation in the wing plane, 0 = span axis up)
  if (rm) { const m = (P.top + P.bot) / 2, a = (P.top - P.bot) / 2 * 0.6; P.top = m + a; P.bot = m - a; P.hz *= 0.75; P.beats = 1; P.bob = 0; P.pitch = 0; P.feather = 0; P.glideOsc = 0; P.lag *= 0.6; }
  P.thTop = th(P.top); P.thBot = th(P.bot); P.thGlide = th(P.glide); P.thDive = th(P.dive);
  P.mean = (P.thTop + P.thBot) / 2; P.amp = (P.thBot - P.thTop) / 2;
  // phase on the downstroke where the stroke passes the glide angle: a tap starts there, so the pose is continuous
  const c = Math.max(-1, Math.min(1, -(P.thGlide - P.mean) / P.amp)); P.phi0 = Math.acos(c) / TAU2 * 2 * P.dsf; // g = phi/(2 dsf) on the downstroke
  b._flk = k; b._flp = P; return P;
}
function strokeAt(P, phi) { // phi ∈ [0,1): 0 = top; downstroke takes dsf of the cycle. Returns angle, upstroke fold 0..1, normalised velocity −1..1
  const f = phi - Math.floor(phi), g = f < P.dsf ? 0.5 * f / P.dsf : 0.5 + 0.5 * (f - P.dsf) / (1 - P.dsf);
  const th = P.mean - P.amp * Math.cos(TAU2 * g), dg = f < P.dsf ? 0.5 / P.dsf : 0.5 / (1 - P.dsf);
  const vel = Math.sin(TAU2 * g) * dg * P.dsf * 2; // dθ/dφ / (π·amp/dsf), +1 ≈ peak downstroke speed
  const fold = g > 0.5 ? Math.pow(Math.sin(Math.PI * (g - 0.5) * 2), 2) : 0;
  return { th, fold, vel, g };
}
const QGP = new T.Quaternion().setFromEuler(new T.Euler(0.24, -0.3, 0)).invert(); // gameplay rig yaw/bank: the wing plane is defined in the bird-root frame
const _qa = new T.Quaternion(), _qb = new T.Quaternion(), _ex = new T.Vector3(1, 0, 0), _ey = new T.Vector3(0, 1, 0), _ez = new T.Vector3(0, 0, 1);
function wingQuat(out, side, th, tilt, twist) { // root-space orientation: Rz(th) · Rx(±tilt) · Ry(±twist) · Rx(∓π/2)  (span axis → +y, lean towards/away from the camera)
  out.setFromAxisAngle(_ez, th); _qa.setFromAxisAngle(_ex, side * tilt); out.multiply(_qa); _qa.setFromAxisAngle(_ey, side * twist); out.multiply(_qa);
  _qa.setFromAxisAngle(_ex, -side * Math.PI / 2); out.multiply(_qa); return out.premultiply(QGP); }
function skinWing(mesh, aE, aW, bE, fAng) { // CPU skin in the wing-geometry frame (x = chord, z = ±span, y = normal); angles are tip-forward positive
  const info = mesh.userData.skinInfo; if (!info) return; const geo = mesh.geometry, pa = geo.getAttribute("position"), na = geo.getAttribute("normal");
  let sk = mesh.userData.skin;
  if (!sk || sk.geo !== geo) { // (re)build after baking: base pose + per-vertex span weights + feather index
    const n = pa.count, J = info.joints, sd = info.side, base = pa.array.slice(), nb = na.array.slice(), wE = new Float32Array(n), wW = new Float32Array(n), fk = new Int8Array(n).fill(-1);
    for (const [k, f] of info.feathers.entries()) for (let i = f.range[0]; i < f.range[0] + f.range[1]; i++) fk[i] = k;
    for (let i = 0; i < n; i++) { const u = fk[i] >= 0 ? info.feathers[fk[i]].u : sd * base[i * 3 + 2]; wE[i] = sstep((u - J.uE + J.dE) / (2 * J.dE)); wW[i] = sstep((u - J.uW + J.dW) / (2 * J.dW)); }
    sk = mesh.userData.skin = { geo, base, nb, wE, wW, fk, n }; }
  const J = info.joints, sd = info.side, P = pa.array, N = na.array, B = sk.base, NB = sk.nb, zE = sd * J.uE, zW = sd * J.uW;
  for (let i = 0; i < sk.n; i++) {
    let x = B[i * 3], y = B[i * 3 + 1], z = B[i * 3 + 2], nx = NB[i * 3], ny = NB[i * 3 + 1], nz = NB[i * 3 + 2], c, s, t;
    const k = sk.fk[i];
    if (k >= 0) { const f = info.feathers[k], a = sd * fAng[k], rx = f.root[0], rz = sd * f.root[1]; c = Math.cos(a); s = Math.sin(a); // feather about its own root (in-plane)
      const dx = x - rx, dz = z - rz; x = rx + dx * c + dz * s; z = rz - dx * s + dz * c; t = nx * c + nz * s; nz = -nx * s + nz * c; nx = t; }
    const ww = sk.wW[i], we = sk.wE[i];
    if (ww > 0) { const a = sd * aW * ww; c = Math.cos(a); s = Math.sin(a); const dx = x - J.xW, dz = z - zW; x = J.xW + dx * c + dz * s; z = zW - dx * s + dz * c; t = nx * c + nz * s; nz = -nx * s + nz * c; nx = t; }
    if (we > 0) { let a = sd * aE * we; c = Math.cos(a); s = Math.sin(a); let dx = x - J.xE, dz = z - zE; x = J.xE + dx * c + dz * s; z = zE - dx * s + dz * c; t = nx * c + nz * s; nz = -nx * s + nz * c; nx = t;
      a = sd * bE * we; c = Math.cos(a); s = Math.sin(a); dz = z - zE; const y2 = y * c - dz * s; z = zE + y * s + dz * c; y = y2; t = ny * c - nz * s; nz = ny * s + nz * c; ny = t; } // out-of-plane camber at the elbow
    P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z; N[i * 3] = nx; N[i * 3 + 1] = ny; N[i * 3 + 2] = nz;
  }
  pa.needsUpdate = true; na.needsUpdate = true;
}
const wingMeshOf = piv => { let m = null; piv.traverse(n => { if (!m && n.isMesh && !n.userData.hull && n.userData.skinInfo) m = n; }); return m; };
/* state machine (presentation only): continuous cycle counter, flap weight w, smoothed dive/dead blends */
function flyPose(bird, B, t, rm) {
  const P = flightParams(bird, B.palId, rm), F = bird.fly || (bird.fly = { cyc: 0, end: 0, w: 0, wl: 0, dive: 0, dead: 0, last: null, tp: null });
  let dt = F.tp == null ? 0 : t - F.tp; if (dt < 0 || dt > 0.5) { dt = 0; F.w = F.wl = 0; F.cyc = F.end = Math.floor(F.cyc); } dt = Math.min(dt, 0.05); F.tp = t;
  const menu = !!B.menu, dead = !!B.dead;
  const tap = !menu && !dead && B.since != null && (F.last == null || B.since < F.last - 1e-4); F.last = menu || dead ? null : B.since;
  if (tap) { if (F.wl < 0.05 && F.cyc >= F.end) { F.cyc = Math.floor(F.cyc) + 1 + P.phi0; F.end = Math.floor(F.cyc) + P.beats; } // from glide: enter the downstroke at the glide angle (continuous)
    else F.end = Math.max(F.end, (F.cyc >= F.end ? F.cyc : Math.ceil(F.cyc)) + P.beats - (F.cyc >= F.end ? 0 : 1)); } // mid-beat or fading: keep the phase, add beats
  const hover = menu && !rm, hz = hover ? P.hz * 0.4 : P.hz;
  if (hover && F.cyc + 1 > F.end) F.end = Math.floor(F.cyc) + 2;
  const active = F.cyc < F.end;
  if (active) F.cyc = Math.min(F.end, F.cyc + dt * hz); // beats end on the stroke top (zero velocity), then w eases the top pose into the glide pose
  F.wl = active ? Math.min(1, F.wl + dt / 0.05) : Math.max(0, F.wl - dt / (rm ? 0.1 : 0.16)); F.w = sstep(F.wl);
  const diveT = dead || menu ? 0 : sstep(((B.vy || 0) - 260) / 200); F.dive += (diveT - F.dive) * Math.min(1, dt * 12); if (dt === 0) F.dive = diveT;
  F.dead += ((dead ? 1 : 0) - F.dead) * Math.min(1, dt * 10); if (dt === 0) F.dead = dead ? 1 : 0;
  const osc = rm ? 0 : P.glideOsc * Math.sin(t * TAU2 * 0.55);
  // base (glide ↔ dive ↔ dead) pose
  const thBase = P.thGlide + osc + (P.thDive - P.thGlide) * F.dive + (125 * D2R - P.thGlide) * F.dead;
  const foldBase = P.glideFold + (P.diveFold - P.glideFold) * F.dive + (0.35 - P.glideFold) * F.dead;
  const st = strokeAt(P, F.cyc), amp = hover ? 0.7 : 1, w = F.w * (1 - F.dead);
  const thS = P.mean + (st.th - P.mean) * amp + (hover ? (P.thGlide - P.mean) * 0.4 : 0);
  const th = thBase + (thS - thBase) * w, fold = foldBase + (st.fold * amp - foldBase) * w, vel = st.vel * w * amp;
  const tilt = P.tilt + 0.03 * w * Math.sin(TAU2 * st.g), twist = P.twist0 - P.twist * vel; // twist0: constant feathering about the span axis (slimmer, shaded planform; span length unaffected)
  const aE = -P.foldE * fold + P.lag * 0.4 * vel, aW = -P.foldW * fold + P.lag * 0.6 * vel, bE = 0.04 + 0.03 * w * Math.cos(TAU2 * st.g);
  const nF = (bird.p.anat && bird.p.anat.primaries) || 4, fAng = [];
  for (let k = 0; k < nF; k++) { const c = k - (nF - 1) / 2; fAng.push(P.spread * c * (1 - fold * 0.8) - 0.05 * fold * k + P.feather * w * Math.sin(TAU2 * (F.cyc - 0.08 * k)) + P.lag * 0.5 * vel * (k + 1) / nF + (rm ? 0 : 0.012 * (1 - w) * Math.sin(t * 7.3 + k * 1.7))); }
  if (bird.fw) { // B-12b feather wing: same state machine (phase, flap weight, dive, dead, hover, reduced motion)
    poseFeather(bird.fw, { phi: F.cyc, w: F.w, dive: F.dive, dead: F.dead, amp: amp * (rm ? 0.6 : 1), rm, t, glideOsc: osc, profile: P });
    const g = bird.fw.out.g; bird.flyBob = P.bob * 2 * w * -Math.cos(TAU2 * g) * amp * (rm ? 0 : 1); bird.flyPitch = P.pitch * w * Math.sin(TAU2 * (g - 0.1)) * amp * (rm ? 0 : 1);
    F.out = { th, fold: bird.fw.out.fold, w, dive: F.dive, cyc: F.cyc, tap, vel: bird.fw.out.vel, elev: bird.fw.out.elev }; return; }
  const wl = bird.parts.wingL, wr = bird.parts.wingR, farOff = 24 * D2R;
  wingQuat(wl.quaternion, 1, th, tilt, twist); wingQuat(wr.quaternion, -1, th + farOff, tilt * 0.8, twist);
  const ml = bird.wingMeshL || (bird.wingMeshL = wingMeshOf(wl)), mr = bird.wingMeshR || (bird.wingMeshR = wingMeshOf(wr));
  if (ml) skinWing(ml, aE, aW, bE, fAng); if (mr) skinWing(mr, aE, aW, bE, fAng);
  // body follows the stroke: lift on the downstroke, slight nose-up (applied on the root, after the game's position/rotation)
  bird.flyBob = P.bob * w * -Math.cos(TAU2 * st.g) * amp; bird.flyPitch = P.pitch * w * Math.sin(TAU2 * st.g) * amp;
  F.out = { th, fold, w, dive: F.dive, cyc: F.cyc, tap };
}
/* ============================================================
   B-12b FEATHER WING (shared approved feather rig with species-specific plans for Tornis, Glöd and Frost; render-only).
   Replaces the B-12 slab wing (one flat sickle slab + 4 slab primaries, read as "two stiff triangles") with an anatomical rig:
     shoulder (elevation · sweep · pronation) → humerus → ELBOW (flex · dihedral) → forearm → WRIST (flex · dihedral · supination) → hand
   53 feathers per wing, all instances of ONE closed feather blade. Tornis keeps its approved table; Glöd and Frost use their own proportions/bone lengths,
   8 greater / 6 primary / 7 median / 8 lesser coverts (rounded tips, thin ink), 4 scapulars over the wing root; + 3 bone sleeves.
   Draw calls: feathers + feather hull + sleeves + sleeve hull = 4 (B-12 wings were 4). Hulls are bird.hulls ⇒ hidden on the
   low quality tier (−50 % feather triangles). Per-instance iShape = (load bend, sickle curve, ±width (− = rounded covert), ink/len).
   Driven by the B-12 flight state machine (flyPose: phase, flap weight, dive, dead, hover, reduced motion); never touches S.
   ============================================================ */
const FW_PLANS = {
  // Tornis: the already-approved long sickle swift rig. Keep this profile unchanged.
  tornisA: { bones: { hum: 4.6, fore: 8.2, hand: 9.6 }, shoulder: [0.6, 4.6, 4.3], feathers: {} },
  // Glöd: robin-like body plan – shorter, broader, rounder wing with a broad covert layer.
  glod: { bones: { hum: 4.8, fore: 8.0, hand: 8.4 }, shoulder: [0.4, 5.2, 5.0],
    feathers: { primaryLength: 0.78, primaryWidth: 1.28, primaryFanX: 1.35, primaryCurve: 0.58, secondaryLength: 1.12, secondaryWidth: 1.16, covertLength: 1.08, covertWidth: 1.12, coverStack: 0.32 },
    articulation: { baseYaw: -18, sweepF: -16, elbowE: 18, elbowF: 70, wristE: -25, wristF: -98, pron: 8, foldMax: 0.82, fanBoost: 0.28, bend: 0.16, elbowUp: 38, handDown: 52 } },
  // Frost: tern-like body plan – longer, narrower, swept wing with extended outer primaries.
  frost: { bones: { hum: 5.0, fore: 9.5, hand: 10.8 }, shoulder: [0.8, 4.0, 3.7],
    feathers: { primaryLength: 1.16, primaryWidth: 0.82, primaryFanX: -0.45, primaryCurve: 1.22, secondaryLength: 0.98, secondaryWidth: 0.9, covertLength: 0.9, covertWidth: 0.92, coverStack: 0.08 },
    articulation: { baseYaw: -28, sweepF: -28, elbowE: 16, elbowF: 54, wristE: -25, wristF: -76, pron: 11, foldMax: 0.56, fanBoost: 0.12, bend: 0.1, elbowUp: 24, handDown: 36 } }
};
const FW_P = { baseYaw: -24, sweepE: 0, sweepF: -22, elbowE: 20, elbowF: 64, wristE: -30, wristF: -88, pron: 9, foldMax: 0.7,
  fanBoost: 0.18, bend: 0.12, elbowUp: 30, handDown: 44 }; // articulation only; stroke/flight values live in FLIGHT_BASE + FLIGHT_BIRD
function fwUnit() { // feather blade: length +x (0..1), vanes ±z (outer narrower), normal +y, closed diamond section (raised rachis, cupped vanes)
  const N = 6, pos = [], col = [], idx = [];
  const prof = u => { const b = Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + u * 0.95)), 0.7); const tip = u > 0.72 ? Math.pow(1 - (u - 0.72) / 0.28, 0.85) : 1; return 0.5 * b * tip + 0.04 * (1 - u); };
  for (let i = 0; i <= N; i++) { const u = i / N, w = prof(u), h = 0.03 * (1 - u * 0.8) + 0.004, cup = -0.018 * w, sh = 1 - 0.22 * u;
    pos.push(u, cup, w * 0.62, u, h, 0, u, cup, -w, u, -h * 0.25, 0);
    col.push(0.78 * sh, 0.78 * sh, 0.82 * sh, 1.12 * sh, 1.12 * sh, 1.1 * sh, 0.72 * sh, 0.72 * sh, 0.76 * sh, 0.9 * sh, 0.9 * sh, 0.92 * sh); }
  for (let i = 0; i < N; i++) { const a = i * 4, b = a + 4; for (let j = 0; j < 4; j++) { const k = (j + 1) % 4; idx.push(a + j, b + j, a + k, a + k, b + j, b + k); } }
  idx.push(0, 1, 2, 0, 2, 3);
  const g = new T.BufferGeometry(); g.setIndex(idx); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new T.Float32BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
}
// rounded covert tip: widen the blade toward a semicircular end (factor = round profile / blade profile), only when iShape.z < 0
const FW_GLSL = "attribute vec4 iShape;\nfloat fwProf(float u){ float b = pow(sin(3.14159265 * min(1.0, 0.12 + u * 0.95)), 0.7); float tp = u > 0.72 ? pow(max(0.0, 1.0 - (u - 0.72) / 0.28), 0.85) : 1.0; return 0.5 * b * tp + 0.04 * (1.0 - u); }\n"
  + "float fwRound(float u){ float r = u < 0.5 ? 0.5 : 0.5 * sqrt(max(0.0, 1.0 - pow((u - 0.5) / 0.5, 2.0))); return clamp(r / max(fwProf(u), 0.02), 1.0, 2.6); }\n";
const FW_BEND = "float fu = clamp(position.x, 0.0, 1.0); vec3 transformed = vec3(position); transformed.z *= abs(iShape.z) * (iShape.z < 0.0 ? fwRound(fu) : 1.0); transformed.y += iShape.x * fu * fu; transformed.z += iShape.y * fu * fu;";
function fwMat(hull) {
  const k = "fw" + (hull || "fill"); if (MAT.has(k)) return MAT.get(k);
  const m = hull ? new T.MeshBasicMaterial({ color: new T.Color(INK), side: T.BackSide }) : new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide, emissive: new T.Color(0.42, 0.42, 0.42) });
  m.onBeforeCompile = s => {
    s.vertexShader = FW_GLSL + s.vertexShader.replace("#include <begin_vertex>", FW_BEND + (hull ? " transformed += normalize(vec3(normal.x, normal.y, normal.z / max(abs(iShape.z), 0.05))) * " + hull.toFixed(3) + " * iShape.w;" : ""));
    if (!hull) { s.vertexShader = s.vertexShader.replace("#include <beginnormal_vertex>", "vec3 objectNormal = normalize(vec3(normal.x, normal.y, normal.z / max(abs(iShape.z), 0.05)));");
      s.fragmentShader = s.fragmentShader.replace("vec3 totalEmissiveRadiance = emissive;", "vec3 totalEmissiveRadiance = emissive * vColor.rgb;"); } };
  m.customProgramCacheKey = () => "dw-b12b-" + k; MAT.set(k, m); return m;
}
function fwSleeveMat(hull) { const k = "fwS" + (hull || "fill"); if (MAT.has(k)) return MAT.get(k);
  let m; if (hull) { m = new T.MeshBasicMaterial({ color: new T.Color(INK), side: T.BackSide }); m.onBeforeCompile = s => { s.vertexShader = s.vertexShader.replace("#include <begin_vertex>", "vec3 transformed = vec3(position) + normal * " + hull.toFixed(3) + ";"); }; m.customProgramCacheKey = () => "dw-b12b-" + k; }
  else m = new T.MeshLambertMaterial({ vertexColors: true, emissive: new T.Color(0.12, 0.12, 0.16) });
  MAT.set(k, m); return m; }
function fwTable(profile) { // bone 0 hum / 1 fore / 2 hand / −1 body · t along bone · x chord offset · y layer · gE/gF angle from the bone toward the trailing side (deg) extended/folded
  const F = [], L = (a, b, k) => a + (b - a) * k, Q = profile || {};
  for (let k = 0; k < 10; k++) { const q = k / 9; F.push({ type: "P", k, bone: 2, t: 0.12 + 0.88 * Math.pow(q, 0.85), x: -0.35, y: -0.05 * k, gE: L(44, 5, Math.pow(q, 0.9)), gF: L(14, 2, q), L: L(14, 30, Math.pow(q, 0.75)) - (k === 9 ? 1.4 : 0), wr: L(0.24, 0.15, q), sh: 0.62, tw: L(14, 44, q), curve: -0.07, bendK: L(0.4, 1, q) }); }
  for (let k = 0; k < 8; k++) { const q = k / 7; F.push({ type: "S", k, bone: 1, t: 1 - 0.95 * q, x: -0.35, y: 0.02 * k, gE: L(78, 98, q), gF: L(70, 92, q), L: L(8.6, 7.6, q), wr: 0.38, sh: 0.72, tw: 6, curve: 0.02, bendK: 0.25 }); }
  for (let k = 0; k < 2; k++) F.push({ type: "T", k, bone: 0, t: 0.75 - 0.45 * k, x: -0.4, y: 0.25, gE: 104 + 8 * k, gF: 112, L: 7.4 - k, wr: 0.42, sh: 0.78, tw: 0, curve: 0.04, bendK: 0.1 });
  for (let k = 0; k < 8; k++) { const q = k / 7; F.push({ type: "GC", k, bone: 1, t: 1 - 0.95 * q, x: 0.35, y: 0.55, gE: L(84, 98, q), gF: L(78, 94, q), L: 5.0, wr: 0.62, sh: 0.92, tw: 0, curve: 0.03, bendK: 0.05 }); }
  for (let k = 0; k < 6; k++) { const q = k / 5; F.push({ type: "PC", k, bone: 2, t: 0.08 + 0.7 * q, x: 0.25, y: 0.5, gE: L(62, 22, q), gF: L(18, 6, q), L: L(5.6, 6.6, q), wr: 0.42, sh: 0.86, tw: 0, curve: -0.03, bendK: 0.05 }); }
  for (let k = 0; k < 7; k++) { const q = k / 6, onHum = q > 0.72; F.push({ type: "MC", k, bone: onHum ? 0 : 1, t: onHum ? 0.9 - (q - 0.72) * 2 : 0.95 - q * 1.2, x: 1.05, y: 0.9, gE: L(88, 100, q), gF: L(84, 98, q), L: 3.7, wr: 0.66, sh: 1.0, tw: 0, curve: 0.03, bendK: 0 }); }
  for (let k = 0; k < 8; k++) { const q = k / 7, b = q < 0.2 ? 2 : q < 0.72 ? 1 : 0, t = b === 2 ? 0.45 - q * 2 : b === 1 ? 1 - (q - 0.2) / 0.52 * 0.95 : 1 - (q - 0.72) / 0.28 * 0.9;
    F.push({ type: "LC", k, bone: b, t, x: 1.6, y: 1.15, gE: L(72, 100, q), gF: L(50, 98, q), L: 2.9, wr: 0.72, sh: 1.08, tw: 0, curve: 0, bendK: 0 }); }
  for (let k = 0; k < 4; k++) F.push({ type: "SC", k, bone: -1, t: 0, x: 2.0 - k * 2.4, y: 1.2 + 0.1 * k, gE: 0, gF: 0, L: 7.5 - k * 0.6, wr: 0.42, sh: 0.86, tw: 0, curve: 0.02, bendK: 0 });
  // Species-specific planforms use the same approved articulated feather rig, but distinct proportions.
  // Keep the 53-feather layer count stable; only geometry tables and bone lengths differ by species.
  for (const f of F) {
    if (f.type === "P") {
      const q = f.k / 9;
      f.L *= Q.primaryLength == null ? 1 : Q.primaryLength;
      f.wr *= Q.primaryWidth == null ? 1 : Q.primaryWidth;
      f.x += (Q.primaryFanX || 0) * (q - 0.5);
      f.curve *= Q.primaryCurve == null ? 1 : Q.primaryCurve;
    } else if (f.type === "S" || f.type === "T") {
      f.L *= Q.secondaryLength == null ? 1 : Q.secondaryLength;
      f.wr *= Q.secondaryWidth == null ? 1 : Q.secondaryWidth;
    } else {
      f.L *= Q.covertLength == null ? 1 : Q.covertLength;
      f.wr *= Q.covertWidth == null ? 1 : Q.covertWidth;
      f.y += (Q.coverStack || 0) * (f.k / 7);
    }
  }
  return F;
}
function buildFeatherWings(b, pal) {
  const A = FW_PLANS[b.plan]; if (!A) return null;
  const F = fwTable(A.feathers), nW = F.length, n = nW * 2, geo = fwUnit();
  const sg = new T.CylinderGeometry(1, 1, 1, 7, 1, false); sg.rotateX(Math.PI / 2); sg.setAttribute("color", new T.Float32BufferAttribute(new Float32Array(sg.getAttribute("position").count * 3).fill(1), 3));
  const fill = new T.InstancedMesh(geo, fwMat(0), n), hull = new T.InstancedMesh(geo, fwMat(0.55), n);
  const IBA = fill.instanceMatrix.constructor, shape = new IBA(new Float32Array(n * 4), 4); geo.setAttribute("iShape", shape);
  const [body, dark, wing, far] = pal.map(h => new T.Color(h)), C = new T.Color();
  for (let s = 0; s < 2; s++) for (let i = 0; i < nW; i++) { const f = F[i], j = s * nW + i, cov = /C$/.test(f.type);
    const base = f.type === "P" ? dark.clone().lerp(wing, 0.25) : f.type === "S" || f.type === "T" ? dark.clone().lerp(wing, 0.55) : f.type === "SC" ? body.clone() : wing.clone();
    C.copy(base).multiplyScalar(f.sh * 1.05); if (s === 1) C.multiplyScalar(0.62).lerp(far, 0.25); fill.setColorAt(j, C);
    shape.array[j * 4 + 2] = cov ? -f.wr : f.wr; shape.array[j * 4 + 3] = (cov ? 0.45 : 1) / f.L; }
  fill.instanceColor.needsUpdate = true;
  const sleeves = new T.InstancedMesh(sg, fwSleeveMat(0), 6), shull = new T.InstancedMesh(sg, fwSleeveMat(0.45), 6);
  for (let s = 0; s < 2; s++) for (let k = 0; k < 3; k++) { C.copy(wing).multiplyScalar(1.02); if (s === 1) C.multiplyScalar(0.62).lerp(far, 0.25); sleeves.setColorAt(s * 3 + k, C); }
  sleeves.instanceColor.needsUpdate = true;
  for (const m of [fill, hull, sleeves, shull]) { m.frustumCulled = false; m.instanceMatrix.setUsage(35048); /* DynamicDrawUsage */ }
  hull.userData.hull = shull.userData.hull = true; hull.renderOrder = shull.renderOrder = -1;
  const g = new T.Group(); g.name = "featherWings"; g.add(shull, sleeves, hull, fill); b.rig.add(g);
  const M = []; for (let i = 0; i < 8; i++) M.push(new T.Matrix4());
  return b.fw = { F, nW, n, fill, hull, sleeves, shull, shape, group: g, M, A, P: Object.assign({}, FW_P, A.articulation || {}), planId: b.plan, out: null };
}
const _fm = []; for (let i = 0; i < 8; i++) _fm.push(new T.Matrix4()); const _fe = new T.Euler();
function fwRot(out, rx, ry, rz) { _fe.set(rx, ry, rz, "XYZ"); return out.makeRotationFromEuler(_fe); }
function fwConjZ(out, m) { const a = m.elements, o = out.elements; for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { const i = r + 4 * c; o[i] = (r === 2) !== (c === 2) ? -a[i] : a[i]; } return out; }
function fwStroke(phi, dsf) { const f = phi - Math.floor(phi), g = f < dsf ? 0.5 * f / dsf : 0.5 + 0.5 * (f - dsf) / (1 - dsf), up = g > 0.5 ? (g - 0.5) * 2 : 0;
  return { g, c: Math.cos(TAU2 * g), vel: Math.sin(TAU2 * g), fold: g > 0.5 ? Math.pow(Math.sin(Math.PI * Math.pow(up, 0.8)), 1.3) : 0 }; }
/* s = { phi, w (flap weight), dive, dead, amp (hover/rm amplitude), rm, t, lag (per-bird scale), flutter (per-bird scale), glideOsc } */
function poseFeather(fw, s) {
  const P = fw.P || FW_P, Q = s.profile || FLIGHT_BASE[fw.planId] || FLIGHT_BASE.tornisA;
  const D = D2R, w = s.w * (1 - (s.dead || 0)), amp = s.amp == null ? 1 : s.amp;
  const st = fwStroke(s.phi, Q.dsf), sL = fwStroke(s.phi - 0.07, Q.dsf), sL2 = fwStroke(s.phi - 0.13, Q.dsf);
  const mid = (Q.top + Q.bot) / 2, half = (Q.top - Q.bot) / 2 * amp;
  const lag = (Q.lag == null ? 0.06 : Q.lag) / 0.06;
  // flap pose
  const fE = mid + half * st.c, fF = st.fold * P.foldMax * Math.min(1, amp + 0.2), fV = st.vel * amp, fVL = sL.vel * amp * lag, fVL2 = sL2.vel * amp * lag;
  // base pose: glide ↔ dive ↔ dead
  const dv = s.dive || 0, dd = s.dead || 0;
  const bE = (Q.glide + (s.glideOsc || 0) * 40) * (1 - dv) + Q.dive * dv, bF = Q.glideFold * (1 - dv) + Q.diveFold * dv;
  const elev = (bE * (1 - dd) + 40 * dd) * (1 - w) + fE * w, fold = (bF * (1 - dd) + 0.45 * dd) * (1 - w) + fF * w;
  const vel = fV * w, velL = fVL * w, velL2 = fVL2 * w;
  const sweep = P.sweepE + (P.sweepF - P.sweepE) * fold, elbow = P.elbowE + (P.elbowF - P.elbowE) * fold, wrist = P.wristE + (P.wristF - P.wristE) * fold;
  const upF = st.fold * w; // upstroke-only inverted V (wrist leads up, hand trails down): reads as a bent wing from the side
  const elbowDih = P.elbowUp * upF + 6 * velL + 10 * dd + (Q.foldE || 0) * 20 * velL,
    wristDih = -P.handDown * upF + 14.4 * velL2 - 20 * dd + (Q.foldW || 0) * 16 * velL2;
  const pron = -P.pron * vel + 6 * fold + (Q.twist || 0) / D, handTwist = -P.pron * 0.8 * velL + 24 * upF + (Q.tilt || 0) / D;
  const fan = 1 + P.fanBoost * Math.max(0, vel);
  const A = fw.A, Bn = A.bones, SH = A.shoulder, M = fw.M, X = _fm;
  const base = M[0].makeTranslation(SH[0], SH[1], SH[2]).multiply(X[7].makeRotationY(P.baseYaw * D)); // Q.tilt / Q.twist are applied once through pron / handTwist below
  const sh = M[1].copy(base).multiply(fwRot(X[0], -elev * D, sweep * D, pron * D));
  const el = M[2].copy(sh).multiply(X[0].makeTranslation(0, 0, Bn.hum)).multiply(fwRot(X[1], -elbowDih * D, elbow * D, 0));
  const wr = M[3].copy(el).multiply(X[0].makeTranslation(0, 0, Bn.fore)).multiply(fwRot(X[1], -wristDih * D, wrist * D, handTwist * D));
  const body = M[5].identity(), bones = [sh, el, wr], blen = [Bn.hum, Bn.fore, Bn.hand];
  const F = fw.F, nW = fw.nW, SA = fw.shape.array, fm = X[2], loc = X[3], tmp = X[4], fr = X[5];
  const flut = s.rm ? 0 : (Q.feather == null ? 0.015 : Q.feather * 0.25);
  for (let i = 0; i < nW; i++) { const f = F[i];
    let par;
    if (f.bone < 0) { par = body; loc.makeTranslation(SH[0] + f.x, SH[1] + f.y + Math.max(0, elev) * 0.012, SH[2] - 1.6).multiply(fwRot(tmp, -(Math.max(-10, elev) * 0.22 + 6) * D, 0, (-6 + 2 * fold) * D)).multiply(tmp.makeRotationY(Math.PI - 0.08 * f.k)); }
    else { par = bones[f.bone];
      const gam = f.type === "P" ? f.gE * fan + (f.gF - f.gE * fan) * fold : f.gE + (f.gF - f.gE) * fold;
      const fl = f.type === "P" ? flut * Math.sin((s.t || 0) * 41 + f.k * 1.9) : 0;
      const spreadFan = f.type === "P" ? ((f.k - 4.5) / 4.5) * (Q.spread || 0) : 0;
      loc.makeTranslation(f.x, f.y, f.t * blen[f.bone]).multiply(fwRot(tmp, 0, -Math.PI / 2 - gam * D, 0)).multiply(X[6].makeRotationX(f.tw * fold * D + fl + spreadFan)); }
    fm.multiplyMatrices(par, loc).multiply(tmp.makeScale(f.L, f.L, f.L));
    const bend = -P.bend * f.bendK * (0.65 * velL + 0.35 * velL2) * (s.rm ? 0.5 : 1) + 0.03 * f.bendK * fold;
    SA[i * 4] = SA[(nW + i) * 4] = bend; SA[i * 4 + 1] = f.curve; SA[(nW + i) * 4 + 1] = -f.curve;
    fw.fill.setMatrixAt(i, fm); fw.hull.setMatrixAt(i, fm); fwConjZ(fr, fm); fw.fill.setMatrixAt(nW + i, fr); fw.hull.setMatrixAt(nW + i, fr); }
  const rad = [1.45, 1.05, 0.7];
  for (let k = 0; k < 3; k++) { fm.copy(bones[k]).multiply(tmp.makeTranslation(0.45, 0.25, blen[k] / 2)).multiply(X[6].makeScale(rad[k], rad[k] * 0.7, blen[k] + 0.6));
    fw.sleeves.setMatrixAt(k, fm); fw.shull.setMatrixAt(k, fm); fwConjZ(fr, fm); fw.sleeves.setMatrixAt(3 + k, fr); fw.shull.setMatrixAt(3 + k, fr); }
  for (const m of [fw.fill, fw.hull, fw.sleeves, fw.shull]) m.instanceMatrix.needsUpdate = true; fw.shape.needsUpdate = true;
  // wing sockets (wing band) ride on the forearm
  if (fw.sock) for (const [o, sd] of fw.sock) { if (sd > 0) o.matrix.copy(el); else fwConjZ(o.matrix, el); o.matrixWorldNeedsUpdate = true; }
  return fw.out = { phi: s.phi, g: st.g, elev, fold, vel, elbow, wrist, sweep, w };
}

/* B-12b: volumetric scarf tails (was 3 flat boxes = a flat strip from above): two tapered ribbons with a lens-shaped section,
   twisting along their length; CPU-posed chain (pitch + sideways sway + twist) – one mesh, ≈ 170 triangles. Render-only. */
const SCARF_TAILS = [{ z: 0.8, len: 13.5, w: 3.6, th: 1.5, ph: 0 }, { z: -0.7, len: 10.5, w: 3.0, th: 1.3, ph: 1.7 }];
function scarfTailsGeo(col, col2) {
  const RING = 6, NR = 6, pos = [], nrm = [], colA = [], idx = [], meta = []; const c1 = new T.Color(col), c2 = new T.Color(col2 || col);
  SCARF_TAILS.forEach((tl, ti) => { const v0 = pos.length / 3;
    for (let r = 0; r < NR; r++) { const s = r / (NR - 1), w = tl.w * (1 - 0.3 * s) / 2, th = tl.th * (1 - 0.45 * s) / 2, cc = ti === 1 && col2 ? c2 : c1, sh = 1 - 0.12 * s;
      for (let k = 0; k < RING; k++) { const a = k / RING * Math.PI * 2, ly = Math.cos(a) * w, lz = Math.sin(a) * th; let ny = Math.cos(a) / w, nz = Math.sin(a) / th; const l = Math.hypot(ny, nz); ny /= l; nz /= l;
        pos.push(0, ly, lz); nrm.push(0, ny, nz); colA.push(cc.r * sh, cc.g * sh, cc.b * sh); meta.push(ti, r, ly, lz, ny, nz); } }
    for (let r = 0; r < NR - 1; r++) for (let k = 0; k < RING; k++) { const a = v0 + r * RING + k, b = v0 + r * RING + (k + 1) % RING, c = a + RING, d = b + RING; idx.push(a, c, b, b, c, d); }
    const e = v0 + (NR - 1) * RING; for (let k = 1; k < RING - 1; k++) idx.push(e, e + k, e + k + 1); });
  const g = new T.BufferGeometry(); g.setIndex(idx); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new T.Float32BufferAttribute(nrm, 3)); g.setAttribute("color", new T.Float32BufferAttribute(colA, 3));
  g.userData.scarf = { meta: new Float32Array(meta), NR }; return g;
}
const _sm = new T.Matrix4(), _se = new T.Euler(), _sp = [];
function poseScarfTails(sc, t, vy, rm, fo) {
  const m = sc && sc.children[0]; if (!m || !m.geometry.userData.scarf) return; const G = m.geometry, S = G.userData.scarf, P = G.getAttribute("position").array, N = G.getAttribute("normal").array, NR = S.NR, me = S.meta, e = _sm.elements;
  const lift = -Math.max(-0.2, Math.min(0.3, (vy || 0) / 1400)), beat = fo ? fo.vel || 0 : 0;
  SCARF_TAILS.forEach((tl, ti) => { let x = 0, y = 0, z = tl.z, a = 0, yw = 0; const seg = tl.len / (NR - 1);
    for (let r = 0; r < NR; r++) { const s = r / (NR - 1), wv = rm ? 0 : 1;
      a += (r ? 0.04 : -0.5) + lift * (r ? 0.25 : 1) + wv * Math.sin(t * 2.2 * TAU2 - r * 0.9 + tl.ph) * (0.05 + 0.05 * s) + wv * 0.03 * beat;
      yw = wv * Math.sin(t * 1.7 * TAU2 - r * 0.8 + tl.ph) * 0.4 * s + (ti ? 0.2 : -0.3) * s;
      const tw = 0.9 * s * (ti ? -1 : 1) + wv * Math.sin(t * 2.6 * TAU2 - r + tl.ph) * 0.35 * s;
      _se.set(tw, yw, a, "ZYX"); _sm.makeRotationFromEuler(_se); _sp[r] = [x, y, z];
      const vb = (ti * NR + r) * 6; for (let v = vb; v < vb + 6; v++) { const ly = me[v * 6 + 2], lz = me[v * 6 + 3], ny = me[v * 6 + 4], nz = me[v * 6 + 5];
        P[v * 3] = x + e[4] * ly + e[8] * lz; P[v * 3 + 1] = y + e[5] * ly + e[9] * lz; P[v * 3 + 2] = z + e[6] * ly + e[10] * lz;
        N[v * 3] = e[4] * ny + e[8] * nz; N[v * 3 + 1] = e[5] * ny + e[9] * nz; N[v * 3 + 2] = e[6] * ny + e[10] * nz; }
      x -= e[0] * seg; y -= e[1] * seg; z -= e[2] * seg; } });
  G.getAttribute("position").needsUpdate = G.getAttribute("normal").needsUpdate = true;
}
/* ---------- pose (same inputs as render3d.js updateBird: identity.wingAngle degrees, vy, rot, blink…) ---------- */
function poseSwift(bird, B, t, rm) {
  bird.rig.rotation.set(B.menu && !rm ? 0.28 + Math.sin(t * 0.6) * 0.1 : 0.24, B.menu && !rm ? -0.4 + Math.sin(t * 0.5) * 0.25 : -0.3, 0);
  // B-12: wings from the shared flight system (replaces the 120 ms elevation flick about the body axis, see FLIGHT above)
  flyPose(bird, B, t, rm);
  bird.parts.tail.rotation.z = rm ? 0 : Math.sin(t * 3.1) * 0.05 - Math.max(-0.2, Math.min(0.25, B.vy / 2400));
  for (const e of bird.parts.eyes) e.scale.y = B.dead ? 0.15 : B.blink ? 0.12 : B.happy ? 0.55 : 1;
  poseScarfTails(bird.root.getObjectByName("scarfTails"), t, B.vy, rm, bird.fly && bird.fly.out); // B-12b volumetric tails
  const pr = bird.root.getObjectByName("item:propeller"); if (pr) pr.rotation.y = rm ? 0.6 : t * 14;
}

/* ============================================================
   3. GREEN VALLEY world kit (bg perspective scene; camera = render3d.js bgCam, DC = 760)
   ============================================================ */
const GV = { built: false };
function periodicNoise(P, seed, terms) { const r = lcg(seed), ks = []; for (let i = 0; i < terms; i++) ks.push([1 + Math.floor(r() * (2 + i * 3)), r() * Math.PI * 2, 1 / (1 + i * 0.9)]);
  return x => { let v = 0, n = 0; for (const [k, ph, a] of ks) { v += Math.sin(x / P * Math.PI * 2 * k + ph) * a; n += a; } return v / n; }; }
/* a periodic ridge strip: x ∈ [−1.5P, 1.5P], top = base + amp·noise, vertex colours bottom→top, optional snow above snowY */
function ridge(P, cols, base, amp, depth, seed, c0, c1, snowAt, jag) {
  const nz = periodicNoise(P, seed, 6), pos = [], col = [], C0 = new T.Color(c0), C1 = new T.Color(c1), SN = new T.Color("#FFFFFF");
  // B-12 P2: the strip jumps by one period P when it wraps, so the silhouette must repeat EXACTLY every P: whole columns per
  // period (N = 3·Np) and a jag pattern indexed per period (before: N not divisible by 3 and a non-periodic jag → the far ridges
  // changed shape in view at every wrap, up to 77 units).
  const Np = Math.max(1, Math.round(cols / 3)), N = 3 * Np, x0 = -1.5 * P, dx = P / Np; const tops = [];
  for (let i = 0; i <= N; i++) { const x = x0 + i * dx; let y = base + amp * (0.5 + 0.5 * nz(x)); if (jag) y += jag * (((i % Np) * 7919 % 13) / 13 - 0.5); tops.push([x, y]); }
  const bot = base - 900;
  const push = (x, y, z, c) => { pos.push(x, y, z); col.push(c.r, c.g, c.b); };
  for (let i = 0; i < N; i++) {
    const [xa, ya] = tops[i], [xb, yb] = tops[i + 1]; const mya = (ya + bot) / 2 + 60, myb = (yb + bot) / 2 + 60;
    const ca = C1.clone(), cb = C1.clone(); if (snowAt != null) { if (ya > snowAt) ca.copy(SN); if (yb > snowAt) cb.copy(SN); }
    const cm = C0.clone().lerp(C1, 0.55);
    // upper band (tilted back so the sun lights it) + lower band
    push(xa, ya, -depth - 50, ca); push(xa, mya, -depth + 20, cm); push(xb, yb, -depth - 50, cb);
    push(xb, yb, -depth - 50, cb); push(xa, mya, -depth + 20, cm); push(xb, myb, -depth + 20, cm);
    push(xa, mya, -depth + 20, cm); push(xa, bot, -depth + 40, C0); push(xb, myb, -depth + 20, cm);
    push(xb, myb, -depth + 20, cm); push(xa, bot, -depth + 40, C0); push(xb, bot, -depth + 40, C0);
  }
  const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new T.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
  const m = new T.Mesh(g, vc("lam")); m.frustumCulled = false; m.userData = { P, depth, tops, base }; return m;
}
function ridgeHeightAt(m, xWorld) { const { P, tops } = m.userData; const lx = xWorld - m.position.x; const x0 = tops[0][0], dx = tops[1][0] - x0; const i = Math.max(0, Math.min(tops.length - 2, Math.floor((lx - x0) / dx)));
  const u = (lx - tops[i][0]) / dx; return tops[i][1] + (tops[i + 1][1] - tops[i][1]) * u; }
function canvasTex(w, h, draw) { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t; }
function buildGV(R) {
  const bg = R.bg, rnd = lcg(0x6A11E7), G = new T.Group(); G.name = "greenValley"; bg.add(G); GV.group = G;
  const gy = 708; // S.H − S.groundH (800 − 92); ground top in three-y = −gy
  GV.sky = canvasTex(2, 256, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#6FAEEA"); g.addColorStop(0.5, "#A9D4F5"); g.addColorStop(0.78, "#DCEEF7"); g.addColorStop(1, "#F6F1DF"); x.fillStyle = g; x.fillRect(0, 0, w, h); });
  // layers (P = period, must exceed the visible width at that depth)
  GV.far1 = ridge(9000, 90, -gy + 260, 900, 6200, 11, "#AFC3DC", "#C9D8EA", -gy + 1000, 60); G.add(GV.far1);
  GV.far2 = ridge(7000, 80, -gy + 120, 620, 4600, 23, "#93B4CF", "#B2C9DF", -gy + 640, 40); G.add(GV.far2);
  GV.mid1 = ridge(5200, 70, -gy + 40, 300, 2600, 37, "#93BE86", "#B5D6A3", null, 0); G.add(GV.mid1);
  GV.mid2 = ridge(3600, 60, -gy - 10, 170, 1500, 41, "#7BB463", "#A0CC84", null, 0); G.add(GV.mid2);
  GV.near = ridge(2400, 48, -gy - 30, 70, 620, 53, "#64A44C", "#80BD5E", null, 0); G.add(GV.near);
  GV.ridges = [GV.far1, GV.far2, GV.mid1, GV.mid2, GV.near];
  /* ---- FLORA (round 2b: Martin wants more detail + varied greenery). One instanced draw per species; crowns are
     authored white-ish with flat shading and tinted per instance (species colour, variety jitter, aerial-perspective haze). */
  const HAZE = new T.Color("#CFE6F5"), hzOf = L => L === GV.near ? 0.1 : L === GV.mid2 ? 0.26 : 0.42; // tuned by the QA edge-contrast probe
  const inst = (geo, mat, n) => { const m = new T.InstancedMesh(geo, mat, n); m.frustumCulled = false; G.add(m); return m; };
  const flat = new T.MeshLambertMaterial({ flatShading: true }), flatVC = new T.MeshLambertMaterial({ flatShading: true, vertexColors: true });
  const W1 = "#FFFFFF";
  const SPEC = {
    round:  { geo: merge([part(new T.IcosahedronGeometry(1, 1), trs(0, 0.95, 0, 0, 0, 0, 1, 0.9, 1), W1)]), cols: ["#3E9A2E", "#4FAA36", "#5FBA3E", "#38912C"], trunkH: 0.55, crownW: 24, crownH: 22 },
    oak:    { geo: merge([part(new T.IcosahedronGeometry(1, 0), trs(0, 0.9, 0, 0, 0, 0, 0.95, 0.7, 0.9), W1), part(new T.IcosahedronGeometry(1, 0), trs(-0.6, 0.75, 0.2, 0.4, 0, 0, 0.6, 0.5, 0.6), W1),
              part(new T.IcosahedronGeometry(1, 0), trs(0.62, 0.8, -0.1, 0, 0.5, 0, 0.62, 0.5, 0.6), W1), part(new T.IcosahedronGeometry(1, 0), trs(0.05, 1.35, 0, 0, 0.3, 0, 0.6, 0.45, 0.6), W1)]),
            cols: ["#2F8A28", "#3C9630", "#4AA038"], trunkH: 0.5, crownW: 34, crownH: 26 },
    birch:  { geo: merge([part(new T.IcosahedronGeometry(1, 1), trs(0, 1.1, 0, 0, 0, 0, 0.6, 1.15, 0.6), W1)]), cols: ["#8FCB3E", "#A2D44C", "#B0DA52", "#E8C23A"], trunkH: 0.75, crownW: 18, crownH: 26, birch: true },
    poplar: { geo: merge([part(new T.IcosahedronGeometry(1, 1), trs(0, 1.5, 0, 0, 0, 0, 0.32, 1.55, 0.32), W1)]), cols: ["#4E9E2C", "#5CAA36"], trunkH: 0.35, crownW: 20, crownH: 30 },
    pine:   { geo: merge([part(new T.ConeGeometry(1, 2.4, 7), trs(0, 1.45, 0), W1)]), cols: ["#2F8A50", "#3A965A", "#2A7E4A"], trunkH: 0.25, crownW: 20, crownH: 40 },
    spruce: { geo: merge([part(new T.ConeGeometry(1, 1.3, 7), trs(0, 0.8, 0), W1), part(new T.ConeGeometry(0.78, 1.15, 7), trs(0, 1.5, 0), W1), part(new T.ConeGeometry(0.52, 1.0, 7), trs(0, 2.15, 0), W1)]),
              cols: ["#287A48", "#318650", "#246E42"], trunkH: 0.2, crownW: 22, crownH: 42 }
  };
  GV.trees = []; GV.spec = {};
  const pick = (r, w) => { let s = 0; for (const k in w) s += w[k]; let x = r * s; for (const k in w) { x -= w[k]; if (x <= 0) return k; } return Object.keys(w)[0]; };
  const addTrees = (n, layer, dMin, dMax, sMin, sMax, w) => { for (let i = 0; i < n; i++) { const sp = pick(rnd(), w); GV.trees.push({ layer, sp, d: dMin + rnd() * (dMax - dMin), bx: rnd() * layer.userData.P, s: sMin + rnd() * (sMax - sMin), ph: rnd() * 6.28, c: rnd(), lean: (rnd() - 0.5) * 0.06 }); } };
  // groves: species mix differs by distance (birch/oak meadow edge near, mixed mid, conifer-dominated far ridges)
  addTrees(30, GV.near, 560, 720, 0.65, 1.1, { round: 3, oak: 2, birch: 3, poplar: 1, pine: 1, spruce: 1 });
  addTrees(48, GV.mid2, 1420, 1580, 1.3, 2.0, { round: 3, oak: 1, birch: 1, poplar: 2, pine: 2, spruce: 3 });
  addTrees(54, GV.mid1, 2500, 2680, 2.0, 2.9, { round: 2, poplar: 1, pine: 3, spruce: 4 });
  for (const k in SPEC) { const list = GV.trees.filter(t => t.sp === k); if (!list.length) continue; const m = inst(SPEC[k].geo, flat, list.length); GV.spec[k] = { mesh: m, list, def: SPEC[k] };
    list.forEach((t, i) => { const c = new T.Color(SPEC[k].cols[Math.floor(t.c * SPEC[k].cols.length)]); c.offsetHSL((t.ph - 3) * 0.004, 0, (t.c - 0.5) * 0.06); t.col = c.lerp(HAZE, hzOf(t.layer)); m.setColorAt(i, t.col); });
    m.instanceColor.needsUpdate = true; }
  GV.trunk = inst(new T.CylinderGeometry(0.6, 1, 1, 5), flat, GV.trees.length);
  GV.trees.forEach(t => { t.trunkCol = new T.Color(SPEC[t.sp].birch ? "#EDEAE0" : "#6B4423").lerp(HAZE, hzOf(t.layer) * 0.8); });
  GV.trunkCol = t => t.trunkCol; GV.trees.forEach((t, i) => GV.trunk.setColorAt(i, t.trunkCol)); GV.trunk.instanceColor.needsUpdate = true;
  // bushes: plain, berry (red dots) and flowering (pink) shrubs at the meadow edge
  const bushG = { plain: merge([part(new T.IcosahedronGeometry(1, 0), null, "#6FB552"), part(new T.IcosahedronGeometry(1, 0), trs(0.7, -0.15, 0.1, 0, 0.6, 0, 0.7), "#62A848")]) };
  const dots = (col, n, r) => { const o = []; const q = lcg(n * 31); for (let i = 0; i < n; i++) { const a = q() * 6.28, e = q() * 1.2 - 0.2; o.push(part(new T.IcosahedronGeometry(1, 0), trs(Math.cos(a) * r * Math.cos(e), 0.2 + Math.sin(e) * r * 0.8, Math.sin(a) * r * Math.cos(e), 0, 0, 0, 0.16), col)); } return o; };
  bushG.berry = merge([part(new T.IcosahedronGeometry(1, 0), null, "#5DA548"), ...dots("#E0314B", 9, 0.98)]);
  bushG.bloom = merge([part(new T.IcosahedronGeometry(1, 0), null, "#6AAE50"), part(new T.IcosahedronGeometry(1, 0), trs(-0.6, -0.1, 0, 0, 0.4, 0, 0.75), "#6AAE50"), ...dots("#F6A6C8", 8, 1.0), ...dots("#FFFFFF", 3, 0.95)]);
  GV.bushes = []; for (const k of ["plain", "berry", "bloom"]) { const n = k === "plain" ? 22 : 10, items = [];
    for (let i = 0; i < n; i++) items.push({ d: 150 + rnd() * 330, bx: rnd() * 2000, s: 7 + rnd() * 8 });
    const m = inst(bushG[k], flatVC, n); items.forEach((b, i) => m.setColorAt(i, new T.Color("#FFFFFF").lerp(HAZE, 0.06))); m.instanceColor.needsUpdate = true; GV.bushes.push({ m, items }); }
  // meadow texture: soft patches of lighter/darker grass on the valley floor (one instanced draw)
  GV.patchItems = []; for (let i = 0; i < 34; i++) GV.patchItems.push({ d: 60 + rnd() * 600, bx: rnd() * 2600, w: 40 + rnd() * 110, l: 14 + rnd() * 40, c: i % 3 });
  GV.patches = inst(new T.CylinderGeometry(1, 1, 0.5, 9), new T.MeshLambertMaterial({}), GV.patchItems.length);
  GV.patchItems.forEach((p2, i) => GV.patches.setColorAt(i, new T.Color(["#7CC25A", "#62AE46", "#8ACB66"][p2.c]))); GV.patches.instanceColor.needsUpdate = true;
  // ferns at the forest foot (fan of 5 fronds)
  const fr = []; for (let k = 0; k < 5; k++) fr.push(slabPart([[0, 0], [0.5, 0.6], [1.6, 1.1]], [[0, 0], [0.7, 0.3], [1.6, 1.1]], 0.05, trs(0, 0, 0, 0, k * 1.256, 0), "#4F9A44"));
  GV.fernItems = []; for (let i = 0; i < 30; i++) GV.fernItems.push({ d: 520 + rnd() * 120, bx: rnd() * 2400, s: 9 + rnd() * 7, r: rnd() * 6 });
  GV.ferns = inst(merge(fr), new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide }), GV.fernItems.length);
  // wildflower species (stem + head, vertex coloured): daisy, buttercup, poppy, lupine spike, cornflower
  const stem = h => part(new T.CylinderGeometry(0.06, 0.08, h, 3), trs(0, h / 2, 0), "#4E8F3A");
  const petals = (col, n, r, cy) => [part(new T.ConeGeometry(r * 1.35, 0.14, Math.min(n, 6), 1), trs(0, cy, 0, 0.25, 0, 0.1), col)]; // flat petal disc (≤6 segments, 2n tris) – optimised from n icosahedra
  const FL = {
    daisy: merge([stem(1.6), ...petals("#FFFFFF", 7, 0.42, 1.65), part(new T.ConeGeometry(0.24, 0.2, 4), trs(0, 1.76, 0), "#FFC93C")]),
    buttercup: merge([stem(1.3), ...petals("#FFD83A", 5, 0.32, 1.35), part(new T.ConeGeometry(0.15, 0.16, 4), trs(0, 1.42, 0), "#E8A80F")]),
    poppy: merge([stem(1.9), ...petals("#F0442E", 4, 0.48, 1.95), part(new T.ConeGeometry(0.17, 0.2, 4), trs(0, 2.04, 0), "#2B2118")]),
    lupine: merge([stem(1.2), ...[0, 1, 2, 3].map(k => part(new T.ConeGeometry(0.34 - k * 0.06, 0.55, 4), trs(0, 1.4 + k * 0.38, 0), k % 2 ? "#8E6BD8" : "#A47FE6"))]),
    cornflower: merge([stem(1.5), ...petals("#4C7EE8", 8, 0.3, 1.55)])
  };
  // optimisation: flowers are merged into mixed PATCH geometries (8–9 flowers each, 2 variants) → 2 instanced draws instead of 5
  const patchOf = (mix, seed) => { const q = lcg(seed), o = []; mix.forEach(k => { const g = FL[k].clone(); g.scale(1, 0.85 + q() * 0.4, 1); g.rotateY(q() * 6.28); g.translate((q() - 0.5) * 9, 0, (q() - 0.5) * 6); o.push(g); }); return merge(o); };
  const PV = [patchOf(["daisy", "daisy", "buttercup", "buttercup", "daisy", "cornflower", "buttercup", "daisy"], 7), patchOf(["poppy", "lupine", "poppy", "daisy", "lupine", "cornflower", "poppy", "buttercup", "lupine"], 13)];
  GV.flowers = PV.map((geo, vi) => { const items = []; for (let i = 0; i < (vi ? 14 : 22); i++) items.push({ d: 70 + rnd() * 280, bx: rnd() * 1500, s: 4.2 + rnd() * 2.4, ph: rnd() * 6 });
    return { m: inst(geo, new T.MeshLambertMaterial({ vertexColors: true }), items.length), items, k: "patch" + vi }; });
  // meadow grass clumps (3 blades each, one instanced draw) + a meandering stream ribbon toward the waterfall pool
  GV.grassItems = []; for (let i = 0; i < 90; i++) GV.grassItems.push({ d: 60 + Math.pow(rnd(), 1.6) * 700, bx: rnd() * 2200, s: 5 + rnd() * 6, r: rnd() * 3 });
  const gb = []; for (let k = 0; k < 3; k++) gb.push(part(new T.ConeGeometry(0.22, 1, 3), trs((k - 1) * 0.3, 0.5, 0, 0, 0, (k - 1) * 0.35), "#FFFFFF"));
  GV.grass = inst(merge(gb), new T.MeshLambertMaterial({ vertexColors: true, color: new T.Color("#4E9A3A") }), GV.grassItems.length);
  // waterfall: cliff + falling water (scrolling texture) + mist + pool, on the mid2 layer (one per period)
  const WF = GV.wf = new T.Group(); G.add(WF); WF.userData.P = 7200; WF.userData.d = 1700; WF.userData.bx = 900;
  const rockM = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const rp = []; const rr = lcg(77);
  for (let i = 0; i < 9; i++) { const g = new T.IcosahedronGeometry(1, 0); rp.push(part(g, trs((i % 3 - 1) * 120 + (rr() - 0.5) * 50, 120 + Math.floor(i / 3) * 170 + rr() * 40, (rr() - 0.5) * 40, rr(), rr(), rr(), 110 + rr() * 50, 130 + rr() * 40, 70), i % 2 ? "#A9B3B4" : "#B9C2BE")); }
  rp.push(part(new T.IcosahedronGeometry(1, 0), trs(-150, 560, 0, 0.3, 0.2, 0, 140, 60, 80), "#6FAE4F")); rp.push(part(new T.IcosahedronGeometry(1, 0), trs(140, 560, 0, 0.1, 0.5, 0, 130, 55, 80), "#6FAE4F"));
  const cliff = new T.Mesh(merge(rp), rockM); WF.add(cliff); GV.wfCliff = cliff;
  GV.waterTex = canvasTex(64, 256, (x, w, h) => { x.fillStyle = "#CFEFFF"; x.fillRect(0, 0, w, h); const r = lcg(5);
    for (let i = 0; i < 70; i++) { x.fillStyle = r() > 0.5 ? "rgba(255,255,255,0.9)" : "rgba(140,200,235,0.8)"; x.fillRect(Math.floor(r() * w), Math.floor(r() * h), 2 + Math.floor(r() * 4), 20 + Math.floor(r() * 60)); } });
  GV.waterTex.wrapS = GV.waterTex.wrapT = 1000; // RepeatWrapping
  GV.waterTex.repeat.set(1, 2);
  const fall = new T.Mesh(new T.PlaneGeometry(64, 620), new T.MeshBasicMaterial({ map: GV.waterTex, transparent: true, opacity: 0.92 })); fall.position.set(0, 300, 120); WF.add(fall); GV.wfFall = fall;
  const pool = new T.Mesh(new T.CylinderGeometry(150, 170, 6, 18), new T.MeshLambertMaterial({ color: "#8FD3F0" })); pool.position.set(0, -8, 150); WF.add(pool); GV.wfPool = pool;
  GV.mistTex = canvasTex(64, 64, (x) => { const g = x.createRadialGradient(32, 32, 2, 32, 32, 32); g.addColorStop(0, "rgba(255,255,255,0.95)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 64, 64); });
  // perf: mist puffs, sun shafts and the distant flock are single instanced draws (proxies hold the per-item transform)
  GV.mistI = new T.InstancedMesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: GV.mistTex, transparent: true, depthWrite: false, opacity: 0.7 }), 4); GV.mistI.frustumCulled = false; WF.add(GV.mistI);
  GV.mist = []; for (let i = 0; i < 4; i++) { const m = new T.Object3D(); m.position.set((i - 1.5) * 50, 10, 170); GV.mist.push(m); }
  // reeds + cattails and lily pads around the waterfall pool, ducks on it
  const rd = []; const rq = lcg(91); for (let i = 0; i < 26; i++) { const a = rq() * 6.28, r = 150 + rq() * 30, h = 26 + rq() * 26; rd.push(part(new T.CylinderGeometry(0.8, 1.4, h, 3), trs(Math.cos(a) * r, h / 2, 150 + Math.sin(a) * r * 0.45, (rq() - 0.5) * 0.2, 0, (rq() - 0.5) * 0.25), "#5E9A3E"));
    if (i % 3 === 0) rd.push(part(new T.CylinderGeometry(2.2, 2.2, 8, 5), trs(Math.cos(a) * r, h + 2, 150 + Math.sin(a) * r * 0.45), "#6B4423")); }
  for (let i = 0; i < 7; i++) { const a = rq() * 6.28, r = 40 + rq() * 90; rd.push(part(new T.CylinderGeometry(9, 9, 1, 8), trs(Math.cos(a) * r, -3.5, 150 + Math.sin(a) * r * 0.5), "#5FA456")); if (i % 2) rd.push(part(new T.IcosahedronGeometry(1, 0), trs(Math.cos(a) * r + 3, -1.5, 150 + Math.sin(a) * r * 0.5, 0, 0, 0, 3), "#F6C1E0")); }
  GV.wfReeds = new T.Mesh(merge(rd), flatVC.clone()); // private fade material: must not dim shared bushes, ducks, deer or rabbits
  WF.add(GV.wfReeds);
  const duckG = merge([part(new T.IcosahedronGeometry(1, 1), trs(0, 0, 0, 0, 0, 0, 9, 5, 6), "#F4F1E6"), part(new T.IcosahedronGeometry(1, 1), trs(7, 6, 0, 0, 0, 0, 3.6), "#3C8A55"),
    part(new T.ConeGeometry(1.4, 4, 4), trs(11.5, 5.6, 0, 0, 0, -Math.PI / 2), "#F2A33A"), part(new T.ConeGeometry(3, 5, 4), trs(-9, 3, 0, 0, 0, Math.PI / 2.4), "#E6E1D2")]);
  GV.ducks = new T.InstancedMesh(duckG, flatVC, 3); GV.ducks.frustumCulled = false; WF.add(GV.ducks); GV.duckItems = [0, 1, 2].map(i => ({ ph: i * 2.1, r: 50 + i * 30 }));
  /* ---- FAUNA (ambient only, background scene: never in the gameplay plane, never collides, small and low-contrast) ---- */
  // deer grazing at the meadow/forest edge (head dips and rises), rabbits hopping, butterflies over the flowers
  const deerG = merge([part(new T.IcosahedronGeometry(1, 1), trs(0, 13, 0, 0, 0, 0, 11, 6, 5), "#B9773F"), part(new T.IcosahedronGeometry(1, 0), trs(0, 10.5, 0, 0, 0, 0, 9, 3.4, 4.2), "#F1E4CC"),
    ...[[-7, 2.4], [-6, -2.4], [7, 2.4], [6.5, -2.4]].map(([x, z]) => part(new T.CylinderGeometry(0.9, 0.7, 12, 4), trs(x, 6, z), "#8E5A2E")), part(new T.ConeGeometry(2, 4, 4), trs(-11, 15, 0, 0, 0, 1.2), "#F1E4CC")]);
  const headG = merge([part(new T.CylinderGeometry(1.6, 2.4, 9, 5), trs(0, 4.5, 0), "#B9773F"), part(new T.IcosahedronGeometry(1, 0), trs(1.6, 9.6, 0, 0, 0, 0, 3.6, 2.6, 2.4), "#B9773F"),
    part(new T.IcosahedronGeometry(1, 0), trs(4.6, 9.2, 0, 0, 0, 0, 1.1), "#2B2118"), part(new T.ConeGeometry(1.1, 3.4, 3), trs(0, 12.6, 1.4, 0.3, 0, 0), "#8E5A2E"), part(new T.ConeGeometry(1.1, 3.4, 3), trs(0, 12.6, -1.4, -0.3, 0, 0), "#8E5A2E")]);
  GV.deerBody = new T.InstancedMesh(deerG, flatVC, 3); GV.deerHead = new T.InstancedMesh(headG, flatVC, 3); GV.deerBody.frustumCulled = GV.deerHead.frustumCulled = false; G.add(GV.deerBody); G.add(GV.deerHead);
  GV.deer = []; for (let i = 0; i < 3; i++) GV.deer.push({ bx: 300 + i * 46 + rnd() * 30, d: 470 + rnd() * 60, ph: rnd() * 6, flip: i === 1 ? -1 : 1, s: 0.85 + rnd() * 0.2 });
  const rabG = merge([part(new T.IcosahedronGeometry(1, 1), trs(0, 3.4, 0, 0, 0, 0, 4.2, 3.3, 3), "#C9B9A2"), part(new T.IcosahedronGeometry(1, 0), trs(3.8, 5.4, 0, 0, 0, 0, 2.3), "#C9B9A2"),
    part(new T.ConeGeometry(0.8, 4.5, 4), trs(3.4, 8.6, 0.8, 0.2, 0, -0.2), "#BBA990"), part(new T.ConeGeometry(0.8, 4.5, 4), trs(3.4, 8.6, -0.8, -0.2, 0, -0.2), "#BBA990"), part(new T.IcosahedronGeometry(1, 0), trs(-4.2, 4, 0, 0, 0, 0, 1.3), "#FFFFFF")]);
  GV.rabbits = new T.InstancedMesh(rabG, flatVC, 4); GV.rabbits.frustumCulled = false; G.add(GV.rabbits); GV.rabItems = [0, 1, 2, 3].map(i => ({ bx: rnd() * 1600, d: 120 + rnd() * 200, ph: rnd() * 6, v: 9 + rnd() * 8 }));
  const bfly = new T.BufferGeometry(); bfly.setAttribute("position", new T.Float32BufferAttribute([0, 0, 0, -1, 0.2, 1.4, 1, 0.3, 1.2, 0, 0, 0, 1, 0.3, -1.2, -1, 0.2, -1.4], 3)); bfly.computeVertexNormals();
  GV.bflies = new T.InstancedMesh(bfly, new T.MeshBasicMaterial({ side: T.DoubleSide }), 14); GV.bflies.frustumCulled = false; G.add(GV.bflies);
  const bc = ["#FFD84A", "#FFFFFF", "#FF9F5A", "#8EC5FF", "#F6A6C8"]; GV.bfItems = [];
  for (let i = 0; i < 14; i++) { GV.bfItems.push({ bx: rnd() * 1500, d: 90 + rnd() * 240, y: 8 + rnd() * 30, ph: rnd() * 6, v: 6 + rnd() * 8, f: 9 + rnd() * 5 }); GV.bflies.setColorAt(i, new T.Color(bc[i % bc.length])); }
  GV.bflies.instanceColor.needsUpdate = true;
  // clouds: soft flat-shaded puffs far behind, high in the sky
  GV.cloudItems = []; for (let i = 0; i < 9; i++) GV.cloudItems.push({ d: 3600 + rnd() * 2400, bx: rnd() * 30000, y: 900 + rnd() * 1300, s: 1.6 + rnd() * 1.6, v: 4 + rnd() * 6 });
  GV.clouds = inst(new T.IcosahedronGeometry(1, 0), new T.MeshLambertMaterial({ color: "#FFFFFF", emissive: new T.Color("#7a8a9a"), flatShading: true }), GV.cloudItems.length * 5);
  // sun shafts (additive, very faint, behind everything in the play band)
  GV.shaftTex = canvasTex(8, 128, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "rgba(255,250,225,0.9)"); g.addColorStop(1, "rgba(255,250,225,0)"); x.fillStyle = g; x.fillRect(0, 0, w, h); });
  GV.shaftI = inst(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: GV.shaftTex, transparent: true, depthWrite: false, opacity: 0.05, blending: T.AdditiveBlending, fog: false }), 3);
  GV.shafts = []; for (let i = 0; i < 3; i++) GV.shafts.push(new T.Object3D());
  // distant birds (V shapes) and pollen motes
  GV.flock = []; const vG = merge([part(new T.BoxGeometry(1, 1, 1), trs(-5, 2, 0, 0, 0, 0.5, 11, 1.6, 1), "#3B4A66"), part(new T.BoxGeometry(1, 1, 1), trs(5, 2, 0, 0, 0, -0.5, 11, 1.6, 1), "#3B4A66")]);
  GV.flockI = inst(vG, vc("basic"), 7);
  for (let i = 0; i < 7; i++) { const m = new T.Object3D(); GV.flock.push({ m, d: 2200 + i * 40, bx: rnd() * 6000, y: 300 + rnd() * 260, ph: rnd() * 6, v: 30 + rnd() * 20 }); }
  const mp = new Float32Array(70 * 3); GV.motes = []; for (let i = 0; i < 70; i++) GV.motes.push({ bx: rnd() * 1600, y: rnd() * 600, d: 140 + rnd() * 400, ph: rnd() * 6 });
  const mg = new T.BufferGeometry(); mg.setAttribute("position", new T.BufferAttribute(mp, 3)); mg.setAttribute("color", new T.BufferAttribute(new Float32Array(70 * 4).fill(1), 4)); // B-12 P2: per-mote alpha
  GV.moteP = new T.Points(mg, new T.PointsMaterial({ color: "#FFF6C8", size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false, vertexColors: true })); GV.moteP.frustumCulled = false; G.add(GV.moteP);
  // perf: double-sided transparent materials would render in two passes (back+front) – one pass is visually identical for these flat cards
  G.traverse(n => { const m = n.material; if (m && m.side === T.DoubleSide) m.forceSinglePass = true; });
  // B-13: near/mid foreground instance groups are screened against the flight opening. Sky/weather layers stay exempt.
  // 6b (Martin t161u, "trees blur out and disappear"): the ridge trees (species crowns + trunks) are static background
  // scenery behind the gameplay plane. Screening them shrank ~80 % of all trees every frame (the approach zones of the
  // gates on screen cover most of the ridge band), so trees visibly shrank away and vanished. They are now exempt, the
  // same as the world kits, which never screened their trees; fauna, ground cover, motes and set-pieces stay guarded.
  const gvGapExempt = new Set([GV.clouds, GV.shaftI, GV.flockI, GV.mistI, GV.trunk, ...Object.values(GV.spec).map(s => s.mesh)]);
  GV.guardMeshes = []; G.traverse(n => { if (n.isInstancedMesh && !gvGapExempt.has(n)) GV.guardMeshes.push(n); });
  // Fixed waterfall components are not InstancedMesh; guard each component independently so the entire set-piece
  // does not disappear just because one small piece approaches an opening.
  GV.guardStatic = [GV.wfCliff, GV.wfFall, GV.wfPool, GV.wfReeds].filter(Boolean);
  GV.guardStaticGains = GV.guardStatic.map(() => 1);
  GV.guardStats = { checked: 0, hits: 0, hardHides: 0, staticChecked: 0, staticHits: 0 };
  GV.built = true;
}
const _m = new T.Matrix4(), _q = new T.Quaternion(), _p = new T.Vector3(), _s = new T.Vector3(), _e = new T.Euler(), _c0 = new T.Color(), _m2 = new T.Matrix4();
const wrapX = (base, camx, span) => base + span * Math.round((camx - base) / span);
/* B-12 P2 (background pop, root cause in checkpoints/B12.md): (1) motes wrapped horizontally with a fixed 1600 span and
   vertically with a modulo band whose ends lie inside the view → they jumped in view; now the horizontal span always exceeds
   the visible width at the mote's depth and the band ends are faded with a per-point alpha window (bandA). (2) The gap guard
   hid fauna/motes/set-pieces in ONE frame when they touched the gap margin; now it fades them out ahead of time in a wider
   approach zone (GG.near) and keeps the old instant hide only as a safety fallback (GG.stats.hard). */
const moteSpan = (visW, d) => Math.max(1600, visW(d) + 400);
const bandA = u => { u = u - Math.floor(u); const e = Math.min(u, 1 - u); return sstep((e - 0.02) / 0.13); }; // 0 at the wrap seam of a 0..1 band
function updateGV(R, S, o) {
  const cam = R.bgCam, camx = cam.position.x, t = o.rm ? 0 : (S.time || 0), v = R.view, DC = 760, gy = S.H - S.groundH;
  const visW = d => v.viewW * (DC + d) / DC;
  for (const r of GV.ridges) r.position.x = wrapX(0, camx, r.userData.P);
  let i = 0;
  const lo = R.quality === "low"; // low tier: fewer trees/flowers/animals (instancing count), same look
  for (const k in GV.spec) { const S2 = GV.spec[k], m = S2.mesh, def = S2.def; let n = 0;
    for (const tr of S2.list) { if (lo && (tr.c > 0.6)) continue; const L = tr.layer, P = L.userData.P, x = wrapX(tr.bx, camx, P * 0.5), base = ridgeHeightAt(L, x) - 6, s = tr.s;
      const sway = Math.sin(t * 1.1 + tr.ph) * 0.03 + tr.lean; _e.set(0, tr.ph, sway); _q.setFromEuler(_e);
      _p.set(x, base + def.trunkH * def.crownH * s * 0.6, -tr.d); _s.set(def.crownW * s, def.crownH * s, def.crownW * s); _m.compose(_p, _q, _s); m.setMatrixAt(n, _m); m.setColorAt(n, tr.col);
      n++; }
    m.count = n; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
  let ti = 0; _q.identity();
  for (const tr of GV.trees) { if (lo && tr.c > 0.6) continue; const def = GV.spec[tr.sp].def, L = tr.layer, x = wrapX(tr.bx, camx, L.userData.P * 0.5), base = ridgeHeightAt(L, x) - 6, s = tr.s, h = def.trunkH * def.crownH * s * 0.75 + 4 * s;
    _p.set(x, base + h / 2, -tr.d); _s.set((def.birch ? 1.6 : 2.4) * s, h, (def.birch ? 1.6 : 2.4) * s); _m.compose(_p, _q, _s); GV.trunk.setMatrixAt(ti, _m); GV.trunk.setColorAt(ti, _c0.copy(GV.trunkCol(tr))); ti++; }
  GV.trunk.count = ti; GV.trunk.instanceMatrix.needsUpdate = true; GV.trunk.instanceColor.needsUpdate = true;
  for (const B of GV.bushes) { let n = 0; B.items.forEach((b, k) => { if (lo && k % 2) return; const x = wrapX(b.bx, camx, 2000); _p.set(x, -gy + b.s * 0.3, -b.d); _s.set(b.s * 1.3, b.s, b.s); _m.compose(_p, _q, _s); B.m.setMatrixAt(n++, _m); }); B.m.count = n; B.m.instanceMatrix.needsUpdate = true; }
  GV.patchItems.forEach((p2, k) => { const x = wrapX(p2.bx, camx, 2600); _p.set(x, -gy + 0.3, -p2.d); _s.set(p2.w, 1, p2.l); _m.compose(_p, _q, _s); GV.patches.setMatrixAt(k, _m); }); GV.patches.instanceMatrix.needsUpdate = true;
  GV.fernItems.forEach((f, k) => { const x = wrapX(f.bx, camx, 2400); _e.set(0, f.r, 0); _q.setFromEuler(_e); _p.set(x, ridgeHeightAt(GV.near, x) - 6, -f.d); _s.setScalar(f.s); _m.compose(_p, _q, _s); GV.ferns.setMatrixAt(k, _m); });
  GV.ferns.visible = !lo; GV.flowers[1].m.visible = !lo; GV.bushes[2].m.visible = !lo; GV.ducks.visible = !lo; // low tier drops whole draws
  GV.ferns.count = GV.fernItems.length; GV.ferns.instanceMatrix.needsUpdate = true; _q.identity();
  for (const F of GV.flowers) { let n = 0; F.items.forEach((f, k) => { if (lo && k % 2) return; const x = wrapX(f.bx, camx, 1500); _e.set(0, f.ph, Math.sin(t * 1.6 + f.ph) * 0.12); _q.setFromEuler(_e); _p.set(x, -gy, -f.d); _s.setScalar(f.s); _m.compose(_p, _q, _s); F.m.setMatrixAt(n++, _m); });
    F.m.count = n; F.m.instanceMatrix.needsUpdate = true; }
  _q.identity();
  // fauna
  GV.duckItems.forEach((dk, k) => { const a = dk.ph + t * 0.12; _e.set(0, -a - Math.PI / 2, Math.sin(t * 1.4 + k) * 0.04); _q.setFromEuler(_e); _p.set(Math.cos(a) * dk.r, -2 + Math.sin(t * 1.7 + k) * 0.6, 150 + Math.sin(a) * dk.r * 0.45); _s.setScalar(1); _m.compose(_p, _q, _s); GV.ducks.setMatrixAt(k, _m); });
  GV.ducks.instanceMatrix.needsUpdate = true; _q.identity();
  GV.deer.forEach((d, k) => { const x = wrapX(d.bx, camx, 2600), cyc = (t * 0.25 + d.ph) % 1;
    const hz = cyc < 0.55 ? -1.25 + Math.sin(t * 6 + k) * 0.05 : (cyc < 0.62 ? -1.25 + (cyc - 0.55) / 0.07 * 1.25 : 0.05 * Math.sin(t * 2)); // graze, lift, look around
    _q.identity(); _p.set(x, ridgeHeightAt(GV.near, x) - 10, -d.d); _s.set(d.s * d.flip, d.s, d.s); _m.compose(_p, _q, _s); GV.deerBody.setMatrixAt(k, _m);
    _e.set(0, 0, hz); _q.setFromEuler(_e); _p.set(9, 15, 0); _s.set(1, 1, 1); _m2.compose(_p, _q, _s); _m.multiply(_m2); GV.deerHead.setMatrixAt(k, _m); });
  GV.deerBody.count = GV.deerHead.count = lo ? 2 : 3; GV.deerBody.instanceMatrix.needsUpdate = GV.deerHead.instanceMatrix.needsUpdate = true; _q.identity();
  GV.rabItems.forEach((r, k) => { const x = wrapX(r.bx + t * r.v, camx, 1600), hop = Math.abs(Math.sin(t * 3.2 + r.ph)); _p.set(x, -gy + hop * 7, -r.d); _e.set(0, 0, (hop - 0.5) * 0.3); _q.setFromEuler(_e); _s.setScalar(1.1); _m.compose(_p, _q, _s); GV.rabbits.setMatrixAt(k, _m); });
  GV.rabbits.count = lo ? 2 : 4; GV.rabbits.instanceMatrix.needsUpdate = true; _q.identity();
  GV.bfItems.forEach((b, k) => { const x = wrapX(b.bx + Math.sin(t * 0.3 + b.ph) * 60 + t * b.v, camx, 1500), y = -gy + b.y + Math.sin(t * 1.3 + b.ph) * 6;
    const flap = 0.25 + Math.abs(Math.sin(t * b.f + b.ph)); _e.set(0.3, Math.sin(t * 0.5 + b.ph), 0); _q.setFromEuler(_e); _p.set(x, y, -b.d); _s.set(2.6, 2.6, 2.6 * flap); _m.compose(_p, _q, _s); GV.bflies.setMatrixAt(k, _m); });
  GV.bflies.count = lo ? 6 : 14; GV.bflies.instanceMatrix.needsUpdate = true; _q.identity();
  GV.grassItems.forEach((g, k) => { const x = wrapX(g.bx, camx, 2200); _e.set(0, g.r, Math.sin(t * 1.3 + g.bx) * 0.08); _q.setFromEuler(_e); _p.set(x, -gy, -g.d); _s.set(g.s * 1.4, g.s * 1.6, g.s); _m.compose(_p, _q, _s); GV.grass.setMatrixAt(k, _m); });
  GV.grass.instanceMatrix.needsUpdate = true; _q.identity();
  // waterfall
  const WF = GV.wf, wx = wrapX(WF.userData.bx, camx, WF.userData.P); WF.position.set(wx, ridgeHeightAt(GV.mid2, wx) - 40, -WF.userData.d);
  GV.waterTex.offset.y = (t * 0.9) % 1;
  GV.mist.forEach((m, k) => { const s = 90 + 30 * Math.sin(t * 0.8 + k * 1.7); m.scale.set(s * 1.6, s, 1); m.updateMatrix(); GV.mistI.setMatrixAt(k, m.matrix); }); GV.mistI.material.opacity = 0.45 + 0.2 * Math.sin(t * 0.6); GV.mistI.instanceMatrix.needsUpdate = true;
  // clouds
  const puffs = [[0, 0, 70, 30], [-55, -8, 44, 22], [58, -6, 48, 24], [10, 18, 42, 22], [-20, 10, 36, 18]];
  GV.cloudItems.forEach((c, k) => { const x = wrapX(c.bx - t * c.v * 3, camx, visW(c.d) + 1600); for (let j = 0; j < 5; j++) { const p = puffs[j]; _p.set(x + p[0] * c.s, -gy + c.y + p[1] * c.s, -c.d); _s.set(p[2] * c.s, p[3] * c.s, p[2] * 0.5 * c.s); _m.compose(_p, _q, _s); GV.clouds.setMatrixAt(k * 5 + j, _m); } });
  GV.clouds.instanceMatrix.needsUpdate = true;
  // sun shafts: long faint planes fanning down from the sun position (upper right)
  const sd = 7000, sx = camx + 0.28 * visW(sd), syv = cam.position.y + v.viewH * 0.42 * (DC + sd) / DC;
  GV.shafts.forEach((m, k) => { m.position.set(sx - 1200 - k * 700, syv - 2400, -sd + 50); m.rotation.z = -0.5 - k * 0.12; m.scale.set(500 + k * 200, 5200, 1); m.updateMatrix(); GV.shaftI.setMatrixAt(k, m.matrix); }); GV.shaftI.material.opacity = o.rm ? 0.05 : 0.04 + 0.02 * Math.sin(t * 0.25); GV.shaftI.instanceMatrix.needsUpdate = true;
  // flock and motes
  GV.flock.forEach(f => { const x = wrapX(f.bx - t * f.v, camx, visW(f.d) + 800); f.m.position.set(x, cam.position.y + f.y * (DC + f.d) / DC * 0.6, -f.d); f.m.scale.set(1.4, 1 + 0.6 * Math.sin(t * 6 + f.ph), 1); f.m.updateMatrix(); GV.flockI.setMatrixAt(GV.flock.indexOf(f), f.m.matrix); }); GV.flockI.instanceMatrix.needsUpdate = true;
  const mp = GV.moteP.geometry.getAttribute("position");
  const ma = GV.moteP.geometry.getAttribute("color");
  GV.motes.forEach((m, k) => { const x = wrapX(m.bx + Math.sin(t * 0.4 + m.ph) * 20 - t * 6, camx, moteSpan(visW, m.d)), u = (m.y + t * 8) / 600; mp.setXYZ(k, x, -gy + 40 + 600 * (u - Math.floor(u)), -m.d); ma.setW(k, bandA(u)); });
  mp.needsUpdate = true; ma.needsUpdate = true;
  updateGVGapGuard(R, S);
}

/* ============================================================
   3b. WORLD KITS – Tropik, Vinter, Solnedgång, Magi (Martin 2026-11-14: approved plan, order Tropik → Vinter → Solnedgång → Magi).
   Same rules as Green Valley: background scene only (never the gameplay plane), one instanced draw per species / ground-cover
   kind / animal kind, low tier drops whole draws + cuts instance counts, reduced motion freezes all motion (t = 0).
   Species geometry is authored in game px with true vertex colours; per-instance colour = small brightness jitter.
   ============================================================ */
const KIT = { built: {}, cur: null };
const vcp = (g, mtx, col) => part(g, mtx, col);
let LODQ = 0; // r3 LOD: 1 while building the far-grove version of a species (fewer radial / trunk segments)
const lodN = n => LODQ ? Math.max(3, Math.round(n / 2)) : n;
const ico = (d) => new T.IcosahedronGeometry(1, d || 0), cone = (n) => new T.ConeGeometry(1, 1, lodN(n || 6)), cy = (n) => new T.CylinderGeometry(1, 1, 1, lodN(n || 6));
function flatLeaf(len, w, col, mtx) { const P = [0, 0, 0, len * 0.45, w, 0, len, 0, 0, 0, 0, 0, len, 0, 0, len * 0.45, -w * 0.35, 0]; const Q = P.slice();
  for (let i = 0; i < 18; i += 9) { const t = [Q[i + 3], Q[i + 4], Q[i + 5]]; Q[i + 3] = Q[i + 6]; Q[i + 4] = Q[i + 7]; Q[i + 5] = Q[i + 8]; Q[i + 6] = t[0]; Q[i + 7] = t[1]; Q[i + 8] = t[2]; }
  const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(P.concat(Q), 3)); g.computeVertexNormals(); return part(g, mtx, col); } // LOD leaf: 2 tris per face, both faces
const leaf = (len, w, col, mtx) => LODQ ? flatLeaf(len, w, col, mtx) : slabPart([[0, 0], [len * 0.45, w], [len, 0]], [[0, 0], [len * 0.45, -w * 0.35], [len, 0]], 0.6, mtx, col);
function curveTrunk(h, r0, r1, bend, segs, col) { const o = []; if (LODQ) segs = Math.max(2, Math.ceil(segs / 2)); for (let i = 0; i < segs; i++) { const a = i / segs, b = (i + 1) / segs, x0 = bend * a * a, x1 = bend * b * b, y0 = h * a, y1 = h * b, L = Math.hypot(x1 - x0, y1 - y0), ang = Math.atan2(x1 - x0, y1 - y0);
  o.push(vcp(new T.CylinderGeometry(r0 + (r1 - r0) * b, r0 + (r1 - r0) * a, L * 1.04, lodN(6)), trs((x0 + x1) / 2, (y0 + y1) / 2, 0, 0, 0, -ang), col)); } return o; }
const SPECIES = {
  /* ---- Tropik ---- */
  palm: () => { const h = 44, bend = 9, o = curveTrunk(h, 1.6, 2.4, bend, 5, "#9A6B3E");
    for (let i = 0; i < 8; i++) { const a = i / 8 * 6.28; o.push(leaf(22, 4.2, i % 2 ? "#2F9E5A" : "#3FB36A", trs(bend, h, 0, 0, -a, -0.35 - (i % 2) * 0.2))); }
    for (let i = 0; i < 3; i++) o.push(vcp(ico(0), trs(bend + Math.cos(i * 2.1) * 1.6, h - 2, Math.sin(i * 2.1) * 1.6, 0, 0, 0, 1.5), "#6B4A2B")); return merge(o); },
  banana: () => { const o = [vcp(cy(6), trs(0, 9, 0, 0, 0, 0, 1.6, 18, 1.6), "#7FA34A")];
    for (let i = 0; i < 6; i++) { const a = i / 6 * 6.28; o.push(leaf(18, 5.5, i % 2 ? "#4FBF5A" : "#62CC66", trs(0, 16 + (i % 3) * 1.5, 0, 0, -a, 0.55 + (i % 2) * 0.35))); } return merge(o); },
  monstera: () => { const o = []; for (let i = 0; i < 7; i++) { const a = i / 7 * 6.28; o.push(vcp(ico(0), trs(Math.cos(a) * 5, 5 + (i % 3) * 3, Math.sin(a) * 5, 0.4, a, 0.3, 6, 1.2, 4.5), i % 2 ? "#1F8A4C" : "#2A9C58")); }
    o.push(vcp(ico(0), trs(0, 9, 0, 0, 0, 0, 5, 1.2, 5), "#34A862")); return merge(o); },
  treefern: () => { const o = curveTrunk(26, 1.2, 1.6, 2, 3, "#5A4030"); for (let i = 0; i < 9; i++) { const a = i / 9 * 6.28; o.push(leaf(15, 2.6, i % 2 ? "#3E9A44" : "#52AE50", trs(2, 26, 0, 0, -a, -0.15))); } return merge(o); },
  bamboo: () => { const o = []; for (let i = 0; i < 5; i++) { const x = (i - 2) * 2.6, h = 40 + (i * 37 % 13); o.push(vcp(cy(5), trs(x, h / 2, (i % 2) * 2, 0, 0, (i - 2) * 0.03, 0.9, h, 0.9), i % 2 ? "#8CBF4A" : "#A2CC58"));
    for (let j = 0; j < 3; j++) o.push(leaf(8, 1.4, "#5FAE3E", trs(x, h * (0.55 + j * 0.15), 0, 0, i + j * 2, 0.5))); } return merge(o); },
  /* ---- Vinter ---- */
  snowspruce: () => { const o = [vcp(cy(5), trs(0, 3, 0, 0, 0, 0, 1.4, 6, 1.4), "#5A3E2A")];
    for (let i = 0; i < 4; i++) { const r = 11 - i * 2.3, y = 6 + i * 8; o.push(vcp(cone(7), trs(0, y + 5, 0, 0, i * 0.4, 0, r, 11, r), i % 2 ? "#2B6E4E" : "#2F7752")); o.push(vcp(cone(7), trs(0, y + 7.2, 0, 0, i * 0.4, 0, r * 0.72, 6.6, r * 0.72), "#F4F9FF")); } return merge(o); },
  frostpine: () => merge([vcp(cy(5), trs(0, 4, 0, 0, 0, 0, 1.2, 8, 1.2), "#5A3E2A"), vcp(cone(6), trs(0, 22, 0, 0, 0, 0, 8.5, 30, 8.5), "#7FA9A0"), vcp(cone(6), trs(0, 27, 0, 0, 0.5, 0, 5.5, 20, 5.5), "#E2F0F6")]),
  barebirch: () => { const o = [vcp(cy(5), trs(0, 17, 0, 0, 0, 0.04, 1.3, 34, 1.3), "#EDEBE4")]; const q = lcg(11);
    for (let i = 0; i < 7; i++) { const y = 12 + i * 3.4, s = i % 2 ? 1 : -1; o.push(vcp(cy(3), trs(s * 4, y + 3, 0, 0, i, s * -0.9, 0.35, 10 - i * 0.6, 0.35), "#5E4E44")); }
    for (let i = 0; i < 4; i++) o.push(vcp(cy(4), trs(0, 6 + i * 7, 0, 0, 0, 0, 1.36, 0.7, 1.36), "#2E2A2A")); return merge(o); },
  deadtree: () => { const o = curveTrunk(28, 1.4, 2.6, -3, 3, "#6B5A50"); o.push(vcp(cy(3), trs(-6, 22, 0, 0, 0, 0.9, 0.6, 14, 0.6), "#6B5A50"), vcp(cy(3), trs(4, 25, 0, 0, 0, -0.7, 0.5, 11, 0.5), "#6B5A50"));
    for (let i = 0; i < 5; i++) o.push(vcp(cone(4), trs(-9 + i * 2.2, 25.5 - (i % 2), 0, Math.PI, 0, 0, 0.5, 3.2 + (i % 3), 0.5), "#BFE8FF")); return merge(o); },
  /* ---- Solnedgång (dusk silhouettes, warm rim) ---- */
  acacia: () => { const o = curveTrunk(22, 1.0, 1.6, 4, 3, "#2E2036"); o.push(vcp(cy(3), trs(7, 20, 0, 0, 0, -0.8, 0.5, 10, 0.5), "#2E2036"));
    o.push(vcp(ico(1), trs(4, 26, 0, 0, 0, 0, 20, 3.6, 9), "#3A2846"), vcp(ico(0), trs(10, 25.5, 0, 0, 0.4, 0, 9, 2.6, 6), "#43304F")); return merge(o); },
  cypress: () => merge([vcp(cy(4), trs(0, 2, 0, 0, 0, 0, 1, 4, 1), "#24182C"), vcp(ico(1), trs(0, 22, 0, 0, 0, 0, 5.2, 21, 5.2), "#2C1F3A")]),
  olive: () => { const o = curveTrunk(12, 1.4, 2.4, 2, 2, "#3A2A30"); o.push(vcp(ico(0), trs(0, 17, 0, 0, 0, 0, 10, 7, 8), "#4A4256"), vcp(ico(0), trs(-6, 15, 2, 0, 0.7, 0, 6, 5, 6), "#544A5E"), vcp(ico(0), trs(6, 16, -1, 0, 1.4, 0, 6, 5, 6), "#4E4558")); return merge(o); },
  sheaf: () => { const o = []; for (let i = 0; i < 7; i++) o.push(vcp(cy(3), trs((i - 3) * 0.8, 9, 0, 0, 0, (i - 3) * 0.08, 0.35, 18, 0.35), "#C9964A")); o.push(vcp(cy(6), trs(0, 7, 0, 0, 0, 0, 2.4, 1.4, 2.4), "#8A6234")); return merge(o); },
  /* ---- Magi (glow) ---- */
  crystaltree: () => { const o = [vcp(cy(5), trs(0, 6, 0, 0, 0, 0, 1.2, 12, 1.2), "#3E3570")];
    for (let i = 0; i < 6; i++) { const a = i / 6 * 6.28, r = 3 + (i % 2) * 2; o.push(vcp(cone(4), trs(Math.cos(a) * r, 18 + (i % 3) * 4, Math.sin(a) * r, Math.sin(a) * 0.4, 0, Math.cos(a) * 0.4, 2.2, 14 + (i % 2) * 5, 2.2), i % 2 ? "#7FE8FF" : "#B79BFF")); } return merge(o); },
  mushroom: () => merge([vcp(new T.CylinderGeometry(1.6, 2.4, 1, 7), trs(0, 9, 0, 0, 0, 0, 1, 18, 1), "#EFE6FF"), vcp(new T.SphereGeometry(1, 10, 5, 0, 6.29, 0, 1.7), trs(0, 17, 0, 0, 0, 0, 12, 7, 12), "#FF6FCF"),
    ...[0, 1, 2, 3, 4].map(i => vcp(ico(0), trs(Math.cos(i * 1.3) * 7, 22, Math.sin(i * 1.3) * 7, 0, 0, 0, 1.2), "#FFF6A8"))]),
  spiralvine: () => { const o = []; for (let i = 0; i < 9; i++) { const a = i * 0.9, y = i * 4; o.push(vcp(cy(4), trs(Math.cos(a) * 3, y + 2, Math.sin(a) * 3, 0, -a, 0.5, 1.2, 6, 1.2), "#5A4AB0")); }
    o.push(vcp(ico(0), trs(0, 38, 0, 0, 0, 0, 7, 5, 7), "#8F7BFF")); return merge(o); },
  lilystone: () => merge([vcp(new T.CylinderGeometry(6, 3, 3, 7), trs(0, 22, 0), "#4B3C95"), vcp(new T.CylinderGeometry(6.2, 6.2, 0.6, 7), trs(0, 23.8, 0), "#6FE8C8"), vcp(cone(5), trs(0, 18.5, 0, Math.PI, 0, 0, 3, 5, 3), "#3A2F7A")])
};
/* ground cover / small props (vertex coloured, instanced, on the meadow floor) */
const GROUND = {
  hibiscus: () => merge([vcp(ico(0), trs(0, 3, 0, 0, 0, 0, 5, 4, 4), "#2F9E5A"), ...[0, 1, 2, 3, 4].map(i => vcp(cone(5), trs(Math.cos(i * 1.3) * 3.6, 5 + (i % 2), Math.sin(i * 1.3) * 3, 0, 0, Math.PI / 2, 1.2, 1.4, 1.2), i % 2 ? "#FF4F7A" : "#FF7A3C"))]),
  paradise: () => { const o = []; for (let i = 0; i < 3; i++) { const x = (i - 1) * 2.4; o.push(vcp(cy(3), trs(x, 4, 0, 0, 0, 0, 0.3, 8, 0.3), "#3F8A3A"), vcp(cone(4), trs(x + 1.2, 8.3, 0, 0, 0, -1.3, 0.9, 3.4, 0.9), "#FF8A1C"), vcp(cone(4), trs(x + 1.6, 9, 0, 0, 0, -0.8, 0.5, 2, 0.5), "#3E6BFF")); } return merge(o); },
  beachgrass: () => merge([0, 1, 2, 3, 4].map(i => vcp(cone(3), trs((i - 2) * 0.9, 3, 0, 0, i, (i - 2) * 0.22, 0.5, 6.5, 0.5), i % 2 ? "#B9C46A" : "#9DB45A"))),
  shells: () => merge([vcp(ico(0), trs(0, 0.4, 0, 0, 0, 0, 1.4, 0.6, 1.1), "#FFE3D2"), vcp(ico(0), trs(3, 0.3, 1.5, 0, 1, 0, 1, 0.5, 0.8), "#F5C1D0"), vcp(ico(0), trs(-2.6, 0.4, -1, 0, 2, 0, 1.2, 0.7, 1), "#E7DCC8")]),
  drift: () => merge([vcp(ico(1), trs(0, 0, 0, 0, 0, 0, 9, 2.6, 5), "#F7FBFF"), vcp(ico(0), trs(5, 0.5, 1, 0, 0.6, 0, 5, 2.2, 3.6), "#E6F0FA")]),
  frozenreed: () => merge([0, 1, 2, 3].map(i => vcp(cy(3), trs((i - 1.5) * 1.1, 4.5, (i % 2) * 0.6, 0, 0, (i - 1.5) * 0.1, 0.25, 9, 0.25), i % 2 ? "#C9D6CC" : "#AFC2BC"))),
  holly: () => merge([vcp(ico(0), trs(0, 3, 0, 0, 0, 0, 4.5, 3.6, 4), "#1F5E3C"), ...[0, 1, 2, 3, 4, 5].map(i => vcp(ico(0), trs(Math.cos(i) * 3.4, 4 + (i % 2), Math.sin(i) * 3, 0, 0, 0, 0.8), "#E0283F")), vcp(cone(7), trs(0, 5.8, 0, 0, 0, 0, 3.6, 1.6, 3.4), "#F4F9FF")]),
  icecrystal: () => merge([vcp(cone(4), trs(0, 2.2, 0, 0, 0, 0.2, 1, 4.4, 1), "#BFEFFF"), vcp(cone(4), trs(1.6, 1.4, 0.4, 0, 0, -0.5, 0.7, 2.8, 0.7), "#E3F8FF")]),
  lavender: () => merge([0, 1, 2, 3, 4, 5].map(i => vcp(cy(3), trs((i - 2.5) * 1.6, 3, 0, 0, 0, (i - 2.5) * 0.05, 0.5, 6, 0.5), i % 2 ? "#8E6BD8" : "#A383E6")).concat([vcp(ico(0), trs(0, 0.8, 0, 0, 0, 0, 5, 1.6, 2), "#3A5E3A")])),
  wheat: () => merge([0, 1, 2, 3, 4].map(i => vcp(cy(3), trs((i - 2) * 0.9, 4, 0, 0, 0, (i - 2) * 0.1, 0.3, 8, 0.3), "#D9A848")).concat([0, 1, 2, 3, 4].map(i => vcp(ico(0), trs((i - 2) * 0.9 + (i - 2) * 0.8, 8.4, 0, 0, 0, 0, 0.6, 1.4, 0.6), "#F0C460")))),
  duskpoppy: () => merge([0, 1, 2].map(i => vcp(cy(3), trs((i - 1) * 2, 2.6, 0, 0, 0, 0, 0.25, 5.2, 0.25), "#3A5E3A")).concat([0, 1, 2].map(i => vcp(cone(5), trs((i - 1) * 2, 5.4, 0, Math.PI, 0, 0, 1.3, 0.8, 1.3), "#FF4A3A")))),
  haybale: () => merge([vcp(new T.CylinderGeometry(4, 4, 6, 10), trs(0, 4, 0, Math.PI / 2, 0, 0), "#D9AE58"), vcp(new T.CylinderGeometry(4.05, 4.05, 1, 10), trs(0, 4, 0, Math.PI / 2, 0, 0), "#B88A3C")]),
  glowmoss: () => merge([vcp(new T.CylinderGeometry(6, 6, 0.4, 8), trs(0, 0.2, 0, 0, 0, 0, 1, 1, 0.6), "#3FD6B0"), vcp(new T.CylinderGeometry(3, 3, 0.5, 6), trs(4, 0.3, 1, 0, 0, 0, 1, 1, 0.6), "#6FF0D0")]),
  bellflower: () => merge([0, 1, 2].map(i => vcp(cy(3), trs((i - 1) * 1.8, 3, 0, 0, 0, (i - 1) * 0.2, 0.22, 6, 0.22), "#5A7AC8")).concat([0, 1, 2].map(i => vcp(cone(5), trs((i - 1) * 1.8 + (i - 1) * 0.6, 6, 0, 0, 0, 0, 1.1, 1.6, 1.1), "#FFD0FF")))),
  shard: () => merge([vcp(cone(4), trs(0, 3, 0, 0, 0, 0.15, 1.2, 6, 1.2), "#9DF2FF"), vcp(cone(4), trs(1.8, 1.8, 0.6, 0, 0, -0.4, 0.8, 3.6, 0.8), "#C79BFF")])
};
/* animals (vertex coloured; one instanced draw per kind) */
const ANIMALS = {
  parrot: () => merge([vcp(ico(1), trs(0, 0, 0, 0, 0, 0, 4.2, 2.2, 2), "#E8402E"), vcp(ico(0), trs(4, 1, 0, 0, 0, 0, 1.8), "#E8402E"), vcp(cone(4), trs(5.8, 0.6, 0, 0, 0, -1.6, 0.7, 1.6, 0.7), "#F2C14E"),
    slabPart([[0, 0], [-2, 7], [-5, 6]], [[-3, 0], [-4, 4], [-5, 6]], 0.4, trs(1, 1, 0, Math.PI / 2, 0, 0), "#2F7FE8"), slabPart([[0, 0], [-2, -7], [-5, -6]], [[-3, 0], [-4, -4], [-5, -6]], 0.4, trs(1, 1, 0, Math.PI / 2, 0, 0), "#2F7FE8"),
    vcp(cone(4), trs(-6, -0.4, 0, 0, 0, Math.PI / 2, 1, 5, 0.6), "#2F7FE8")]),
  turtle: () => merge([vcp(new T.SphereGeometry(1, 8, 4, 0, 6.29, 0, 1.6), trs(0, 0, 0, 0, 0, 0, 6, 3.4, 4.6), "#5F8A3E"), vcp(ico(0), trs(6.4, 1, 0, 0, 0, 0, 1.6, 1.3, 1.3), "#8CA866"),
    ...[[3.5, 3.5], [3.5, -3.5], [-3.5, 3.5], [-3.5, -3.5]].map(([x, z]) => vcp(ico(0), trs(x, 0.2, z, 0, 0, 0, 1.6, 0.6, 1.1), "#8CA866"))]),
  crab: () => merge([vcp(ico(0), trs(0, 1.4, 0, 0, 0, 0, 3, 1.4, 2.2), "#E8543A"), vcp(ico(0), trs(0.5, 2.2, 3, 0, 0, 0, 1.2), "#F06A4A"), vcp(ico(0), trs(0.5, 2.2, -3, 0, 0, 0, 1.2), "#F06A4A"),
    ...[-1.6, 0, 1.6].map(x => vcp(cy(3), trs(x, 0.6, 0, Math.PI / 2, 0, 0, 0.25, 6, 0.25), "#C8402A"))]),
  dragonfly: () => merge([vcp(cy(4), trs(0, 0, 0, 0, 0, Math.PI / 2, 0.35, 6, 0.35), "#2FB8E8"), slabPart([[0, 0], [1, 4], [-1, 4.2]], [[0, 0], [-1, 4.2], [-1, 4.2]], 0.1, trs(1, 0.2, 0, Math.PI / 2, 0, 0), "#DDF6FF"),
    slabPart([[0, 0], [1, -4], [-1, -4.2]], [[0, 0], [-1, -4.2], [-1, -4.2]], 0.1, trs(1, 0.2, 0, Math.PI / 2, 0, 0), "#DDF6FF")]),
  fish: () => merge([vcp(ico(0), trs(0, 0, 0, 0, 0, 0, 4, 1.8, 1.2), "#FF9F3A"), vcp(cone(3), trs(-4.4, 0, 0, 0, 0, Math.PI / 2, 1.6, 2.4, 0.4), "#FFB85A")]),
  reindeer: () => merge([vcp(ico(1), trs(0, 13, 0, 0, 0, 0, 10, 5.6, 4.8), "#8A6A50"), vcp(ico(0), trs(0, 10.6, 0, 0, 0, 0, 8, 3, 4), "#E6DCCB"),
    ...[[-6.5, 2.2], [-5.5, -2.2], [6.5, 2.2], [6, -2.2]].map(([x, z]) => vcp(cy(4), trs(x, 5.5, z, 0, 0, 0, 0.9, 11, 0.9), "#5A4232")),
    vcp(cy(5), trs(9, 17, 0, 0, 0, -0.6, 1.8, 8, 1.8), "#8A6A50"), vcp(ico(0), trs(13, 21, 0, 0, 0, 0, 3.4, 2.4, 2.2), "#8A6A50"), vcp(ico(0), trs(16, 20.6, 0, 0, 0, 0, 0.9), "#2B2118"),
    ...[1, -1].map(s => vcp(cy(3), trs(12, 26, s * 1.6, s * 0.3, 0, 0.3, 0.4, 8, 0.4), "#D9C4A0")), ...[1, -1].map(s => vcp(cy(3), trs(10.6, 28, s * 2.4, s * 0.6, 0, 1.1, 0.35, 5, 0.35), "#D9C4A0"))]),
  hare: () => merge([vcp(ico(1), trs(0, 3.4, 0, 0, 0, 0, 4.2, 3.3, 3), "#FFFFFF"), vcp(ico(0), trs(3.8, 5.4, 0, 0, 0, 0, 2.3), "#F4F6FA"), vcp(cone(4), trs(3.4, 8.6, 0.8, 0.2, 0, -0.2, 0.8, 4.5, 0.8), "#E8ECF2"),
    vcp(cone(4), trs(3.4, 8.6, -0.8, -0.2, 0, -0.2, 0.8, 4.5, 0.8), "#E8ECF2"), vcp(ico(0), trs(4.8, 6, 1.2, 0, 0, 0, 0.4), "#2B2118")]),
  owl: () => merge([vcp(ico(1), trs(0, 4, 0, 0, 0, 0, 3.4, 4.6, 3), "#F4F6FA"), vcp(ico(1), trs(0.4, 9, 0, 0, 0, 0, 3, 2.8, 2.8), "#FFFFFF"), vcp(ico(0), trs(2.6, 9.4, 1.2, 0, 0, 0, 0.8), "#F2C14E"), vcp(ico(0), trs(2.6, 9.4, -1.2, 0, 0, 0, 0.8), "#F2C14E"),
    ...[0, 1, 2].map(i => vcp(ico(0), trs(-0.5 + i, 3 + i * 1.4, 2.6, 0, 0, 0, 0.5), "#9AA0A8"))]),
  robin: () => merge([vcp(ico(1), trs(0, 2.2, 0, 0, 0, 0, 2.6, 2, 1.8), "#7A5A44"), vcp(ico(0), trs(1.2, 1.8, 0, 0, 0, 0, 1.8, 1.5, 1.6), "#E8603A"), vcp(ico(0), trs(2.2, 3.4, 0, 0, 0, 0, 1.3), "#7A5A44"), vcp(cone(3), trs(3.6, 3.3, 0, 0, 0, -1.57, 0.4, 1, 0.4), "#E8B04A")]),
  fox: () => merge([vcp(ico(1), trs(0, 7, 0, 0, 0, 0, 7, 3.4, 3), "#D9703A"), vcp(ico(0), trs(7.4, 8.4, 0, 0, 0, 0, 2.8, 2.4, 2.2), "#D9703A"), vcp(cone(4), trs(10.4, 7.8, 0, 0, 0, -1.57, 1, 2.6, 1), "#F4E6D6"),
    ...[1, -1].map(s => vcp(cone(3), trs(7.2, 11.2, s * 1.1, 0, 0, 0, 0.8, 2.4, 0.6), "#B85A2A")), vcp(cone(5), trs(-9, 7.6, 0, 0, 0, Math.PI / 2 + 0.3, 2.2, 8, 2.2), "#D9703A"), vcp(ico(0), trs(-12.6, 6.6, 0, 0, 0, 0, 1.3), "#F4E6D6"),
    ...[[-4, 1.4], [-4, -1.4], [4, 1.4], [4, -1.4]].map(([x, z]) => vcp(cy(3), trs(x, 2.6, z, 0, 0, 0, 0.6, 5.2, 0.6), "#3A2420"))]),
  bat: () => merge([vcp(ico(0), trs(0, 0, 0, 0, 0, 0, 1.6, 1.2, 1.2), "#2A1A33"), slabPart([[0, 0], [-1, 5], [1.5, 7]], [[0, 0], [2, 3], [1.5, 7]], 0.2, trs(0, 0, 0, Math.PI / 2, 0, 0), "#2A1A33"),
    slabPart([[0, 0], [-1, -5], [1.5, -7]], [[0, 0], [2, -3], [1.5, -7]], 0.2, trs(0, 0, 0, Math.PI / 2, 0, 0), "#2A1A33")]),
  crane: () => merge([vcp(cy(4), trs(0, 0, 0, 0, 0, Math.PI / 2, 0.8, 10, 0.8), "#3A2A48"), slabPart([[0, 0], [-2, 9], [2, 10]], [[0, 0], [3, 4], [2, 10]], 0.2, trs(0, 0, 0, Math.PI / 2, 0, 0), "#3A2A48"),
    slabPart([[0, 0], [-2, -9], [2, -10]], [[0, 0], [3, -4], [2, -10]], 0.2, trs(0, 0, 0, Math.PI / 2, 0, 0), "#3A2A48")]),
  moth: () => merge([vcp(ico(0), trs(0, 0, 0, 0, 0, 0, 1, 0.6, 0.6), "#FFF6C8"), slabPart([[0, 0], [-1, 3], [1.5, 3.4]], [[0, 0], [1.6, 1.6], [1.5, 3.4]], 0.1, trs(0, 0, 0, Math.PI / 2, 0, 0), "#C7F6FF"),
    slabPart([[0, 0], [-1, -3], [1.5, -3.4]], [[0, 0], [1.6, -1.6], [1.5, -3.4]], 0.1, trs(0, 0, 0, Math.PI / 2, 0, 0), "#C7F6FF")]),
  moondeer: () => merge([vcp(ico(1), trs(0, 13, 0, 0, 0, 0, 10, 5, 4.4), "#CFC6FF"), ...[[-6.5, 2], [-5.5, -2], [6.5, 2], [6, -2]].map(([x, z]) => vcp(cy(4), trs(x, 5.5, z, 0, 0, 0, 0.8, 11, 0.8), "#B5A8F0")),
    vcp(cy(5), trs(9, 17.5, 0, 0, 0, -0.5, 1.6, 8, 1.6), "#CFC6FF"), vcp(ico(0), trs(12.6, 21.4, 0, 0, 0, 0, 3.2, 2.2, 2), "#E4DEFF"), ...[1, -1].map(s => vcp(cone(4), trs(11.4, 26, s * 1.4, s * 0.3, 0, -0.3, 0.6, 6, 0.6), "#9DF2FF"))]),
  jelly: () => merge([vcp(new T.SphereGeometry(1, 10, 5, 0, 6.29, 0, 1.6), trs(0, 0, 0, 0, 0, 0, 5, 4, 5), "#FFB8F0"), ...[0, 1, 2, 3, 4].map(i => vcp(cy(3), trs(Math.cos(i * 1.26) * 2.6, -3.4, Math.sin(i * 1.26) * 2.6, 0, 0, 0, 0.25, 6, 0.25), "#FFD6FF"))])
};
/* ---- per-world kit data ---- */
const KITS = {
  tropic: { sky: ["#2FA9E6", "#7FE0E0", "#CFF3D8", "#FFF2C4"], fog: ["#CFEFE8", 900, 9000], floor: "#F2DF9E", hemi: ["#FFF6E0", "#6FB88A"], sun: ["#FFF4D6", 2.2], key: [0.4, 0.75, 0.55],
    ridges: [[9000, 90, -448, 520, 6200, 61, "#8FC9C0", "#B8E2DA", null, 30], [7000, 80, -588, 360, 4600, 62, "#6FBFA8", "#94D4BE", null, 0], [5200, 70, -668, 260, 2600, 63, "#4FAE80", "#76C99A", null, 0],
      [3600, 60, -718, 150, 1500, 64, "#3FA672", "#62C08C", null, 0], [2400, 48, -738, 50, 620, 65, "#E6D290", "#F2E2A8", null, 0]],
    species: { palm: 1, banana: 1, monstera: 1, treefern: 1, bamboo: 1 },
    groves: [[14, -1, 300, 480, 0.8, 1.15, { palm: 3, banana: 2, monstera: 2, treefern: 1 }], [26, 4, 560, 700, 0.75, 1.1, { palm: 4, banana: 2, monstera: 1 }], [44, 3, 1420, 1560, 1.3, 1.9, { palm: 2, banana: 2, treefern: 2, bamboo: 2, monstera: 1 }], [50, 2, 2500, 2660, 2.0, 2.8, { palm: 2, treefern: 2, bamboo: 3 }]],
    ground: [["hibiscus", 20, 120, 420, 0.9, 1.4], ["paradise", 22, 80, 300, 0.9, 1.3, 1], ["beachgrass", 60, 50, 500, 0.9, 1.5], ["shells", 30, 40, 260, 1, 1.6, 1]],
    fauna: [["parrot", "flyer", 4, 2, { d: [900, 1300], y: [180, 300], v: 40 }], ["turtle", "walker", 2, 1, { d: [90, 160], v: 2.5 }], ["crab", "crab", 5, 3, { d: [60, 200], v: 10 }],
      ["dragonfly", "flyer", 6, 3, { d: [90, 260], y: [14, 40], v: 12, small: 1 }], ["fish", "jumper", 3, 0, { d: [1300, 1420] }]],
    set: "lagoon", clouds: ["#FFFFFF", "#8aa"], motes: ["petals", 50, 24, "#FFB8D0"] },
  winter: { sky: ["#7FB2E6", "#B9D6F2", "#E6F1FB", "#FFFFFF"], fog: ["#E4EEF8", 800, 8500], floor: "#F4F8FC", hemi: ["#F4FAFF", "#A9BED2"], sun: ["#F6FAFF", 2.0], key: [0.45, 0.7, 0.55],
    ridges: [[9000, 90, -448, 900, 6200, 71, "#A9BFDC", "#CBDAEC", -448 + 560, 70], [7000, 80, -588, 620, 4600, 72, "#93ADC9", "#B6CBE0", -588 + 360, 40], [5200, 70, -668, 300, 2600, 73, "#BCCFE2", "#DCE8F4", -668 + 160, 0],
      [3600, 60, -718, 170, 1500, 74, "#C6D8EA", "#E4EEF8", null, 0], [2400, 48, -738, 70, 620, 75, "#D6E4F0", "#F0F6FC", null, 0]],
    species: { snowspruce: 1, frostpine: 1, barebirch: 1, deadtree: 1 },
    groves: [[14, -1, 300, 480, 0.75, 1.1, { snowspruce: 3, barebirch: 2, frostpine: 1 }], [28, 4, 560, 720, 0.7, 1.1, { snowspruce: 3, barebirch: 3, frostpine: 1, deadtree: 1 }], [46, 3, 1420, 1580, 1.3, 2.0, { snowspruce: 4, frostpine: 2, barebirch: 1 }], [54, 2, 2500, 2680, 2.0, 2.9, { snowspruce: 5, frostpine: 3 }]],
    ground: [["drift", 26, 60, 520, 1, 2], ["frozenreed", 30, 70, 380, 1, 1.5], ["holly", 14, 120, 420, 1, 1.4, 1], ["icecrystal", 26, 50, 300, 1, 1.6]],
    fauna: [["reindeer", "grazer", 2, 1, { d: [470, 540] }], ["hare", "hopper", 3, 2, { d: [120, 320] }], ["owl", "perch", 1, 1, { tree: "deadtree" }], ["robin", "hopper", 4, 0, { d: [70, 200], small: 1 }]],
    set: "frozenfall", clouds: ["#FFFFFF", "#9aa8b8"], motes: ["snow", 110, 50, "#FFFFFF"] },
  sunset: { sky: ["#3B2D5E", "#8A3F6E", "#E86A5A", "#FFB06A"], fog: ["#B8667A", 700, 7000], floor: "#5A3E4A", hemi: ["#FFB4A0", "#3A2840"], sun: ["#FFCF9A", 2.0], key: [-0.3, 0.45, 0.6],
    ridges: [[9000, 90, -448, 520, 6200, 81, "#6A4A78", "#8A5A82", null, 30], [7000, 80, -588, 340, 4600, 82, "#5A3E6A", "#76507A", null, 0], [5200, 70, -668, 240, 2600, 83, "#4A3558", "#62466E", null, 0],
      [3600, 60, -718, 150, 1500, 84, "#3E2C4C", "#54405E", null, 0], [2400, 48, -738, 60, 620, 85, "#5E4250", "#7A5660", null, 0]],
    species: { acacia: 1, cypress: 1, olive: 1, sheaf: 1 },
    groves: [[12, -1, 300, 480, 0.8, 1.15, { olive: 3, cypress: 2, sheaf: 3 }], [24, 4, 560, 700, 0.75, 1.1, { olive: 3, cypress: 2, sheaf: 3 }], [40, 3, 1420, 1560, 1.3, 1.9, { acacia: 3, cypress: 3, olive: 2 }], [44, 2, 2500, 2660, 2.0, 2.8, { acacia: 3, cypress: 3 }]],
    ground: [["lavender", 30, 80, 420, 1, 1.5], ["wheat", 50, 60, 480, 1, 1.5], ["duskpoppy", 26, 60, 300, 1, 1.4, 1], ["haybale", 6, 220, 480, 1, 1.3]],
    fauna: [["fox", "walker", 1, 1, { d: [380, 460], v: 14 }], ["owl", "perch", 1, 0, { post: 1 }], ["bat", "bat", 6, 3, { d: [1200, 1700], y: [260, 380] }], ["crane", "flock", 5, 3, { d: [2200, 2300], y: [380, 460], v: 26 }]],
    set: "windmill", clouds: ["#FFC7A8", "#a56a6a"], motes: ["fireflies", 60, 30, "#FFF2A0"], dark: 1 },
  magic: { sky: ["#12082E", "#3A1A63", "#7A2F8F", "#C44F9E"], fog: ["#3A2A6E", 700, 7500], floor: "#4A3A90", hemi: ["#8F9CFF", "#1A1438"], sun: ["#C9D6FF", 1.6], key: [0.3, 0.6, 0.6],
    ridges: [[9000, 90, -448, 560, 6200, 91, "#3A2560", "#55357A", null, 40], [7000, 80, -588, 360, 4600, 92, "#2E2052", "#46306C", null, 0], [5200, 70, -668, 250, 2600, 93, "#3A2C78", "#4E3C92", null, 0],
      [3600, 60, -718, 150, 1500, 94, "#33296E", "#463A88", null, 0], [2400, 48, -738, 60, 620, 95, "#4A3AA0", "#5A4AB0", null, 0]],
    species: { crystaltree: 2, mushroom: 2, spiralvine: 1, lilystone: 1 },
    groves: [[12, -1, 300, 480, 0.8, 1.15, { mushroom: 3, crystaltree: 2, spiralvine: 1 }], [24, 4, 560, 700, 0.75, 1.1, { mushroom: 3, crystaltree: 2, spiralvine: 1 }], [40, 3, 1420, 1560, 1.3, 1.9, { crystaltree: 3, spiralvine: 2, mushroom: 2, lilystone: 1 }], [40, 2, 2500, 2660, 2.0, 2.8, { crystaltree: 3, spiralvine: 2, lilystone: 1 }]],
    ground: [["glowmoss", 26, 60, 460, 1, 1.8, 0, 1], ["bellflower", 34, 60, 320, 1, 1.4, 0, 1], ["shard", 24, 60, 400, 1, 1.6, 1, 1]],
    fauna: [["moth", "flyer", 8, 4, { d: [90, 260], y: [12, 40], v: 8, small: 1, glow: 1 }], ["moondeer", "grazer", 1, 1, { d: [480, 520], glow: 1 }], ["jelly", "floater", 4, 2, { d: [1400, 1700], y: [140, 300], glow: 1 }]],
    set: "floating", clouds: ["#8F86C9", "#504080"], motes: ["sparkle", 70, 34, "#9DF2FF"], dark: 1 }
};
/* species render: lit (Lambert, flat) unless the species glows (Magi crystal/mushroom/lily: unlit, fogged) */
const GLOW = { crystaltree: 1, mushroom: 1, lilystone: 1 };
function buildKit(R, key) {
  const K = KITS[key], bg = R.bg, rnd = lcg(0x51D0 + key.length * 977), G = new T.Group(); G.name = "kit:" + key; bg.add(G);
  const E = { key, K, G, inst: [] };
  const inst = (geo, mat, n) => { const m = new T.InstancedMesh(geo, mat, Math.max(1, n)); m.frustumCulled = false; G.add(m); return m; };
  const flatVC = new T.MeshLambertMaterial({ flatShading: true, vertexColors: true }), glowVC = new T.MeshBasicMaterial({ vertexColors: true });
  const glowDim = new T.MeshBasicMaterial({ vertexColors: true, color: new T.Color(0.62, 0.62, 0.68) }); // unlit but dimmed (Magi ground glow stays under the gates' contrast)
  E.sky = canvasTex(2, 256, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); K.sky.forEach((c, i) => g.addColorStop(i / (K.sky.length - 1), c)); x.fillStyle = g; x.fillRect(0, 0, w, h); });
  E.ridges = K.ridges.map(a => { const m = ridge(...a); G.add(m); return m; });
  // trees: groves per distance band → one instanced draw per species
  E.trees = {}; const all = [];
  const pick = (r, w) => { let s = 0; for (const k in w) s += w[k]; let x = r * s; for (const k in w) { x -= w[k]; if (x <= 0) return k; } return Object.keys(w)[0]; };
  for (const [n, li, d0, d1, s0, s1, w] of K.groves) for (let i = 0; i < n; i++) all.push({ sp: pick(rnd(), w), L: li < 0 ? null : E.ridges[li], d: d0 + rnd() * (d1 - d0), bx: rnd() * (li < 0 ? 3600 : E.ridges[li].userData.P), s: s0 + rnd() * (s1 - s0), ph: rnd() * 6.28, c: rnd(), lean: (rnd() - 0.5) * 0.06 });
  // LOD: floor + near groves use the full species, mid/far groves (ridges 2–3, ≥ 1400 px deep, hazed) a half-segment version
  // (only species above 150 tris are split — for cheaper ones the extra draw call costs more than the triangles saved)
  const triN = g => (g.index ? g.index.count : g.getAttribute("position").count) / 3;
  for (const sp in K.species) { const hiGeo = SPECIES[sp](), split = triN(hiGeo) > 150;
   for (const lod of split ? [0, 1] : [0]) { const list = all.filter(t => t.sp === sp && (!split || (t.L && t.L !== E.ridges[4] ? 1 : 0) === lod)); if (!list.length) continue;
    let geo = hiGeo; if (lod) { LODQ = 1; geo = SPECIES[sp](); LODQ = 0; } const m = inst(geo, GLOW[sp] ? glowVC : flatVC, list.length);
    list.forEach((t, i) => m.setColorAt(i, _c0.setScalar(0.9 + t.c * 0.16))); m.instanceColor.needsUpdate = true; E.trees[lod ? sp + "~lo" : sp] = { m, list, lod }; } }
  // ground cover
  E.ground = K.ground.map(([gk, n, d0, d1, s0, s1, lowDrop, dim]) => { const items = []; for (let i = 0; i < n; i++) items.push({ bx: rnd() * 2400, d: d0 + Math.pow(rnd(), 1.3) * (d1 - d0), s: 1.7 * (s0 + rnd() * (s1 - s0)), r: rnd() * 6.28, ph: rnd() * 6 });
    return { m: inst(GROUND[gk](), dim ? glowDim : flatVC, n), items, lowDrop: !!lowDrop, sway: gk !== "shells" && gk !== "drift" && gk !== "haybale" && gk !== "glowmoss" }; });
  // fauna
  E.fauna = K.fauna.map(([ak, kind, n, nLo, P]) => { const items = []; for (let i = 0; i < n; i++) items.push({ bx: rnd() * 1800, d: P.d ? P.d[0] + rnd() * (P.d[1] - P.d[0]) : 0, y: P.y ? P.y[0] + rnd() * (P.y[1] - P.y[0]) : 0, ph: rnd() * 6.28, v: (P.v || 8) * (0.7 + rnd() * 0.6), dir: rnd() > 0.5 ? 1 : -1 });
    return { m: inst(ANIMALS[ak](), P.glow ? glowVC : flatVC, n), kind, n, nLo, P, items }; });
  // set-piece
  const nBefore = G.children.length; E.set = SETS[K.set](G, E, rnd); E.setG = E.guardObj || G.children[nBefore] || null; // a set-piece's first object is its main group (aurora/owl post are separate)
  // clouds (flat puffs) + motes (points)
  E.cloudItems = []; for (let i = 0; i < 7; i++) E.cloudItems.push({ d: 3600 + rnd() * 2400, bx: rnd() * 30000, y: 900 + rnd() * 1300, s: 1.4 + rnd() * 1.6, v: 4 + rnd() * 6 });
  E.clouds = inst(ico(0), new T.MeshLambertMaterial({ color: new T.Color(K.clouds[0]), emissive: new T.Color(K.clouds[1]), flatShading: true }), E.cloudItems.length * 5);
  const [mk, mn, mnLo, mc] = K.motes; E.motes = []; for (let i = 0; i < mn; i++) E.motes.push({ bx: rnd() * 1600, y: rnd() * 600, d: 140 + rnd() * 500, ph: rnd() * 6.28 });
  const mg = new T.BufferGeometry(); mg.setAttribute("position", new T.BufferAttribute(new Float32Array(mn * 3), 3)); mg.setAttribute("color", new T.BufferAttribute(new Float32Array(mn * 4).fill(1), 4)); // B-12 P2: per-mote alpha
  E.moteP = new T.Points(mg, new T.PointsMaterial({ color: mc, size: mk === "snow" ? 2.6 : 2.2, sizeAttenuation: false, transparent: true, opacity: mk === "fireflies" || mk === "sparkle" ? 0.85 : 0.7, depthWrite: false, vertexColors: true }));
  E.moteP.frustumCulled = false; E.moteKind = mk; E.moteLo = mnLo; G.add(E.moteP);
  G.traverse(n => { const m = n.material; if (m && m.side === T.DoubleSide) m.forceSinglePass = true; });
  KIT.built[key] = E; return E;
}
/* set-pieces (each returns an update(t, camx, lo) closure) */
const SETS = {
  lagoon(G, E) { const g = new T.Group(); G.add(g); g.userData = { P: 6400, d: 1360, bx: 700 };
    const water = new T.Mesh(new T.CylinderGeometry(1, 1, 1, 28), new T.MeshLambertMaterial({ color: "#5FD6E0", emissive: new T.Color("#1F6A80") })); water.scale.set(520, 2, 120); g.add(water);
    const surf = new T.Mesh(new T.CylinderGeometry(1, 1, 1, 28, 1, true), new T.MeshBasicMaterial({ color: "#FFFFFF", transparent: true, opacity: 0.7, side: T.DoubleSide })); surf.scale.set(530, 3, 126); surf.position.y = 1; g.add(surf);
    const rp = []; const q = lcg(9); for (let i = 0; i < 6; i++) rp.push(vcp(ico(0), trs((q() - 0.5) * 40, 30 + i * 34, (q() - 0.5) * 20, q(), q(), q(), 40 - i * 4, 40, 30), i % 2 ? "#9A8C7A" : "#B0A08A"));
    rp.push(vcp(ico(0), trs(0, 236, 0, 0, 0, 0, 34, 16, 26), "#4FAE6A")); const stack = new T.Mesh(merge(rp), new T.MeshLambertMaterial({ vertexColors: true, flatShading: true })); stack.position.set(140, 0, 0); stack.scale.setScalar(0.7); g.add(stack); E.guardObj = stack; // only the sea-stack can rise into a gap; the water stays at the horizon
    E.lagoon = g;
    return (t, camx, lo) => { const x = wrapX(g.userData.bx, camx, g.userData.P); g.position.set(x, ridgeHeightAt(E.ridges[3], x) - 40, -g.userData.d); surf.material.opacity = 0.55 + 0.2 * Math.sin(t * 1.3); surf.scale.x = 530 + Math.sin(t * 0.9) * 6; }; },
  frozenfall(G, E) { const g = new T.Group(); G.add(g); g.userData = { P: 7200, d: 2500, bx: 900 }; g.scale.setScalar(0.55);
    const rp = []; const q = lcg(77); for (let i = 0; i < 9; i++) rp.push(vcp(ico(0), trs((i % 3 - 1) * 120 + (q() - 0.5) * 50, 120 + Math.floor(i / 3) * 170 + q() * 40, (q() - 0.5) * 40, q(), q(), q(), 110 + q() * 50, 130 + q() * 40, 70), i % 2 ? "#9FB0C0" : "#B8C6D2"));
    rp.push(vcp(ico(0), trs(-150, 560, 0, 0.3, 0.2, 0, 140, 60, 80), "#F4F9FF"), vcp(ico(0), trs(140, 560, 0, 0.1, 0.5, 0, 130, 55, 80), "#F4F9FF"));
    for (let i = 0; i < 7; i++) rp.push(vcp(cone(5), trs(-30 + i * 10, 400 - (i % 3) * 60, 128, Math.PI, 0, 0, 7, 120 + (i % 3) * 60, 4), i % 2 ? "#CFF1FF" : "#E6F8FF"));
    rp.push(vcp(new T.CylinderGeometry(150, 170, 6, 18), trs(0, -8, 150), "#D6F0FF"));
    g.add(new T.Mesh(merge(rp), new T.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
    // aurora: faint additive ribbon high in the far sky (static colour band, slow wave; RM: still)
    const n = 40, pos = [], col = []; for (let i = 0; i <= n; i++) { const x = (i / n - 0.5) * 30000; pos.push(x, 0, 0, x, 1, 0); col.push(0.4, 1, 0.75, 0.2, 0.5, 1); }
    const ag = new T.BufferGeometry(); ag.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); ag.setAttribute("color", new T.Float32BufferAttribute(col, 3)); const idx = []; for (let i = 0; i < n; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2); ag.setIndex(idx);
    const aur = new T.Mesh(ag, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.16, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false })); aur.frustumCulled = false; aur.visible = !!E.K.dark; G.add(aur); // daytime Vinter: ribbon reserved for a night variant (invisible = no draw)
    const base = ag.getAttribute("position").array.slice();
    return (t, camx, lo, cam, v) => { const x = wrapX(g.userData.bx, camx, g.userData.P); g.position.set(x, ridgeHeightAt(E.ridges[3], x) - 40, -g.userData.d);
      const P = ag.getAttribute("position"); for (let i = 0; i <= n; i++) { const w = Math.sin(i * 0.5 + t * 0.2) * 300; P.setXYZ(i * 2, base[i * 6] + camx, cam.position.y + 2300 + w, -7200); P.setXYZ(i * 2 + 1, base[i * 6] + camx, cam.position.y + 3300 + w * 1.3, -7200); } P.needsUpdate = true; }; },
  windmill(G, E) { const g = new T.Group(); G.add(g); g.userData = { P: 5200, d: 1480, bx: 600 }; const q = [];
    q.push(vcp(new T.CylinderGeometry(8, 14, 70, 8), trs(0, 35, 0), "#3A2A40"), vcp(cone(8), trs(0, 78, 0, 0, 0, 0, 11, 16, 11), "#2A1E30"));
    q.push(vcp(new T.BoxGeometry(46, 28, 30), trs(70, 14, 0), "#3E2C44"), vcp(new T.BoxGeometry(50, 4, 34), trs(70, 30, 0, 0, 0, 0.0), "#2A1E30"), vcp(cone(4), trs(70, 40, 0, 0, Math.PI / 4, 0, 34, 20, 26), "#2A1E30"));
    const lit = [vcp(new T.BoxGeometry(8, 8, 1), trs(62, 14, 15.6), "#FFD27A"), vcp(new T.BoxGeometry(8, 8, 1), trs(80, 14, 15.6), "#FFC060"), vcp(new T.BoxGeometry(5, 7, 1), trs(0, 50, 9), "#FFD27A")];
    g.add(new T.Mesh(merge(q), new T.MeshLambertMaterial({ vertexColors: true, flatShading: true }))); g.add(new T.Mesh(merge(lit), new T.MeshBasicMaterial({ vertexColors: true })));
    const bl = []; for (let i = 0; i < 4; i++) bl.push(vcp(new T.BoxGeometry(5, 46, 1), trs(Math.sin(i * Math.PI / 2) * 24, Math.cos(i * Math.PI / 2) * 24, 0, 0, 0, -i * Math.PI / 2), "#4A3650"));
    const blades = new T.Mesh(merge(bl), new T.MeshLambertMaterial({ vertexColors: true })); blades.position.set(0, 66, 14); g.add(blades);
    // owl post (the perch for the "owl" fauna kind with {post})
    const post = new T.Mesh(new T.CylinderGeometry(1.4, 1.6, 26, 5), new T.MeshLambertMaterial({ color: "#3A2420" })); G.add(post); E.post = post; E.postBx = 360; E.postD = 260;
    return (t, camx, lo) => { const x = wrapX(g.userData.bx, camx, g.userData.P); g.position.set(x, ridgeHeightAt(E.ridges[3], x) - 6, -g.userData.d); blades.rotation.z = -t * 0.6;
      const px = wrapX(E.postBx, camx, 2000); post.position.set(px, -708 + 13, -E.postD); E.postTop = [px, -708 + 26, -E.postD]; }; },
  floating(G, E) { const isl = [], g = new T.Group(); G.add(g); g.userData = { P: 6000, d: 1900, bx: 800 };
    const mk = (sx, sy) => merge([vcp(cone(7), trs(0, -sy * 0.5, 0, Math.PI, 0, 0, sx, sy, sx * 0.8), "#3A2C72"), vcp(new T.CylinderGeometry(sx, sx, 6, 7), trs(0, 3, 0, 0, 0, 0, 1, 1, 0.8), "#5A4AB0"), vcp(ico(0), trs(sx * 0.3, 14, 0, 0, 0, 0, sx * 0.35, 12, sx * 0.3), "#7FE8FF")]);
    for (const [x, y, s] of [[-260, 420, 70], [40, 560, 96], [300, 380, 60]]) { const m = new T.Mesh(mk(s, s * 1.3), new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: new T.Color("#1A1240") })); m.position.set(x, y, 0); g.add(m); isl.push({ m, y }); }
    const fallTex = canvasTex(32, 128, (x, w, h) => { x.fillStyle = "#9DF2FF"; x.fillRect(0, 0, w, h); const r = lcg(3); for (let i = 0; i < 40; i++) { x.fillStyle = r() > 0.5 ? "rgba(255,255,255,0.9)" : "rgba(160,120,255,0.7)"; x.fillRect(Math.floor(r() * w), Math.floor(r() * h), 2, 10 + Math.floor(r() * 30)); } });
    fallTex.wrapS = fallTex.wrapT = 1000; const fall = new T.Mesh(new T.PlaneGeometry(30, 520), new T.MeshBasicMaterial({ map: fallTex, transparent: true, opacity: 0.6, depthWrite: false })); fall.position.set(40, 300, 10); g.add(fall);
    return (t, camx, lo) => { const x = wrapX(g.userData.bx, camx, g.userData.P); g.position.set(x, ridgeHeightAt(E.ridges[3], x) - 40, -g.userData.d); isl.forEach((s, k) => s.m.position.y = s.y + Math.sin(t * 0.5 + k * 2) * 8); fallTex.offset.y = -(t * 0.5) % 1; }; }
};
/* gap guard: "nothing overlaps the gap" (WORLD_FLORA_FAUNA rule 1), enforced per frame in screen space.
   Gap rects come from the fg camera; kit objects are projected with the bg camera. Anything inside a gap (+ margin)
   fades out (fauna shrink, motes hide, set-pieces fade) and comes back once the gate has passed. Snow is weather and exempt. */
const GG = { rects: [], near: [], v: new T.Vector3(), stats: { checks: 0, hits: 0, hard: 0 } };
function gapRects(R, S) { const out = GG.rects; out.length = 0; const c = R.fgCam, v = GG.v, mx = 0.035, my = 0.02, lead = 0.05; // lead: extra margin on the left (gates scroll left), so the fade finishes before contact
  for (const ob of S.pipes) { if (ob.gapY == null || !ob.gap) continue; const w = ob.w || 78, top = ob.gapY - ob.gap / 2, bot = ob.gapY + ob.gap / 2;
    v.set(ob.x, -top, 0).project(c); const x0 = v.x, y0 = v.y; v.set(ob.x + w, -bot, 0).project(c);
    out.push([Math.min(x0, v.x) - mx - lead, Math.max(x0, v.x) + mx, Math.min(y0, v.y) - my, Math.max(y0, v.y) + my]); }
  GG.near = out.map(r => [r[0] - 0.32, r[1] + 0.04, r[2] - 0.09, r[3] + 0.09]); // B-12 P2: approach zone – fade starts here (gates scroll left; the bg camera follows the bird vertically)
  GG.frameRects = out.map(r => r.slice()); GG.frameTime = S.time; return out; }
function ndcHit(x0, x1, y0, y1, near) { for (const r of (near ? GG.near || [] : GG.rects)) if (x1 > r[0] && x0 < r[1] && y1 > r[2] && y0 < r[3]) return true; return false; }
function inGap(cam, x, y, z, rad, near) { const v = GG.v.set(x, y, z).project(cam); if (v.z > 1) return false; const k = rad * 2 / Math.max(1, -z + 760) * 1.6; if (near) return ndcHit(v.x - k, v.x + k, v.y - k, v.y + k, true); GG.stats.checks++; const h = ndcHit(v.x - k, v.x + k, v.y - k, v.y + k); if (h) GG.stats.hits++; return h; }
function localBox(g) { if (g.userData.lb) return g.userData.lb; const a = g.getAttribute("position").array, b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
  for (let i = 0; i < a.length; i += 3) for (let j = 0; j < 3; j++) { b[j] = Math.min(b[j], a[i + j]); b[j + 3] = Math.max(b[j + 3], a[i + j]); } return (g.userData.lb = b); }
function boxInGap(cam, obj, pad, near) { pad = pad || 0; let x0 = 9, x1 = -9, y0 = 9, y1 = -9, any = false; // screen bbox of all meshes (local AABB corners → world → NDC); vendored THREE has no Box3
  obj.traverse(n => { if (!n.isMesh || (n !== obj && !n.visible)) return; /* root visibility is the guard's output, not an input */ const b = localBox(n.geometry); any = true;
    for (let i = 0; i < 8; i++) { GG.v.set(b[i & 1 ? 3 : 0], b[i & 2 ? 4 : 1], b[i & 4 ? 5 : 2]).applyMatrix4(n.matrixWorld).project(cam); x0 = Math.min(x0, GG.v.x); x1 = Math.max(x1, GG.v.x); y0 = Math.min(y0, GG.v.y); y1 = Math.max(y1, GG.v.y); } });
  if (!any) return false; if (near) return ndcHit(x0 - pad, x1 + pad, y0 - pad * 0.5, y1 + pad * 0.5, true); GG.stats.checks++; const h = ndcHit(x0 - pad, x1 + pad, y0 - pad * 0.5, y1 + pad * 0.5); if (h) GG.stats.hits++; return h; }
function updateGVGapGuard(R, S) {
  if (!GV.built || !GV.guardMeshes || !GV.guardMeshes.length || !R.bgCam || !R.fgCam) return;
  gapRects(R, S); R.bgCam.updateMatrixWorld(true); GV.group.updateMatrixWorld(true);
  const t = S.time || 0, dt = Math.min(0.1, Math.max(0, t - (GV.guardTime == null ? t : GV.guardTime))); GV.guardTime = t;
  const fade = (cur, target) => cur + (target - cur) * Math.min(target < cur ? 0.45 : 0.12, dt * (target < cur ? 14 : 5));
  const local = new T.Matrix4(), world = new T.Matrix4(), pos = new T.Vector3(), rot = new T.Quaternion(), scale = new T.Vector3();
  let checked = 0, hits = 0, hardHides = 0;
  for (const mesh of GV.guardMeshes) {
    const gains = mesh.userData.gvGapFade || (mesh.userData.gvGapFade = []);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, local); world.copy(mesh.matrixWorld).multiply(local); world.decompose(pos, rot, scale);
      const rad = Math.max(2, Math.max(scale.x, scale.y, scale.z) * 0.72);
      const hard = inGap(R.bgCam, pos.x, pos.y, pos.z, rad, false);
      const soon = inGap(R.bgCam, pos.x, pos.y, pos.z, rad, true);
      let gain = gains[i] == null ? 1 : gains[i];
      if (hard) { if (gain > 0.02) hardHides++; gain = 0; hits++; }
      else gain = fade(gain, soon ? 0 : 1);
      gains[i] = gain; checked++;
      if (gain < 0.999) { local.decompose(pos, rot, scale); scale.multiplyScalar(Math.max(0.0001, gain)); local.compose(pos, rot, scale); mesh.setMatrixAt(i, local); }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  // B-13: waterfall cliff, stream, pool and reeds are fixed meshes. Fade each independently in the same screen-space gap guard.
  let staticChecked = 0, staticHits = 0;
  if (GV.guardStatic && GV.guardStatic.length) {
    GV.group.updateMatrixWorld(true);
    GV.guardStatic.forEach((obj, i) => {
      const hard = boxInGap(R.bgCam, obj, 0.025, false), soon = boxInGap(R.bgCam, obj, 0.025, true);
      let gain = GV.guardStaticGains[i] == null ? 1 : GV.guardStaticGains[i];
      if (hard) { gain = 0; staticHits++; } else gain = fade(gain, soon ? 0 : 1);
      GV.guardStaticGains[i] = gain; staticChecked++;
      obj.visible = gain > 0.005;
      obj.traverse(n => { if (!n.isMesh || !n.material) return;
        const mats = Array.isArray(n.material) ? n.material : [n.material];
        for (const mat of mats) {
          if (mat.userData.gvGapBaseOpacity == null) { mat.userData.gvGapBaseOpacity = mat.opacity == null ? 1 : mat.opacity; mat.userData.gvGapBaseTransparent = !!mat.transparent; }
          const baseOpacity = mat.userData.gvGapBaseOpacity, transparent = mat.userData.gvGapBaseTransparent || gain < 0.999;
          if (mat.transparent !== transparent) { mat.transparent = transparent; mat.needsUpdate = true; }
          mat.opacity = baseOpacity * gain;
        }
      });
    });
  }
  // Foreground pollen motes are Points rather than InstancedMesh; apply the same gap fade per point.
  let moteChecked = 0, moteHits = 0;
  if (GV.moteP && GV.motes) {
    const mp = GV.moteP.geometry.getAttribute("position"), ma = GV.moteP.geometry.getAttribute("color");
    for (let i = 0; i < mp.count; i++) {
      const m = GV.motes[i], x = mp.getX(i), y = mp.getY(i), z = mp.getZ(i);
      const hard = inGap(R.bgCam, x, y, z, 3, false), soon = inGap(R.bgCam, x, y, z, 3, true);
      let gain = m.gapFade == null ? 1 : m.gapFade;
      if (hard) { gain = 0; moteHits++; } else gain = fade(gain, soon ? 0 : 1);
      m.gapFade = gain; ma.setW(i, ma.getW(i) * gain); moteChecked++;
    }
    ma.needsUpdate = true;
  }
  GV.guardStats = { checked, hits, hardHides, staticChecked, staticHits, moteChecked, moteHits, gaps: GG.rects.length, approachRects: GG.near.length };
}
function auditGVGap(R, S) {
  if (!GV.built || !GV.guardMeshes || !S) return null;
  gapRects(R, S); R.bgCam.updateMatrixWorld(true); GV.group.updateMatrixWorld(true);
  const local = new T.Matrix4(), world = new T.Matrix4(), pos = new T.Vector3(), rot = new T.Quaternion(), scale = new T.Vector3();
  let checked = 0, viol = 0; const what = [];
  for (const mesh of GV.guardMeshes) for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, local); world.copy(mesh.matrixWorld).multiply(local); world.decompose(pos, rot, scale);
    if (Math.max(scale.x, scale.y, scale.z) < 0.05) continue;
    checked++; const rad = Math.max(2, Math.max(scale.x, scale.y, scale.z) * 0.72);
    if (inGap(R.bgCam, pos.x, pos.y, pos.z, rad, false)) { viol++; if (what.length < 12) what.push((mesh.name || mesh.type) + ":" + i); }
  }
  let staticChecked = 0;
  for (const obj of GV.guardStatic || []) if (obj.visible) { staticChecked++; if (boxInGap(R.bgCam, obj, 0.025, false)) { viol++; if (what.length < 12) what.push("static:" + (obj.name || obj.type)); } }
  let moteChecked = 0;
  if (GV.moteP && GV.motes) { const mp = GV.moteP.geometry.getAttribute("position"), ma = GV.moteP.geometry.getAttribute("color");
    for (let i = 0; i < mp.count; i++) if (ma.getW(i) > 0.05) { moteChecked++; if (inGap(R.bgCam, mp.getX(i), mp.getY(i), mp.getZ(i), 3, false)) { viol++; if (what.length < 12) what.push("pollen:" + i); } } }
  return { world: "Green Valley", checked, staticChecked, moteChecked, viol, what, guard: GV.guardStats, gaps: GG.rects.length };
}
function gapAudit() { const R = window.Render3D && Render3D._R; if (!R) return null; const S = R.lastView, cam = R.bgCam; if (!S) return null; if (GV.applied && GV.built && (S.worldKey === "meadow" || S.world && S.world.key === "meadow")) return auditGVGap(R, S); const E = KIT.cur; if (!E) return null; // B-11: audit reads the last render view, not the live S cam.updateMatrixWorld();
  const keep = GG.stats.checks, keepH = GG.stats.hits, simT = S.time, frT = GG.frameTime;
  // audit the frame that was actually drawn: its own gap rects (S may have advanced a step after the last draw), minus the guard margins
  GG.rects = (GG.frameRects || []).map(r => [r[0] + 0.085, r[1] - 0.035, r[2] + 0.02, r[3] - 0.02]);
  let checked = 0, viol = 0; const what = []; const m4 = new T.Matrix4(), pp = new T.Vector3(), qq = new T.Quaternion(), ss = new T.Vector3();
  for (const F of E.fauna) { if (!F.m.visible) continue; for (let k = 0; k < F.m.count; k++) { F.m.getMatrixAt(k, m4); m4.decompose(pp, qq, ss); if (ss.x < 0.05) continue; checked++; if (inGap(cam, pp.x, pp.y, pp.z, 6 * ss.x)) { viol++; what.push(F.kind + ":" + k + ":" + ss.x.toFixed(2)); } } }
  if (E.setG && E.setG.visible && (E.setFade == null || E.setFade > 0.05)) { checked++; if (boxInGap(cam, E.setG)) { viol++; what.push("set:" + (E.setFade || 1).toFixed(2)); } }
  if (E.moteKind !== "snow") { const mp = E.moteP.geometry.getAttribute("position"), ma = E.moteP.geometry.getAttribute("color"); for (let k = 0; k < mp.count; k++) { const y = mp.getY(k); if (y < -5e4 || (ma && ma.getW(k) < 0.05)) continue; checked++; if (inGap(cam, mp.getX(k), y, mp.getZ(k), 1)) { viol++; what.push("mote"); } } }
  GG.stats.checks = keep; GG.stats.hits = keepH; return { world: E.key, checked, viol, what, simAhead: +(simT - frT).toFixed(4), gaps: GG.rects.length, guardChecks: GG.stats.checks, guardHits: GG.stats.hits }; }
function updateKit(R, S, o, E) {
  const K = E.K, cam = R.bgCam, camx = cam.position.x, t = o.rm ? 0 : (S.time || 0), v = R.view, DC = 760, gy = S.H - S.groundH, lo = R.quality === "low";
  const visW = d => v.viewW * (DC + d) / DC; gapRects(R, S); const dt = Math.min(0.1, Math.max(0, (S.time || 0) - (E.tPrev == null ? (S.time || 0) : E.tPrev))); E.tPrev = S.time || 0; const fade = (cur, tgt) => cur + (tgt - cur) * Math.min(tgt < cur ? 0.45 : 0.12, dt * (tgt < cur ? 14 : 5)); // B-12 P2: out over ~0.3 s inside the approach zone, back in gently (also with reduced motion: a fade is not motion); per-frame step capped so a slow frame cannot turn a fade into a pop
  const guard = (g, hard, soon) => { g = g == null ? 1 : g; if (hard && g > 0.02) { GG.stats.hard++; return 0; } return fade(g, soon ? 0 : 1); }; // safety rule kept: anything still visible inside the gap margin is hidden at once
  for (const r of E.ridges) r.position.x = wrapX(0, camx, r.userData.P);
  for (const sp in E.trees) { const { m, list } = E.trees[sp]; let n = 0;
    for (const tr of list) { if (lo && tr.c > 0.6) continue; const L = tr.L, x = wrapX(tr.bx, camx, L ? L.userData.P * 0.5 : 1800), base = L ? ridgeHeightAt(L, x) - 6 : -gy;
      _e.set(0, tr.ph, Math.sin(t * 1.1 + tr.ph) * 0.03 + tr.lean); _q.setFromEuler(_e); _p.set(x, base, -tr.d); _s.setScalar(tr.s); _m.compose(_p, _q, _s); m.setMatrixAt(n++, _m); }
    m.count = n; m.instanceMatrix.needsUpdate = true; }
  for (const Gc of E.ground) { if (lo && Gc.lowDrop) { Gc.m.visible = false; continue; } Gc.m.visible = true; let n = 0;
    Gc.items.forEach((g, k) => { if (lo && k % 2) return; const x = wrapX(g.bx, camx, 2400); _e.set(0, g.r, Gc.sway ? Math.sin(t * 1.5 + g.ph) * 0.1 : 0); _q.setFromEuler(_e); _p.set(x, -gy, -g.d); _s.setScalar(g.s); _m.compose(_p, _q, _s); Gc.m.setMatrixAt(n++, _m); });
    Gc.m.count = n; Gc.m.instanceMatrix.needsUpdate = true; }
  cam.updateMatrixWorld(); // fresh view matrix for the gap guard projections
  for (const F of E.fauna) { const n = lo ? F.nLo : F.n; F.m.visible = n > 0; if (!n) continue;
    for (let k = 0; k < n; k++) { const a = F.items[k]; let x, y, z = -a.d, rx = 0, ry = 0, rz = 0, sc = 1;
      if (F.kind === "flyer") { x = wrapX(a.bx + t * a.v * a.dir + Math.sin(t * 0.4 + a.ph) * 40, camx, F.P.small ? 1500 : visW(a.d) + 600); y = -gy + a.y + Math.sin(t * 1.2 + a.ph) * (F.P.small ? 5 : 12); ry = a.dir > 0 ? 0 : Math.PI; rx = Math.sin(t * (F.P.small ? 30 : 9) + a.ph) * 0.5; sc = F.P.small ? 0.9 : 1.4; }
      else if (F.kind === "walker") { x = wrapX(a.bx + t * a.v * a.dir, camx, 2000); y = -gy; ry = a.dir > 0 ? 0 : Math.PI; rz = Math.sin(t * 4 + a.ph) * 0.03; }
      else if (F.kind === "crab") { x = wrapX(a.bx + Math.sin(t * 0.7 + a.ph) * 30, camx, 1600); y = -gy; ry = Math.PI / 2; rz = Math.sin(t * 9 + a.ph) * 0.05; }
      else if (F.kind === "grazer") { x = wrapX(a.bx, camx, 2600); y = ridgeHeightAt(E.ridges[4], x) - 10; rz = (t * 0.25 + a.ph) % 1 < 0.55 ? -0.12 : 0.02; }
      else if (F.kind === "hopper") { x = wrapX(a.bx + t * (F.P.small ? 4 : 10) * a.dir, camx, 1600); const hop = Math.abs(Math.sin(t * (F.P.small ? 5 : 3.2) + a.ph)); y = -gy + hop * (F.P.small ? 3 : 7); ry = a.dir > 0 ? 0 : Math.PI; rz = (hop - 0.5) * 0.3; sc = F.P.small ? 1.2 : 1.1; }
      else if (F.kind === "perch") { if (F.P.post && E.postTop) { [x, y, z] = E.postTop; } else { const tr = E.trees[F.P.tree] && E.trees[F.P.tree].list.find(q => q.L === E.ridges[4]); if (!tr) { x = 1e6; y = 0; } else { x = wrapX(tr.bx, camx, tr.L.userData.P * 0.5); y = ridgeHeightAt(tr.L, x) - 6 + 21 * tr.s; z = -tr.d + 2; sc = tr.s; } }
        ry = Math.sin(t * 0.3 + a.ph) > 0.6 ? 0.8 : 0; }
      else if (F.kind === "bat") { x = wrapX(a.bx + Math.sin(t * 0.8 + a.ph) * 120 + t * 20, camx, visW(a.d) + 600); y = -gy + a.y + Math.sin(t * 2.3 + a.ph) * 30; rx = Math.sin(t * 16 + a.ph) * 0.7; sc = 1.6; }
      else if (F.kind === "flock") { x = wrapX(a.bx - t * a.v + k * 40, camx, visW(a.d) + 800); y = cam.position.y + a.y * (DC + a.d) / DC * 0.5 + (k % 2) * 30; rx = Math.sin(t * 4 + k) * 0.4; sc = 2.2; }
      else if (F.kind === "floater") { x = wrapX(a.bx + t * 3, camx, visW(a.d) + 600); y = -gy + a.y + Math.sin(t * 0.6 + a.ph) * 20; sc = 2 + Math.sin(t * 1.4 + a.ph) * 0.1; }
      else if (F.kind === "jumper") { const L = E.lagoon; const cyc = ((t * 0.35 + a.ph) % 1); x = L ? L.position.x - 200 + k * 140 + cyc * 40 : 1e6; const j = cyc < 0.3 ? Math.sin(cyc / 0.3 * Math.PI) : 0; y = (L ? L.position.y : 0) + j * 30 - 4; z = (L ? L.position.z : 0) + 30; rz = (0.15 - cyc) * 6 * (j > 0 ? 1 : 0); sc = 0.001 + 2 * sstep(j / 0.9); } // B-12 P2: grows out of the water over the rise instead of popping to full size
      { const hard = inGap(cam, x, y, z, 14 * sc); a.g = guard(a.g, hard, hard || inGap(cam, x, y, z, 14 * sc, true)); } sc *= a.g < 0.02 ? 0.0001 : a.g;
      _e.set(rx, ry, rz); _q.setFromEuler(_e); _p.set(x, y, z); _s.setScalar(sc); _m.compose(_p, _q, _s); F.m.setMatrixAt(k, _m); }
    F.m.count = n; F.m.instanceMatrix.needsUpdate = true; }
  _q.identity();
  E.set(t, camx, lo, cam, v);
  if (E.setG) { E.G.updateMatrixWorld(true); // whole kit group: the set-piece's parent was positioned this frame
    { const hard = boxInGap(cam, E.setG, 0.08); E.setFade = guard(E.setFade, hard, hard || boxInGap(cam, E.setG, 0.08, true)); } const f = E.setFade; // B-12 P2: fades out in the approach zone; instant hide only as fallback
    E.setG.visible = f > 0.02; E.setG.traverse(n => { const m = n.material; if (!m) return; if (m.userData.op0 == null) { m.userData.op0 = m.opacity; m.userData.tr0 = m.transparent; } const tr = m.userData.tr0 || f < 0.98; if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; } m.opacity = m.userData.op0 * f; }); }
  const puffs = [[0, 0, 70, 30], [-55, -8, 44, 22], [58, -6, 48, 24], [10, 18, 42, 22], [-20, 10, 36, 18]];
  E.cloudItems.forEach((c, k) => { const x = wrapX(c.bx - t * c.v * 3, camx, visW(c.d) + 1600); for (let j = 0; j < 5; j++) { const p = puffs[j]; _p.set(x + p[0] * c.s, -gy + c.y + p[1] * c.s, -c.d); _s.set(p[2] * c.s, p[3] * c.s, p[2] * 0.5 * c.s); _m.compose(_p, _q, _s); E.clouds.setMatrixAt(k * 5 + j, _m); } });
  E.clouds.instanceMatrix.needsUpdate = true;
  const mp = E.moteP.geometry.getAttribute("position"), ma = E.moteP.geometry.getAttribute("color"), mk = E.moteKind, mn = lo ? E.moteLo : E.motes.length;
  E.motes.forEach((m, k) => { if (k >= mn) { mp.setXYZ(k, 0, -1e5, 0); ma.setW(k, 0); return; } let x, y, u, ba = 1; const span = moteSpan(visW, m.d), fr = q => q - Math.floor(q);
    if (mk === "snow") { x = wrapX(m.bx + Math.sin(t * 0.7 + m.ph) * 14 - t * 4, camx, span); u = (m.y + t * 22) / 700; y = -gy + 700 - 700 * fr(u); ba = bandA(u); }
    else if (mk === "fireflies") { x = wrapX(m.bx + Math.sin(t * 0.5 + m.ph) * 30, camx, span); y = -gy + 10 + (m.y % 160) + Math.sin(t * 0.9 + m.ph) * 10; }
    else if (mk === "sparkle") { x = wrapX(m.bx + Math.sin(t * 0.3 + m.ph) * 20, camx, span); u = (m.y + t * 6) / 220; y = -gy + 10 + 220 * fr(u); ba = bandA(u); }
    else { x = wrapX(m.bx - t * 14 + Math.sin(t + m.ph) * 10, camx, span); u = (m.y - t * 10 + 6000) / 200; y = -gy + 14 + 200 * fr(u); ba = bandA(u); }
    if (mk !== "snow") { const hard = inGap(cam, x, y, -m.d, 3); m.g = guard(m.g, hard, hard || inGap(cam, x, y, -m.d, 3, true)); } else m.g = 1;
    mp.setXYZ(k, x, y, -m.d); ma.setW(k, ba * m.g); });
  mp.needsUpdate = true; ma.needsUpdate = true;
  if (mk === "fireflies" || mk === "sparkle") E.moteP.material.opacity = o.rm ? 0.75 : 0.55 + 0.3 * Math.abs(Math.sin(t * 1.7));
}

/* ============================================================
   4. PENDULUM in 3D (render-only; positions from OBSTACLES.pendulum.bob(ob), the function collide() uses)
   ============================================================ */
const PEN = { pool: [], used: new WeakMap() };
const OBLIQUE_K = Math.sqrt(1 + 0.14 * 0.14 + 0.12 * 0.12); // sphere silhouette stretch under the oblique projection
function newPend(R) {
  const g = new T.Group(); R.fg.add(g);
  const plate = withHull(new T.BoxGeometry(1, 1, 1), lam("#3D4C5C"), 0.0, g); plate.h.visible = false;
  const plateHull = new T.Mesh(new T.BoxGeometry(1, 1, 1), basic("#1A1433", { side: T.BackSide })); g.add(plateHull);
  const chain = new T.Mesh(new T.CylinderGeometry(1, 1, 1, 6), lam("#8A99AA")); g.add(chain);
  const chainHull = new T.Mesh(new T.CylinderGeometry(1, 1, 1, 6), basic("#1A1433", { side: T.BackSide })); g.add(chainHull);
  const links = new T.InstancedMesh(new T.SphereGeometry(1, 6, 4), basic("#2B2118"), 5); links.frustumCulled = false; g.add(links);
  const ball = new T.Group(); g.add(ball);
  // iron ball with a danger band (always lethal ⇒ reserved danger red + white core line), ink hull
  const bp = [part(new T.SphereGeometry(1, 18, 12), null, "#E8763A")];
  bp.push(part(new T.CylinderGeometry(1.012, 1.012, 0.26, 18), null, "#FF3B5C")); bp.push(part(new T.CylinderGeometry(1.02, 1.02, 0.07, 18), null, "#FFFFFF"));
  for (const zz of [1, -1]) bp.push(part(new T.ConeGeometry(0.16, 0.34, 5), trs(0, 0, zz * 0.98, zz * Math.PI / 2, 0, 0), "#2B2118"));
  const ballGeo = merge(bp);
  const bm = new T.Mesh(ballGeo, vc("lam")); ball.add(bm);
  const bh = new T.Mesh(ballGeo, hullMat(0.17)); ball.add(bh);
  const e = { g, plate: plate.m, plateHull, chain, chainHull, links, ball, used: false };
  PEN.pool.push(e); return e;
}
function orient(m, ax, ay, bx, by, r) { const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy); m.position.set((ax + bx) / 2, (ay + by) / 2, 0); m.rotation.set(0, 0, Math.atan2(dy, dx) - Math.PI / 2); m.scale.set(r, L, r); }
function updatePend(R, S) {
  const O = window.OBSTACLES && window.OBSTACLES.pendulum; if (!O) return;
  for (const e of PEN.pool) e.used = false;
  const v = R.view; PEN.last = [];
  for (const ob of S.pipes) {
    if (ob.fam !== "pendulum") continue;
    if (ob.x > S.W + v.offX + 140 || ob.x + ob.w < -v.offX - 140) continue;
    let e = PEN.pool.find(q => !q.used) || newPend(R); e.used = true; e.g.visible = true;
    const b = O.bob(ob), cx = ob.x + ob.w / 2, topY = 0;
    e.plate.position.set(cx, -(topY + 6), 0); e.plate.scale.set(32, 12, 22); e.plateHull.position.copy(e.plate.position); e.plateHull.scale.set(35, 15, 24);
    orient(e.chain, cx, -(topY + 12), b.x, -b.y, 1.6); orient(e.chainHull, cx, -(topY + 12), b.x, -b.y, 3.0);
    for (let k = 1; k < 5; k++) { const u = k / 5; _p.set(cx + (b.x - cx) * u, -((topY + 12) + (b.y - topY - 12) * u), 2); _q.identity(); _s.setScalar(2.6); _m.compose(_p, _q, _s); e.links.setMatrixAt(k - 1, _m); }
    e.links.count = 4; e.links.instanceMatrix.needsUpdate = true;
    // the 2D ball is a 16 px disc; the 3D silhouette (core + 0.17 ink hull) is compensated for the oblique stretch
    const rCore = ob.bobR / (1.17 * OBLIQUE_K);
    e.ball.position.set(b.x, -b.y, 0); e.ball.scale.setScalar(rCore); e.ball.rotation.set(Math.PI / 2, 0, -(ob.t || 0) * 0.8);
    PEN.last.push({ ob, e, b, rCore });
  }
  for (const e of PEN.pool) if (!e.used) e.g.visible = false;
}
/* ============================================================
   B-14 · ROTORSAW in 3D (render-only; position/phase read from obstacle state)
   The original collision and timing functions in obstacles.js remain authoritative.
   ============================================================ */
const BLADE = { pool: [], byObstacle: new WeakMap() };
function radialGeometry(innerR, outerR, segments, isRing) {
  const a = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
    const x0 = Math.cos(a0), y0 = Math.sin(a0), x1 = Math.cos(a1), y1 = Math.sin(a1);
    if (isRing) a.push(innerR*x0,innerR*y0,0, outerR*x0,outerR*y0,0, outerR*x1,outerR*y1,0,
      innerR*x0,innerR*y0,0, outerR*x1,outerR*y1,0, innerR*x1,innerR*y1,0);
    else a.push(0,0,0, outerR*x0,outerR*y0,0, outerR*x1,outerR*y1,0);
  }
  const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(a, 3)); g.computeVertexNormals(); return g;
}
function gearGeometry(innerR, outerR, teeth) {
  const a = [], n = teeth * 4;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
    const q0 = i % 4, q1 = (i + 1) % 4, r0 = q0 === 0 || q0 === 3 ? outerR : innerR, r1 = q1 === 0 || q1 === 3 ? outerR : innerR;
    a.push(0,0,0, Math.cos(a0)*r0,Math.sin(a0)*r0,0, Math.cos(a1)*r1,Math.sin(a1)*r1,0);
  }
  const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(a, 3)); g.computeVertexNormals(); return g;
}
function newBlade(R) {
  const g = new T.Group(); g.name = "obstacle:blade"; R.fg.add(g);
  const shaftBack = new T.Mesh(new T.BoxGeometry(1, 1, 1), basic(INK)); g.add(shaftBack);
  const shaft = new T.Mesh(new T.BoxGeometry(1, 1, 1), lam("#75879A")); g.add(shaft);
  const capTop = new T.Mesh(new T.BoxGeometry(1, 1, 1), lam("#46596B")); g.add(capTop);
  const capBottom = new T.Mesh(new T.BoxGeometry(1, 1, 1), lam("#46596B")); g.add(capBottom);
  const saw = new T.Group(); g.add(saw);
  const shadow = new T.Mesh(new T.SphereGeometry(1, 24, 12), basic(INK)); shadow.scale.set(27, 27, 0.8); saw.add(shadow);
  const face = new T.Mesh(new T.SphereGeometry(1, 24, 12), lam("#8798A9")); face.position.z = 0.5; face.scale.set(23, 23, 0.8); saw.add(face);
  const teeth = new T.Mesh(gearGeometry(20, 27, 10), lam("#DDE5EC", { side: T.DoubleSide })); teeth.position.z = 1.4; saw.add(teeth);
  const teethInk = new T.Mesh(gearGeometry(20, 27, 10), basic(INK, { side: T.DoubleSide })); teethInk.position.z = 1.0; teethInk.scale.setScalar(1.04); saw.add(teethInk);
  const hub = new T.Mesh(new T.SphereGeometry(1, 20, 10), lam("#F15B55")); hub.position.z = 2.3; hub.scale.set(7.5, 7.5, 1.0); saw.add(hub);
  const hubCore = new T.Mesh(new T.SphereGeometry(1, 16, 8), basic("#FFF4DC")); hubCore.position.z = 2.7; hubCore.scale.set(3, 3, 0.8); saw.add(hubCore);
  const warning = new T.Mesh(radialGeometry(29, 32, 48, true), new T.MeshBasicMaterial({ color: "#FF5364", transparent: true, opacity: 0.42, depthWrite: false, side: T.DoubleSide }));
  warning.position.z = -1; g.add(warning);
  const e = { g, shaftBack, shaft, capTop, capBottom, saw, warning, used: false };
  BLADE.pool.push(e); return e;
}
function updateBlades(R, S) {
  const O = window.OBSTACLES && window.OBSTACLES.blade; if (!O) return;
  for (const e of BLADE.pool) e.used = false;
  const v = R.view;
  for (const ob of S.pipes) {
    if (ob.fam !== "blade") continue;
    if (ob.x > S.W + v.offX + 140 || ob.x + ob.w < -v.offX - 140) continue;
    let e = BLADE.byObstacle.get(ob);
    if (!e || e.used) { e = BLADE.pool.find(q => !q.used) || newBlade(R); BLADE.byObstacle.set(ob, e); }
    e.used = true; e.g.visible = true;
    const cx = ob.x + ob.w / 2, cy = ob.by == null ? ob.gapY : ob.by;
    const top = ob.gapY - ob.gap / 2, bot = ob.gapY + ob.gap / 2;
    e.shaftBack.position.set(cx, -(top + bot) / 2, 1); e.shaftBack.scale.set(10, ob.gap + 8, 3);
    e.shaft.position.set(cx, -(top + bot) / 2, 2); e.shaft.scale.set(5.5, ob.gap - 8, 3);
    e.capTop.position.set(cx, -top, 3); e.capTop.scale.set(16, 8, 5);
    e.capBottom.position.set(cx, -bot, 3); e.capBottom.scale.set(16, 8, 5);
    // Match the visible 3D blade to the source obstacle radius and the 2D silhouette (bladeR + 4).
    // The hit test remains authoritative in obstacles.js; this is render-only sizing.
    const bladeScale = Math.max(0.1, ((Number.isFinite(ob.bladeR) ? ob.bladeR : 18) + 4) / 27);
    e.saw.position.set(cx, -cy, 13); e.saw.rotation.z = ob.spin || 0; e.saw.scale.setScalar(bladeScale);
    const pulse = 0.32 + 0.2 * (0.5 + 0.5 * Math.sin((S.time || 0) * 6 + (ob.ph || 0)));
    e.warning.position.set(cx, -cy, 10); e.warning.scale.setScalar(bladeScale); e.warning.material.opacity = pulse;
    e.warning.visible = true;
  }
  for (const e of BLADE.pool) if (!e.used) e.g.visible = false;
}
let _blade2d = null;
function muteBlade2D(on) { const O = window.OBSTACLES && window.OBSTACLES.blade; if (!O) return;
  if (!_blade2d) _blade2d = O.draw;
  O.draw = on ? function (c, ob, S) { if (!(window.__R3D && window.__R3D.active) || !STUDIO.installed) return _blade2d.call(this, c, ob, S); } : _blade2d; }

let _pend2d = null;
function mutePendulum2D(on) { const O = window.OBSTACLES && window.OBSTACLES.pendulum; if (!O) return;
  if (!_pend2d) _pend2d = O.draw;
  O.draw = on ? function (c, ob, S) { if (!(window.__R3D && window.__R3D.active) || !STUDIO.installed) return _pend2d.call(this, c, ob, S); } : _pend2d; }

/* ============================================================
   B-14 · LASER BARRIER in 3D (render-only; phase from OBSTACLES.laser.phase)
   Existing warning durations and collision checks remain in obstacles.js.
   ============================================================ */
const LASER = { pool: [], byObstacle: new WeakMap() };
function triangleGeometry(r) {
  const a = [0,r,0, -r,-r,0, r,-r,0];
  const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(a, 3)); g.computeVertexNormals(); return g;
}
function newLaser(R) {
  const g = new T.Group(); g.name = "obstacle:laser"; R.fg.add(g);
  const housings = [], lenses = [];
  for (let i = 0; i < 4; i++) {
    const h = new T.Mesh(new T.BoxGeometry(1,1,1), lam("#596B7A")); g.add(h); housings.push(h);
    const l = new T.Mesh(new T.SphereGeometry(1, 12, 8), new T.MeshBasicMaterial({ color: "#7A8A9A" })); g.add(l); lenses.push(l);
  }
  const glow = new T.Mesh(new T.BoxGeometry(1,1,1), new T.MeshBasicMaterial({ color:"#FF404F", transparent:true, opacity:0.18, depthWrite:false })); glow.name="laser:glow"; g.add(glow);
  const beam = new T.Mesh(new T.BoxGeometry(1,1,1), new T.MeshBasicMaterial({ color:"#FF3B5C", transparent:true, opacity:0.95, depthWrite:false })); beam.name="laser:beam"; g.add(beam);
  const core = new T.Mesh(new T.BoxGeometry(1,1,1), new T.MeshBasicMaterial({ color:"#FFF4DC", transparent:true, opacity:0.78, depthWrite:false })); g.add(core);
  const warning = new T.Mesh(triangleGeometry(9), new T.MeshBasicMaterial({ color:"#FFB830", side:T.DoubleSide })); warning.name="laser:warning"; g.add(warning);
  const warningBar = new T.Mesh(new T.BoxGeometry(1,1,1), basic(INK)); g.add(warningBar);
  const warningDot = new T.Mesh(new T.SphereGeometry(1, 10, 8), basic(INK)); g.add(warningDot);
  const dots = [];
  for (let i = 0; i < 7; i++) { const d = new T.Mesh(new T.SphereGeometry(1, 8, 6), basic("#FF7777")); g.add(d); dots.push(d); }
  const e = { g, housings, lenses, glow, beam, core, warning, warningBar, warningDot, dots, used:false };
  LASER.pool.push(e); return e;
}
function updateLasers(R, S) {
  const O = window.OBSTACLES && window.OBSTACLES.laser; if (!O) return;
  for (const e of LASER.pool) e.used = false;
  const v = R.view;
  for (const ob of S.pipes) {
    if (ob.fam !== "laser") continue;
    if (ob.x > S.W + v.offX + 140 || ob.x + ob.w < -v.offX - 140) continue;
    let e = LASER.byObstacle.get(ob);
    if (!e || e.used) { e = LASER.pool.find(q => !q.used) || newLaser(R); LASER.byObstacle.set(ob, e); }
    e.used = true; e.g.visible = true;
    const x0 = ob.x, x1 = ob.x + ob.w, top = ob.gapY - ob.gap/2, bot = ob.gapY + ob.gap/2;
    const lensPos = [[x0-1,top-15],[x1+1,top-15],[x0-1,bot+15],[x1+1,bot+15]];
    for (let i = 0; i < 4; i++) {
      const [x,y] = lensPos[i], h=e.housings[i], l=e.lenses[i];
      h.position.set(x,-y,14); h.scale.set(14,30,9);
      l.position.set(x,-y,19); l.scale.set(5.2,5.2,2.8);
    }
    const ph = O.phase(ob), cx=(x0+x1)/2, cy=-ob.beamOff;
    e.glow.position.set(cx,cy,15); e.beam.position.set(cx,cy,18); e.core.position.set(cx,cy,20);
    e.glow.scale.set(ob.w,24,2); e.beam.scale.set(ob.w,ph === "on" ? 7 : 4,2); e.core.scale.set(ob.w,1.4,1.2);
    const warnBlink = Math.sin((S.time || 0) * 18) > 0;
    e.glow.visible = ph !== "off"; e.beam.visible = ph !== "off"; e.core.visible = ph === "on";
    e.warning.visible = ph === "warn"; e.warning.position.set(cx, cy + 19, 21); e.warning.scale.setScalar(warnBlink ? 1 : 0.78);
    e.warningBar.visible = ph === "warn"; e.warningBar.position.set(cx,cy+18,22); e.warningBar.scale.set(2,7,1);
    e.warningDot.visible = ph === "warn"; e.warningDot.position.set(cx,cy+9,22); e.warningDot.scale.setScalar(1.4);
    e.glow.material.opacity = ph === "warn" ? (warnBlink ? 0.32 : 0.1) : 0.2;
    e.beam.material.color.set(ph === "warn" ? "#FFB830" : "#FF3B5C");
    e.glow.material.color.set(ph === "warn" ? "#FFB830" : "#FF404F");
    e.lenses.forEach(l => l.material.color.set(ph === "on" ? "#FF3B5C" : ph === "warn" ? "#FFB830" : "#7A8A9A"));
    for (let i=0;i<e.dots.length;i++) {
      const d=e.dots[i]; d.visible = ph === "off"; d.position.set(x0 + 8 + i * ((ob.w - 16) / 6), cy, 18); d.scale.setScalar(1.8);
    }
  }
  for (const e of LASER.pool) if (!e.used) e.g.visible = false;
}
let _laser2d = null;
function muteLaser2D(on) { const O = window.OBSTACLES && window.OBSTACLES.laser; if (!O) return;
  if (!_laser2d) _laser2d = O.draw;
  O.draw = on ? function (c, ob, S) { if (!(window.__R3D && window.__R3D.active) || !STUDIO.installed) return _laser2d.call(this, c, ob, S); } : _laser2d; }

/* ============================================================
   B-14 · FALLING ROCK in 3D (render-only; rockRect/state from OBSTACLES.rock)
   Warning timing, fall trajectory and collisions remain in the original simulation.
   ============================================================ */
const ROCK = { pool: [], byObstacle: new WeakMap() };
function newRock(R) {
  const g = new T.Group(); g.name = "obstacle:rock"; R.fg.add(g);
  const hull = new T.Mesh(new T.IcosahedronGeometry(1,0), basic(INK, { side:T.BackSide })); g.add(hull);
  const stone = new T.Mesh(new T.IcosahedronGeometry(1,0), new T.MeshLambertMaterial({ color:"#A99A86", flatShading:true, transparent:true })); g.add(stone);
  const facets = [];
  for (let i=0;i<3;i++) { const f=new T.Mesh(new T.IcosahedronGeometry(1,0), new T.MeshLambertMaterial({ color:i===0?"#C7B69E":i===1?"#7B746A":"#D9C9AD", flatShading:true, transparent:true })); g.add(f); facets.push(f); }
  const column = new T.Mesh(new T.BoxGeometry(1,1,1), basic("#FFCF3F", { transparent:true, opacity:0.42, depthWrite:false })); g.add(column);
  const arrows=[];
  for(let i=0;i<4;i++){const a=new T.Mesh(new T.ConeGeometry(1,1,3),basic("#FFCF3F",{transparent:true,opacity:0.8}));g.add(a);arrows.push(a);}
  const warn = new T.Mesh(triangleGeometry(12), basic("#FFCF3F", { side:T.DoubleSide })); g.add(warn);
  const warnBar = new T.Mesh(new T.BoxGeometry(1,1,1), basic(INK)); g.add(warnBar);
  const warnDot = new T.Mesh(new T.SphereGeometry(1,8,6), basic(INK)); g.add(warnDot);
  const dust=[];
  for(let i=0;i<3;i++){const d=new T.Mesh(new T.SphereGeometry(1,10,6),new T.MeshLambertMaterial({color:"#C6B39A",transparent:true,depthWrite:false}));g.add(d);dust.push(d);}
  const e={g,hull,stone,facets,column,arrows,warn,warnBar,warnDot,dust,used:false};ROCK.pool.push(e);return e;
}
function updateRocks(R,S){
  const O=window.OBSTACLES&&window.OBSTACLES.rock;if(!O)return;
  for(const e of ROCK.pool)e.used=false;
  const v=R.view, gy=S.H-S.groundH;
  for(const ob of S.pipes){
    if(ob.fam!=="rock")continue;
    if(ob.x>S.W+v.offX+140||ob.x+ob.w< -v.offX-140)continue;
    let e=ROCK.byObstacle.get(ob);if(!e||e.used){e=ROCK.pool.find(q=>!q.used)||newRock(R);ROCK.byObstacle.set(ob,e);}e.used=true;e.g.visible=ob.state!=="gone";
    if(!e.g.visible)continue;
    const rr=O.rockRect(ob),cx=rr.x+rr.w/2,cy=rr.y+rr.h/2;
    const warn=ob.state==="warn"&&!!ob.warnOn, falling=ob.state==="fall", resting=ob.state==="rest";
    const ghostY=ob.gapY-ob.gap/2-ob.rockH-6, drawY=warn?ghostY:rr.y;
    const alpha=warn?0.48:resting?Math.max(0,1-(ob.tRest||0)/0.45):1;
    e.stone.position.set(cx,-(drawY+rr.h/2),17);e.stone.scale.set(rr.w/2,rr.h/2,rr.w*0.34);e.stone.material.opacity=alpha;
    e.hull.position.copy(e.stone.position);e.hull.scale.copy(e.stone.scale).multiplyScalar(1.12);e.hull.visible=alpha>0.02;
    for(let i=0;i<e.facets.length;i++){
      const f=e.facets[i],ang=[-0.7,1.8,2.8][i],sc=[0.24,0.18,0.14][i];
      f.position.set(cx+Math.cos(ang)*rr.w*0.22,-(drawY+rr.h*0.5+Math.sin(ang)*rr.h*0.2),18.4+i*0.1);
      f.scale.set(rr.w*sc,rr.h*sc,rr.w*0.08);f.rotation.z=ang;f.material.opacity=alpha*0.86;
    }
    e.column.visible=warn;e.column.position.set(cx,-(ob.gapY+ob.gap/2)/2,10);e.column.scale.set(3,Math.max(0,ob.gapY+ob.gap/2),1);
    const drop=(S.time||0)*90%44;
    for(let i=0;i<e.arrows.length;i++){const a=e.arrows[i];a.visible=warn;a.position.set(cx,-(42+drop+i*44),12);a.scale.set(7,10,1);a.rotation.z=Math.PI;}
    const blink=Math.sin((S.time||0)*14)>0;
    e.warn.visible=warn;e.warn.position.set(cx,-Math.max(30,ghostY-28),20);e.warn.scale.setScalar(blink?1:0.65);
    e.warnBar.visible=warn;e.warnBar.position.set(cx,-Math.max(30,ghostY-29)+1,21);e.warnBar.scale.set(2,9,1);
    e.warnDot.visible=warn;e.warnDot.position.set(cx,-Math.max(30,ghostY-22),21);e.warnDot.scale.setScalar(1.5);
    const landed=resting&&(ob.tRest||0)<0.25;
    for(let i=0;i<e.dust.length;i++){const d=e.dust[i];d.visible=landed;d.position.set(cx+(i-1)*18,-(rr.y+rr.h+3),13+i);d.scale.set(10+i*2,4+i,1);d.material.opacity=0.6*(1-(ob.tRest||0)/0.25);}
  }
  for(const e of ROCK.pool)if(!e.used)e.g.visible=false;
}
let _rock2d=null;
function muteRock2D(on){const O=window.OBSTACLES&&window.OBSTACLES.rock;if(!O)return;if(!_rock2d)_rock2d=O.draw;
  O.draw=on?function(c,ob,S){if(!(window.__R3D&&window.__R3D.active)||!STUDIO.installed)return _rock2d.call(this,c,ob,S);}:_rock2d;}

/* ============================================================
   install: wrap the render3d.js step table
   ============================================================ */
/* ============================================================
   B-14 · WIND TUNNEL in 3D (render-only; reads dir/time, never accel)
   Wind force remains in the shared simulation; this only replaces the 2D artwork.
   ============================================================ */
const WIND = { pool: [], byObstacle: new WeakMap() };
function newWindArrow(color) {
  const g=new T.Group();
  const back=new T.Mesh(new T.BoxGeometry(1,1,1),basic(INK));g.add(back);
  const shaft=new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshBasicMaterial({color}));g.add(shaft);
  const headBack=new T.Mesh(triangleGeometry(6.6),basic(INK,{side:T.DoubleSide}));g.add(headBack);
  const head=new T.Mesh(triangleGeometry(5),new T.MeshBasicMaterial({color,side:T.DoubleSide}));g.add(head);
  return {g,back,shaft,headBack,head};
}
function pennantGeometry() {
  const g=new T.BufferGeometry();
  g.setAttribute("position",new T.Float32BufferAttribute([0,0,0,12,2,0,19,7,0,11,12,0],3));
  g.setIndex([0,1,2,0,2,3]);g.computeVertexNormals();return g;
}
function newWind(R) {
  const g=new T.Group();g.name="obstacle:wind";R.fg.add(g);const posts=[];
  for(let i=0;i<2;i++){const h=new T.Mesh(new T.BoxGeometry(1,1,1),lam("#7E91A4"));g.add(h);const outline=new T.Mesh(new T.BoxGeometry(1,1,1),basic(INK));g.add(outline);posts.push({h,outline});}
  const flags=[];
  for(let i=0;i<2;i++){const pole=new T.Mesh(new T.BoxGeometry(1,1,1),lam("#3D4C5C"));g.add(pole);const cloth=new T.Mesh(pennantGeometry(),lam("#3FA9E0",{side:T.DoubleSide}));g.add(cloth);flags.push({pole,cloth});}
  const arrows=[];for(let i=0;i<5;i++){const a=newWindArrow("#3FA9E0");g.add(a.g);arrows.push(a);}
  const e={g,posts,flags,arrows,used:false};WIND.pool.push(e);return e;
}
function updateWinds(R,S){
  for(const e of WIND.pool)e.used=false;const v=R.view,gy=S.H-S.groundH;
  for(const ob of S.pipes){
    if(ob.fam!=="wind")continue;if(ob.x>S.W+v.offX+140||ob.x+ob.w< -v.offX-140)continue;
    let e=WIND.byObstacle.get(ob);if(!e||e.used){e=WIND.pool.find(q=>!q.used)||newWind(R);WIND.byObstacle.set(ob,e);}e.used=true;e.g.visible=true;
    const xs=[ob.x-1,ob.x+ob.w-1],dir=ob.dir<0?-1:1;
    for(let i=0;i<2;i++){const x=xs[i],p=e.posts[i];p.h.position.set(x,-(40+gy)/2,7);p.h.scale.set(10,gy-40,8);p.outline.position.copy(p.h.position);p.outline.scale.set(12,gy-38,9);}
    // Match obstacles.js: the rules palette is a full visual mode, not only an arrow tint.
    const color = window.WIND_RULES_ON === true
      ? (dir < 0 ? "#3FD9A8" : "#F2A33A")
      : (dir < 0 ? "#3FA9E0" : "#EF7D23");
    for(let i=0;i<2;i++){const f=e.flags[i],fx=xs[i]+1,wave=Math.sin((S.time||0)*9+(ob.ph||0)+fx)*0.14;
      f.pole.position.set(fx,-58,11);f.pole.scale.set(2.6,14,2.5);f.cloth.position.set(fx,-52,12);f.cloth.rotation.z=dir<0?Math.PI/2+wave:-Math.PI/2-wave;
      f.cloth.material.color.set(color);}
    for(let i=0;i<5;i++){const a=e.arrows[i],x=ob.x+12+(i/4)*(ob.w-24),flow=(((S.time||0)*(140+i*22)+(ob.ph||0)*60)%(gy-80)),y=dir<0?gy-40-flow:60+flow;
      a.g.visible=true;a.g.position.set(x,-y,16);a.g.rotation.z=dir<0?0:Math.PI;
      a.back.position.set(0,-6,-0.6);a.back.scale.set(6.4,27,1.2);
      a.shaft.position.set(0,-6,0);a.shaft.scale.set(3,24,1.5);
      a.head.position.set(0,8,0.5);a.headBack.position.set(0,8,-0.1);a.headBack.scale.setScalar(1.24);
      a.shaft.material.color.set(color);a.head.material.color.set(color);}
  }
  for(const e of WIND.pool)if(!e.used)e.g.visible=false;
}
let _wind2d=null;
function muteWind2D(on){const O=window.OBSTACLES&&window.OBSTACLES.wind;if(!O)return;if(!_wind2d)_wind2d=O.draw;
  O.draw=on?function(c,ob,S){if(!(window.__R3D&&window.__R3D.active)||!STUDIO.installed)return _wind2d.call(this,c,ob,S);}:_wind2d;}

function install(API) {
  const R = API._R, H = API._H; STUDIO.api = API;
  const orig = Object.assign({}, H);
  // bird: replace rig with the swift (pose inputs identical)
  H.updateBird = function (S, o) {
    const B = o.bird, planId = BIRD_PLAN[B.palId] || "tornisA", gear = (GEAR_PRESETS[CFG.gear] || []).slice();
    STUDIO.lastBirdIn = { pal: B.pal, palId: B.palId }; // read-only QA/export hook (Blender pipeline)
    if (B.hat && ITEMS[B.hat] && !gear.some(g => ITEMS[g].slot === ITEMS[B.hat].slot)) gear.push(B.hat);
    const key = B.pal.join(",") + "|" + planId + "|" + gear.join(",") + "|" + (B.scarf || B.pal[5]) + "|" + (B.scarf2 || "");
    if (!R.sbird || R.sbird.key !== key) {
      if (R.sbird) { R.fg.remove(R.sbird.root); R.sbird.root.traverse(n => { if (n.geometry) n.geometry.dispose(); }); }
      if (R.bird && R.bird.root.parent) R.bird.root.parent.remove(R.bird.root);
      const b = makeSwift(B.pal, planId); b.key = key;
      buildScarfInto(b, B.scarf || B.pal[5], B.scarf2);
      for (const id of gear) equipItem(b, id);
      R.fg.add(b.root); b.root.position.set(B.x, -B.y, 0); b.root.scale.setScalar(B.scale); bakeBird(b); R.sbird = b; for (const h of b.hulls) h.visible = R.quality === "high";
      STUDIO.bird = b;
    }
    const b = R.sbird, t = S.time || 0;
    for (const h of b.hulls) h.visible = R.quality === "high";
    b.root.position.set(B.x, -B.y, 0); b.root.scale.setScalar(B.scale); b.root.rotation.set(0, 0, -B.rot);
    poseSwift(b, B, t, o.rm);
    b.rig.position.y = b.flyBob || 0; b.rig.rotation.z = b.flyPitch || 0; // B-12 body bob/pitch on the inner rig: the bird root stays exactly on the sim position (D5), visual only
    const gy = S.H - S.groundH, hF = Math.max(0, Math.min(1, 1 - (gy - B.y) / 500));
    R.shadow.visible = !B.menu && hF > 0.02; R.shadow.position.set(B.x, -gy + 0.5, 22); R.shadow.scale.set(30 - 20 * hF, 0.2, 7); R.shadow.material.opacity = 0.22 * hF;
  };
  // Green Valley world for the meadow levels; every other world keeps the feat/3d world unchanged
  H.setWorldPalette = function (key) {
    const was = R.worldKey, bgT = R.bg.background, ours = bgT === GV.sky || Object.values(KIT.built).some(E => E.sky === bgT);
    if (was !== key && ours) R.bg.background = null; orig.setWorldPalette(key);
    const kit = !!KITS[key], gv = key === "meadow", stamp = key + (gv ? ":gv" : kit ? ":kit" : ":base");
    if (was === key && STUDIO.envStamp === stamp) return; STUDIO.envStamp = stamp;
    const W = R.world; GV.applied = gv;
    if (gv && !GV.built) buildGV(R);
    if (GV.group) GV.group.visible = gv;
    if (kit && !KIT.built[key]) buildKit(R, key);
    for (const k in KIT.built) KIT.built[k].G.visible = k === key; KIT.cur = kit ? KIT.built[key] : null;
    const ours2 = gv || kit;
    for (const k of ["mount", "caps", "hills", "trunks", "canopy", "pine1", "pine2", "clouds"]) if (W[k]) W[k].visible = ours2 ? false : W[k].visible;
    if (!ours2) { const P = API._lib.palFor(key); W.caps.visible = !!P.snow; const round = P.tree === "round"; W.trunks.visible = W.canopy.visible = round; W.pine1.visible = W.pine2.visible = !round; W.mount.visible = W.hills.visible = W.clouds.visible = true; }
    GV.sunPos0 = GV.sunPos0 || W.sunL.position.clone(); GV.sunInt0 = GV.sunInt0 == null ? W.sunL.intensity : GV.sunInt0;
    if (GV.gpMat0 && !kit) W.groundPlane.material = GV.gpMat0;
    if (gv) { R.bg.background = GV.sky; R.bg.fog.color.set("#D3E7F3"); R.bg.fog.near = 1400; R.bg.fog.far = 9500;
      W.groundPlane.material.color.set("#6FAE4F"); W.sun.material.color.set("#FFF4C8"); W.glow.material.color.set("#FFF0B8");
      W.hemi.color.set("#E4F1FF"); W.hemi.groundColor.set("#7FA85A"); W.sunL.color.set("#FFF0D2"); W.sunL.intensity = 2.2;
      W.sunL.position.set(0.45, 0.75, 0.55); // key light from the front-right so camera-facing foliage is lit (feat/3d default is a back light)
      R.fgHemi.color.set("#E9F4FF"); R.fgHemi.groundColor.set("#6E8F4A"); R.fgSun.color.set("#FFF2DA"); }
    else if (kit) { const K = KITS[key], E = KIT.cur; R.bg.background = E.sky; R.bg.fog.color.set(K.fog[0]); R.bg.fog.near = K.fog[1]; R.bg.fog.far = K.fog[2];
      GV.gpMat0 = GV.gpMat0 || W.groundPlane.material; KIT.floorMat = KIT.floorMat || GV.gpMat0.clone(); KIT.floorMat.color.set(K.floor); W.groundPlane.material = KIT.floorMat; /* own material: the shared lam cache entry is recoloured every frame by the 2D ground strip */ W.hemi.color.set(K.hemi[0]); W.hemi.groundColor.set(K.hemi[1]); W.sunL.color.set(K.sun[0]); W.sunL.intensity = K.sun[1]; W.sunL.position.set(...K.key); }
    else { R.bg.fog.near = 900; R.bg.fog.far = 11000; W.sunL.position.copy(GV.sunPos0); W.sunL.intensity = GV.sunInt0; }
  };
  H.updateWorld = function (S, o) { orig.updateWorld(S, o); if (GV.applied && GV.built) updateGV(R, S, o); else if (KIT.cur) updateKit(R, S, o, KIT.cur); };
  H.after = function (S, o) { updatePend(R, S); updateBlades(R, S); updateLasers(R, S); updateRocks(R, S); updateWinds(R, S); };
  mutePendulum2D(true); muteBlade2D(true); muteLaser2D(true); muteRock2D(true); muteWind2D(true);
  // restore the 2D painter if the 3D path falls back
  const d0 = API.dispose; API.dispose = function () { mutePendulum2D(false); muteBlade2D(false); muteLaser2D(false); muteRock2D(false); muteWind2D(false); return d0.apply(this, arguments); };
  STUDIO.installed = true;
}
/* r2.2 bird mesh budget (≤ 12 meshes incl. ink hulls, any gear): bake equipment into the body / wing / tail meshes.
   Only the propeller (spins) and the scarf tails (bend) stay separate. Item extents are recorded before baking for QA. */
function bakeBird(b) {
  b.root.updateMatrixWorld(true); b.preBake = itemBoundsOf(b);
  const into = (host, test) => { // host = {g, m, h} from withHull; collects meshes under the bird matching test
    const hostInv = new T.Matrix4().copy(host.m.matrixWorld).invert(), add = [], kill = [];
    b.root.traverse(n => { if (!n.isMesh || n.userData.hull || n === host.m || !test(n)) return;
      const g = n.geometry.clone(), M = new T.Matrix4().multiplyMatrices(hostInv, n.matrixWorld); g.applyMatrix4(M); if (M.determinant() < 0) flipWinding(g);
      if (!g.getAttribute("color")) { const c = n.material.color || new T.Color(1, 1, 1), k = g.getAttribute("position").count, a = new Float32Array(k * 3); for (let i = 0; i < k; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute("color", new T.BufferAttribute(a, 3)); }
      add.push(g); let grp = n.parent; kill.push(grp.name && (grp.name.startsWith("item:") || grp.name === "") && grp !== host.g ? grp : n); });
    if (!add.length) return;
    const old = host.m.geometry, ng = merge([old.clone(), ...add]); host.m.geometry = ng; host.h.geometry = ng; old.dispose();
    for (const k of kill) if (k.parent) { k.parent.remove(k); k.traverse(q => { if (q.geometry && q.geometry !== ng) q.geometry.dispose(); }); }
  };
  const under = (n, o) => { let p = n; while (p) { if (p === o) return true; p = p.parent; } return false; };
  const W = [b.parts.wingL, b.parts.wingR], tailG = b.parts.tail, scT = b.root.getObjectByName("scarfTails");
  const spinning = n => { let p = n; while (p) { if (p.name === "item:propeller") return true; p = p.parent; } return false; };
  const host = o => { const g = o.children.find(c => c.isGroup && c.children.some(m => m.isMesh && !m.userData.hull)) || o; const m = g.children.find(c => c.isMesh && !c.userData.hull), h = g.children.find(c => c.userData.hull); return { g, m, h }; };
  if (!b.fw) for (const w of W) { const wg = w.children[0]; into(host(wg), n => under(n, w)); } // B-12b feather wing: wing items stay on their forearm socket (not baked)
  into(host(tailG), n => under(n, tailG));
  const bodyHost = b.parts.body; into(bodyHost, n => !(b.fw && under(n, b.fw.group)) && !W.some(w => under(n, w)) && !under(n, tailG) && !(scT && under(n, scT)) && !spinning(n) && !b.parts.eyes.some(e => under(n, e)));
  const pr = b.root.getObjectByName("item:propeller"); if (pr) pr.children.filter(c => c.userData.hull).forEach(h => pr.remove(h)); // spinning prop: no ink hull (keeps any preset ≤ 12 meshes)
  b.hulls = collectHulls(b.root);
}
function itemBoundsOf(b) { const API = STUDIO.api; if (!API) return []; const L = API._lib, out = [];
  b.root.traverse(n => { if (n.name && n.name.startsWith("item:") || n.name === "scarf") { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    n.traverse(m => { if (!m.isMesh || m.userData.hull) return; const pos = m.geometry.getAttribute("position"); for (let i = 0; i < pos.count; i += 3) { const p = new T.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); const q = L.toGame(p.x, p.y, p.z); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); } });
    out.push({ item: n.name, w: +(x1 - x0).toFixed(1), h: +(y1 - y0).toFixed(1), x0: +x0.toFixed(1), y0: +y0.toFixed(1) }); } });
  return out; }
function buildScarfInto(b, col, col2) { const s = buildScarf(b, col, col2); b.sockets.neck.add(s); b.hulls.push(...collectHulls(s)); }
function collectHulls(o) { const a = []; o.traverse(n => { if (n.userData.hull) a.push(n); }); return a; }

/* ---------- QA helpers (read-only) ---------- */
function pendBounds() {
  const API = STUDIO.api; if (!API || !PEN.last) return [];
  const L = API._lib, out = [];
  for (const { ob, e, b } of PEN.last) { e.ball.updateMatrixWorld(true);
    // project the hull silhouette: sample the sphere surface (radius 1.11 in ball space) and take the max extent
    let rMax = 0; const c = L.toGame(e.ball.position.x, e.ball.position.y, 0);
    for (let i = 0; i < 400; i++) { const u = Math.acos(2 * ((i + 0.5) / 400) - 1), a = i * 2.39996; const p = new T.Vector3(Math.sin(u) * Math.cos(a) * 1.17, Math.sin(u) * Math.sin(a) * 1.17, Math.cos(u) * 1.17).applyMatrix4(e.ball.matrixWorld);
      const q = L.toGame(p.x, p.y, p.z); rMax = Math.max(rMax, Math.hypot(q[0] - c[0], q[1] - c[1])); }
    out.push({ ballX2d: b.x, ballY2d: b.y, cx3d: c[0], cy3d: c[1], r2d: ob.bobR, r3d: rMax, hitR: ob.bobR - 3 }); }
  return out;
}
function itemBounds() { const b = STUDIO.bird; return b ? (b.preBake || []) : []; } // extents recorded just before baking (rest pose)

const STUDIO = window.R3D_STUDIO = { VERSION, CFG, PLANS, ITEMS, GEAR_PRESETS, install, makeSwift, equipItem, buildScarf: buildScarfInto, poseSwift, triCount, meshCount, FLIGHT_BASE, FLIGHT_BIRD, flightParams, strokeAt, FW_PLANS, FW_P, buildFeatherWings, poseFeather, poseScarfTails, fwTable,
  pendBounds, itemBounds, GV, PEN, KIT, KITS, GG, gapAudit, wingOutline, active: true };
})();
