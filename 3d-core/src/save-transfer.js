/* ============================================================
   DIPWING — src/save-transfer.js (E7: local save export / import)
   Everything stays on the device: export = a JSON file the player downloads (and a clipboard copy);
   import = the player picks that file. No network, no account.
   Import is validated (format, key names, sizes, SaveV2.validate on the main doc) and REVERSIBLE:
   the current state is snapshotted to pfb_import_undo_v1 first; "Undo import" restores it.
   ============================================================ */
(function () {
"use strict";
const FORMAT = "dipwing-save-export", FVER = 1, UNDO_KEY = "pfb_import_undo_v1";
const KEEP = /^pfb_(save_premigration_v|save_v2_corrupt_|import_undo_v1$|identity_v1$|audio_pack$|econ_v2$)/; // never exported/overwritten
const KEY_RE = /^pfb_[a-z0-9_]{1,60}$/;
const MAX_BYTES = 1500000;
function ls() { return window.SafeStorage || { get: k => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v), remove: k => localStorage.removeItem(k) }; }
function allKeys() { try { if (window.SafeStorage && SafeStorage.keys) return SafeStorage.keys(); } catch (e) {} try { const out = []; for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)); return out; } catch (e) { return []; } }
function gameKeys() { return allKeys().filter(k => KEY_RE.test(k) && !KEEP.test(k)); }
function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ("0000000" + (h >>> 0).toString(16)).slice(-8); }
function snapshot() { const o = {}; for (const k of gameKeys()) { const v = ls().get(k); if (v != null) o[k] = v; } return o; }
function exportObj() {
  const keys = snapshot(); const body = JSON.stringify(keys);
  return { format: FORMAT, version: FVER, game: window.GAME_VERSION || "?", exportedAt: new Date().toISOString(), sum: fnv(body), keys };
}
function exportText() { return JSON.stringify(exportObj(), null, 1); }
function check(text) {
  if (typeof text !== "string" || !text.length) return { error: "empty" };
  if (text.length > MAX_BYTES) return { error: "too-large" };
  let o; try { o = JSON.parse(text); } catch (e) { return { error: "not-json" }; }
  if (!o || o.format !== FORMAT || typeof o.version !== "number") return { error: "format" };
  if (o.version > FVER) return { error: "newer-format" };
  const keys = o.keys; if (!keys || typeof keys !== "object" || Array.isArray(keys)) return { error: "keys" };
  for (const k of Object.keys(keys)) { if (!KEY_RE.test(k) || KEEP.test(k) || typeof keys[k] !== "string") return { error: "bad-key:" + k }; }
  if (o.sum && o.sum !== fnv(JSON.stringify(keys))) return { error: "checksum" };
  if (!keys.pfb_save_v2) return { error: "no-save" };
  let doc; try { doc = JSON.parse(keys.pfb_save_v2); } catch (e) { return { error: "save-json" }; }
  const v = window.SaveV2 ? SaveV2.validate(doc) : { doc };
  if (!v.doc) return { error: "save-invalid:" + v.error };
  return { ok: true, obj: o, feathers: v.doc.feathers | 0, unlocked: v.doc.unlocked | 0, v: v.doc.v };
}
function writeKeys(keys) {
  for (const k of gameKeys()) if (!(k in keys)) ls().remove(k);
  for (const k of Object.keys(keys)) ls().set(k, keys[k]);
}
function importText(text) {
  const c = check(text); if (!c.ok) return c;
  try { ls().set(UNDO_KEY, JSON.stringify({ at: new Date().toISOString(), keys: snapshot() })); } catch (e) { return { error: "snapshot" }; }
  try { writeKeys(c.obj.keys); } catch (e) { undoImport(); return { error: "write" }; }
  return { ok: true, feathers: c.feathers, unlocked: c.unlocked };
}
function hasUndo() { try { return !!ls().get(UNDO_KEY); } catch (e) { return false; } }
function undoImport() {
  let u; try { u = JSON.parse(ls().get(UNDO_KEY) || "null"); } catch (e) { u = null; }
  if (!u || !u.keys) return { error: "no-undo" };
  writeKeys(u.keys); ls().remove(UNDO_KEY); return { ok: true };
}
window.SaveTransfer = { FORMAT, UNDO_KEY, exportObj, exportText, check, importText, undoImport, hasUndo };
})();
