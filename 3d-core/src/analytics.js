/* ============================================================
   DIPWING — src/analytics.js (Stage C: lokal händelsebuss)
   Medvetet minimal och leverantörsoberoende:
   - Ringbuffert i minnet (senaste 200 händelserna). Noll nätverk,
     noll spårning, noll tredjepart. Data lämnar aldrig enheten.
   - Syfte: balansering/felsökning (vilka nivåer dör spelare på?
     vilka familjer? hur ofta byts språk/läge?).
   - En framtida backend kan läsa bufferten via export() och skicka
     den explicit — ingen sådan kod finns här (medvetet).
   ============================================================ */
(function () {
"use strict";

const CAP = 200;
const buf = [];
let seq = 0;

function emit(name, data) {
  if (window.__DW_SIM) return; // simuleringstester loggas aldrig
  try {
    buf.push({ seq: ++seq, t: Date.now(), name: String(name), data: data || null });
    if (buf.length > CAP) buf.splice(0, buf.length - CAP);
  } catch (e) {}
}

const api = {
  emit,
  /* Nyaste först. */
  list(n) {
    const k = Math.max(1, Math.min(CAP, n || 50));
    return buf.slice(-k).reverse();
  },
  count() { return buf.length; },
  clear() { buf.length = 0; },
  /* Framtida exportkrok (ingen avsändare implementerad). */
  export() { return JSON.stringify({ v: 1, events: buf.slice() }); }
};

window.Analytics = api;
})();
