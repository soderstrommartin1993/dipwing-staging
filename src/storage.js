/* ============================================================
   src/storage.js — A3 (P0-3, P2-8): säker lagring.
   ALL åtkomst till localStorage går härigenom. Kastar aldrig.
   - Blockerad lagring (SecurityError: cookies av, vissa webbvyer,
     vissa privata lägen) ⇒ mode "memory": spelet fungerar, inget sparas
     mellan sessioner, och UI visar en vänlig notis.
   - Full kvot (QuotaExceededError) ⇒ värdet hålls i ett minnesöverlägg
     så sessionen förblir konsekvent; notis visas; nästa lyckade skrivning
     tar bort överlägget för nyckeln.
   - Inga nätverksanrop, inga tredjeparter.
   ============================================================ */
(function () {
"use strict";
const mem = Object.create(null);      // fullt minnesläge eller överlägg vid kvotfel
const failedKeys = Object.create(null);
let ls = null, mode = "memory", reason = null, quotaHit = false, writeFailures = 0;
const listeners = [];
function notify(kind) { for (const f of listeners) { try { f(kind, api.status()); } catch (e) {} } }
try {
  // staging: if the pfb_staging_ namespace could not be installed, never touch the real keys
  if (window.__DW_FORCE_MEMORY_STORAGE) throw { name: "staging-namespace-unavailable" };
  const s = window.localStorage;               // kan kasta SecurityError
  const probe = "__pfb_probe__";
  s.setItem(probe, "1"); s.removeItem(probe);  // kan kasta (Safari privat, kvot 0)
  ls = s; mode = "local";
} catch (e) {
  reason = (e && e.name) || "unavailable";
  if (!window.__DW_FORCE_MEMORY_STORAGE) try { if (window.localStorage) { window.localStorage.getItem("pfb_save_v2"); ls = window.localStorage; mode = "readonly"; } } catch (e2) { ls = null; }
}
const api = {
  get mode() { return mode; },
  get(k) {
    if (k in mem) return mem[k];
    if (!ls) return null;
    try { return ls.getItem(k); } catch (e) { return null; }
  },
  /* true = beständigt sparat; false = endast i minnet denna session */
  set(k, v) {
    v = String(v);
    if (ls && mode !== "memory") {
      try { ls.setItem(k, v); if (k in failedKeys) { delete failedKeys[k]; delete mem[k]; } return true; }
      catch (e) {
        writeFailures++;
        const q = e && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22);
        if (q && !quotaHit) { quotaHit = true; reason = "quota"; }
        else if (!q) reason = (e && e.name) || "write-failed";
        failedKeys[k] = 1; mem[k] = v; notify(q ? "quota" : "write-failed");
        return false;
      }
    }
    mem[k] = v; return false;
  },
  remove(k) { delete mem[k]; delete failedKeys[k]; if (!ls) return; try { ls.removeItem(k); } catch (e) {} },
  keys() {
    const out = new Set(Object.keys(mem));
    if (ls) { try { for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k != null) out.add(k); } } catch (e) {} }
    return Array.from(out);
  },
  /* Sparas framsteg beständigt just nu? */
  persistent() { return mode === "local" && !quotaHit && !Object.keys(failedKeys).length; },
  status() { return { mode, reason, quotaHit, writeFailures, failedKeys: Object.keys(failedKeys), persistent: api.persistent() }; },
  onIssue(fn) { if (typeof fn === "function") listeners.push(fn); }
};
window.SafeStorage = api;
})();
