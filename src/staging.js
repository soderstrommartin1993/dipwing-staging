/* ============================================================
   src/staging/staging.js — ONLY in the staging build (tools/build.mjs --staging).
   Loaded first, before every other script. It does three things:
   1. Storage namespace: window.localStorage is replaced by a view that reads and writes ONLY keys
      prefixed "pfb_staging_". The game never sees, reads or writes an unprefixed (live) key.
      If the browser refuses the replacement, storage falls back to memory-only for this session
      (window.__DW_FORCE_MEMORY_STORAGE, honoured by src/storage.js) – never to the real keys.
   2. An always-visible STAGING label (version · commit · build date) + "About this test version" panel
      with "Reset test data" (removes only pfb_staging_* keys).
   3. Nothing else: no network, no third parties, no payments, no ads.
   ============================================================ */
(function () {
"use strict";
const P = "pfb_staging_";
let real = null;
try { real = window.localStorage; } catch (e) { real = null; }
function ownKeys() {
  const out = [];
  if (!real) return out;
  try { for (let i = 0; i < real.length; i++) { const k = real.key(i); if (k != null && k.indexOf(P) === 0) out.push(k.slice(P.length)); } } catch (e) {}
  return out;
}
const view = {
  getItem(k) { return real.getItem(P + String(k)); },
  setItem(k, v) { real.setItem(P + String(k), String(v)); },
  removeItem(k) { real.removeItem(P + String(k)); },
  clear() { for (const k of ownKeys()) real.removeItem(P + k); },
  key(i) { const ks = ownKeys(); return i >= 0 && i < ks.length ? ks[i] : null; },
  get length() { return ownKeys().length; }
};
let ns = "memory";
if (real) {
  try {
    Object.defineProperty(window, "localStorage", { configurable: true, enumerable: true, get() { return view; } });
    if (window.localStorage === view) ns = "prefixed";
  } catch (e) {}
}
if (ns !== "prefixed") window.__DW_FORCE_MEMORY_STORAGE = true;

const STAGING = window.DW_STAGING = Object.freeze({
  prefix: P, storage: ns,
  resetTestData() { // removes ONLY pfb_staging_* keys
    let n = 0;
    if (real) { const ks = []; try { for (let i = 0; i < real.length; i++) { const k = real.key(i); if (k && k.indexOf(P) === 0) ks.push(k); } } catch (e) {}
      for (const k of ks) { try { real.removeItem(k); n++; } catch (e) {} } }
    return n;
  }
});

/* ---------- UI (built after the DOM exists; scripts sit at the end of <body>) ---------- */
const TXT = {
  sv: { about: "Om testversionen", title: "🧪 Om testversionen", close: "Stäng",
    intro: "Det här är en <b>testversion (staging)</b> av Dipwing. Den officiella versionen på Perchance påverkas inte.",
    nopay: "<b>Inga betalningar/annonser i testversionen.</b> Inga konton, ingen inloggning. Spelet skickar inga data någonstans.",
    save: "Sparfiler: testversionen sparar bara i den här webbläsaren, under nycklar som börjar med <code>pfb_staging_</code>. Dina riktiga sparfiler (på perchance.org) ligger på en annan adress och kan inte läsas eller skrivas härifrån.",
    mem: "Lagring är avstängd i den här webbläsaren: inget sparas när du stänger sidan.",
    src: "Källkoden är synlig: spelets JavaScript i testversionen kan läsas av alla som har länken. Det finns inga lösenord, nycklar eller hemligheter i den.",
    dev: "Provad i emulerad Pixel 7 (Chromium på datorn), <b>inte</b> på en fysisk Android-telefon. Säg gärna till om något beter sig konstigt.",
    menu: "🧪 Inga betalningar/annonser i testversionen",
    reset: "🗑️ Nollställ testdata", confirm: "Tryck igen för att radera alla testdata", done: "Testdata raderade – laddar om…",
    v: "Version", c: "Commit", b: "Byggd" },
  en: { about: "About this test version", title: "🧪 About this test version", close: "Close",
    intro: "This is a <b>test version (staging)</b> of Dipwing. The official version on Perchance is not affected.",
    nopay: "<b>No payments/ads in the test version.</b> No accounts, no sign-in. The game sends no data anywhere.",
    save: "Saves: the test version stores data only in this browser, under keys starting with <code>pfb_staging_</code>. Your real saves (on perchance.org) live on another address and cannot be read or written from here.",
    mem: "Storage is unavailable in this browser: nothing is kept after you close the page.",
    src: "The source is visible: the game's JavaScript in this test version can be read by anyone with the link. It contains no passwords, keys or secrets.",
    dev: "Tried in an emulated Pixel 7 (Chromium on a computer), <b>not</b> on a physical Android phone.",
    menu: "🧪 No payments/ads in the test version",
    reset: "🗑️ Reset test data", confirm: "Tap again to delete all test data", done: "Test data deleted – reloading…",
    v: "Version", c: "Commit", b: "Built" }
};
const L = () => TXT[(window.I18N && I18N.lang === "en") ? "en" : "sv"];
function build() { return window.GAME_BUILD || {}; }
function shortDate(iso) { return iso ? String(iso).slice(0, 10) : "?"; }
function label() { const b = build(); return "STAGING v" + (window.GAME_VERSION || b.version || "?") + " · " + String(b.commit || "?") + " · " + shortDate(b.builtAt); }

function css() {
  const s = document.createElement("style");
  s.textContent = `
  #stagingBadge{position:absolute;left:calc(6px + env(safe-area-inset-left));bottom:calc(4px + env(safe-area-inset-bottom));z-index:70;
    max-width:calc(100% - 72px);min-height:24px;padding:3px 8px;border:1px solid #ffffff66;border-radius:8px;
    background:#c2185bdd;color:#fff;font:800 10px/1.3 "Nunito",system-ui,sans-serif;letter-spacing:.02em;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;touch-action:manipulation;}
  #stagingBadge.inplay{pointer-events:none;opacity:.8;}
  #stagingBadge::after{content:"";position:absolute;left:-6px;right:-6px;top:-10px;bottom:-10px;} /* 44 px tap area */
  #stagingOv{position:absolute;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;background:#0a0e20cc;
    padding:calc(16px + env(safe-area-inset-top)) calc(14px + env(safe-area-inset-right)) calc(16px + env(safe-area-inset-bottom)) calc(14px + env(safe-area-inset-left));}
  #stagingOv[hidden]{display:none !important;}
  #stagingOv .scard{background:#fffdf6;color:#2b2118;border-radius:18px;max-width:460px;width:100%;max-height:100%;overflow:auto;
    padding:18px 18px 14px;text-align:left;font:600 14px/1.45 "Nunito",system-ui,sans-serif;overscroll-behavior:contain;}
  #stagingOv h2{font:800 22px/1.2 "Baloo 2","Nunito",system-ui,sans-serif;margin:0 0 8px;text-align:center;}
  #stagingOv p{margin:0 0 9px;} #stagingOv code{font-size:12px;background:#0001;padding:0 3px;border-radius:4px;}
  #stagingOv .meta{font:700 12px/1.5 ui-monospace,monospace;background:#0000000d;border-radius:10px;padding:8px 10px;margin:0 0 10px;word-break:break-all;}
  #stagingOv button{display:block;width:100%;min-height:44px;margin:8px 0 0;border-radius:12px;border:2px solid #2b2118;
    font:800 15px "Baloo 2","Nunito",system-ui,sans-serif;cursor:pointer;touch-action:manipulation;background:#fff;color:#2b2118;}
  #stagingOv #stagingReset{background:#ffe1dc;} #stagingOv #stagingReset.armed{background:#ff6b4a;color:#fff;}
  #stagingOv .smsg{min-height:18px;font-size:12px;text-align:center;margin-top:6px;}
  #stagingAboutBtn{margin-top:8px;}`;
  document.head.appendChild(s);
}
function el(tag, attrs, html) { const e = document.createElement(tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; }
let ov, armed = false, armTimer = 0;
function render() {
  const t = L(), b = build();
  ov.querySelector(".scard").innerHTML =
    `<h2>${t.title}</h2><div class="meta" id="stagingMeta">${t.v}: ${window.GAME_VERSION || b.version || "?"}<br>${t.c}: ${b.commit || "?"}<br>${t.b}: ${b.builtAt || "?"}</div>` +
    `<p>${t.intro}</p><p id="stagingNoPay">${t.nopay}</p><p>${STAGING.storage === "prefixed" ? t.save : t.mem}</p><p>${t.src}</p><p>${t.dev}</p>` +
    `<button id="stagingReset" type="button">${t.reset}</button><div class="smsg" id="stagingMsg" role="status"></div>` +
    `<button id="stagingClose" type="button">${t.close}</button>`;
  ov.querySelector("#stagingClose").onclick = close;
  ov.querySelector("#stagingReset").onclick = onReset;
}
function open() { armed = false; render(); ov.hidden = false; try { ov.querySelector("#stagingClose").focus(); } catch (e) {} }
function close() { ov.hidden = true; }
function onReset() {
  const t = L(), btn = ov.querySelector("#stagingReset"), msg = ov.querySelector("#stagingMsg");
  if (!armed) { armed = true; btn.classList.add("armed"); msg.textContent = t.confirm; clearTimeout(armTimer);
    armTimer = setTimeout(() => { armed = false; btn.classList.remove("armed"); msg.textContent = ""; }, 5000); return; }
  STAGING.resetTestData(); msg.textContent = t.done;
  setTimeout(() => { try { location.reload(); } catch (e) {} }, 400);
}
function mount() {
  const stage = document.getElementById("stage") || document.body;
  css();
  const badge = el("button", { id: "stagingBadge", type: "button", "aria-label": "STAGING – " + L().about });
  badge.textContent = label(); stage.appendChild(badge); badge.onclick = open;
  ov = el("div", { id: "stagingOv", role: "dialog", "aria-modal": "true", "aria-label": L().about }); ov.hidden = true;
  ov.appendChild(el("div", { class: "scard" })); stage.appendChild(ov);
  ov.addEventListener("pointerdown", e => { if (e.target === ov) close(); });
  window.addEventListener("keydown", e => { if (!ov.hidden && e.code === "Escape") { e.stopImmediatePropagation(); close(); } }, true);
  // second, always-reachable entry: a button in Settings next to the version line
  const vl = document.getElementById("settingsBackBtn") || document.getElementById("versionLine");
  if (vl && vl.parentNode) { const btn = el("button", { id: "stagingAboutBtn", class: "btn secondary", type: "button" }, "🧪 " + L().about);
    btn.onclick = open; vl.parentNode.insertBefore(btn, vl); }
  // menu line (visible without tapping anything)
  const wt = document.getElementById("workingTitle");
  if (wt && wt.parentNode) { const m = el("div", { id: "stagingMenuNote", class: "tiny", role: "note" }); m.style.cssText = "margin-top:4px;color:#c2185b;font-weight:800;white-space:normal;";
    wt.parentNode.insertBefore(m, wt.nextSibling); }
  // the badge stays visible during play but never eats a flap tap
  const hud = document.getElementById("hud");
  const sync = () => { badge.classList.toggle("inplay", !!hud && !hud.hidden); const ab = document.getElementById("stagingAboutBtn"); if (ab) ab.textContent = "🧪 " + L().about;
    const mn = document.getElementById("stagingMenuNote"); if (mn) mn.textContent = L().menu; };
  if (hud && window.MutationObserver) new MutationObserver(sync).observe(hud, { attributes: true, attributeFilter: ["hidden"] });
  if (window.MutationObserver) new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  sync();
}
// DOMContentLoaded: version.js (GAME_BUILD) and the game scripts have run by then
if (document.readyState === "complete") mount(); else document.addEventListener("DOMContentLoaded", mount);
window.DW_STAGING_UI = { open, close, label };
})();
