/* ============================================================
   DIPWING — Round 7: data-driven boss runtime (3D build only).
   Boss body lives in the depth renderer and is never part of collision data.
   Attack hazards are separate game-plane colliders delivered to DipwingSim.bossStep().
   ============================================================ */
(function () {
"use strict";
const Bridge = window.DipwingBossBridge;
const Data = window.DipwingBossData;
if (!Bridge || !Data || !window.DipwingSim) return;
const Sim = window.DipwingSim;
const STORE_KEY = "pfb_level_id_save_v1";
const MIGRATION_KEY = "pfb_level_id_migration_v1";
const BACKUP_KEY = "pfb_omg7_legacy_backup_v1";
const BOSS_KEY = "pfb_boss_almor_v1";
const LEGACY_KEYS = ["pfb_unlocked_v1", "pfb_best_v1", "pfb_best_sky_v1", "pfb_cleared_v1",
  "pfb_cleared_sky_v1", "pfb_medals_v1", "pfb_save_v2", "pfb_save_v2_backup"];
const WORLD_LABELS = Data.WORLD_NAMES;
const WORLD_LABELS_SV = Data.WORLD_NAMES_SV;

function safeGet(key) { try { return window.SafeStorage ? SafeStorage.get(key) : localStorage.getItem(key); } catch (e) { return null; } }
function safeSet(key, value) { try { return window.SafeStorage ? SafeStorage.set(key, value) : (localStorage.setItem(key, value), true); } catch (e) { return false; } }
function safeJson(key, fallback) { try { const v = safeGet(key); return v == null || v === "" ? fallback : JSON.parse(v); } catch (e) { return fallback; } }
function clone(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; } }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function legacyId(level) {
  // 7a (REVIEW_7 B13): only real legacy levels map back to an ID. The signature flight shares game level 41 with the
  // legacy "L41" that exists after L40, so it is only ever entered from its map node, never by number (Next after L40).
  const n = Number(level);
  for (const id of Object.keys(Data.LEVELS)) if (Data.LEVELS[id].legacyLevel === n) return id;
  return null;
}
function readBossSave() {
  const d = safeJson(BOSS_KEY, {});
  return d && typeof d === "object" ? d : {};
}
function writeBossSave(data) { safeSet(BOSS_KEY, JSON.stringify(data)); }
function readIDSave() {
  const raw = safeGet(STORE_KEY);
  if (raw == null || raw === "") return { raw, data: null };
  try { const data = JSON.parse(raw); return { raw, data: data && typeof data === "object" ? data : null }; }
  catch (e) { return { raw, data: null, corrupt: true }; }
}
function migrateStableIds() {
  const read = readIDSave();
  if (read.data && read.data.migrated === true && read.data.mappingVersion === "omg7-v3") return read.data;
  if (read.corrupt && safeGet("pfb_level_id_corrupt_backup_v1") == null) safeSet("pfb_level_id_corrupt_backup_v1", read.raw);
  const raw = {};
  for (const key of LEGACY_KEYS) raw[key] = safeGet(key);
  // Backup exact legacy strings before writing any ID-keyed state. Legacy keys are never removed or rewritten.
  if (safeGet(BACKUP_KEY) == null) {
    const snapshot = { version: 1, source: "3d-save-migration-omg7", at: new Date().toISOString(), keys: raw };
    safeSet(BACKUP_KEY, JSON.stringify(snapshot));
  }
  const data = Data.migrateLegacyProgress(raw, new Date().toISOString(), readBossSave());
  safeSet(STORE_KEY, JSON.stringify(data));
  safeSet(MIGRATION_KEY, "complete");
  return data;
}
let idSave = migrateStableIds();
function syncStableRecords() {
  if (!idSave || typeof idSave !== "object") idSave = migrateStableIds();
  if (!idSave.records || typeof idSave.records !== "object") idSave.records = {};
  const st = Bridge.store;
  for (const [id, entry] of Object.entries(Data.LEVELS)) {
    const n = entry.gameLevel; if (n == null) continue;
    const old = idSave.records[id] || {};
    const readMode = mode => {
      const prev = old[mode] || {};
      const best = Number(st.bestFor(mode, n)) || 0;
      const cleared = !!st.isCleared(mode, n);
      const medal = Number(st.medal(mode, n)) || 0;
      return { best: Math.max(Number(prev.best) || 0, best), cleared: !!prev.cleared || cleared,
        medal: Math.max(Number(prev.medal) || 0, medal) };
    };
    idSave.records[id] = { classic: readMode("classic"), sky: readMode("sky") };
  }
  idSave.unlockedLegacy = Math.max(Number(idSave.unlockedLegacy) || 1, Number(st.unlocked) || 1);
  safeSet(STORE_KEY, JSON.stringify(idSave));
  return idSave;
}
function isLevelDone(idOrLevel) {
  const st = Bridge.store;
  const entry = typeof idOrLevel === "string" ? Data.LEVELS[idOrLevel] : null;
  // 7a (B13): the signature flight is done only via its own flag – old legacy L41 records never count for w1-l6.
  if (entry && entry.signature) return !!(idSave && idSave.signatureCleared && idSave.signatureCleared[entry.id]);
  const level = entry ? entry.gameLevel : Number(idOrLevel);
  if (!Number.isFinite(level)) return false;
  return !!(st.isCleared("classic", level) || st.isCleared("sky", level) ||
    (Number(st.bestFor("classic", level)) >= 1 && Number(st.bestFor("classic", level)) >= Bridge.targetForLevel(level)) ||
    (Number(st.bestFor("sky", level)) >= 1 && Number(st.bestFor("sky", level)) >= Bridge.targetForLevel(level)));
}
function worldUnlocked(world) {
  const w = Math.max(1, Number(world) || 1), unlocked = Number(Bridge.store.unlocked) || 1;
  if (w <= 1) return true;
  if (w === 2) return Data.worldTwoUnlocked(isLevelDone("w1-l6"), idSave.originalUnlockedLegacy);
  const firstLegacy = (w - 1) * 5 + 1;
  return unlocked >= firstLegacy || Number(idSave.originalUnlockedLegacy || 1) >= firstLegacy;
}
function isIDUnlocked(id) {
  const entry = Data.LEVELS[id]; if (!entry || entry.gameLevel == null) return false;
  const unlocked = Number(Bridge.store.unlocked) || 1;
  if (entry.signature) return unlocked >= 6 || isLevelDone(id);
  return entry.legacyLevel != null && entry.legacyLevel <= unlocked && worldUnlocked(entry.world);
}
function w1NormalComplete() { for (let n = 1; n <= 6; n++) if (!isLevelDone(`w1-l${n}`)) return false; return true; }
function bossComplete() { return !!readBossSave().beaten; }
function worldOneComplete() { return Data.worldOneComplete(w1NormalComplete(), bossComplete()); }
function safeLang() { try { return (window.I18N && I18N.lang) || document.documentElement.lang || "sv"; } catch (e) { return "sv"; } }
const txt = (sv, en) => safeLang() === "en" ? en : sv;

const Boss = {
  active: false, finished: false, won: false, phase: 1, phaseT: 0, acc: 0, breakT: 0,
  sim: null, attacks: [], rings: [], deaths: [0, 0, 0], mercy: false, seed: 0,
  warningPlayed: new Set(), collected: [], secretSequenceIndex: 0, h2Hook: false,
  checkpointNotice: "", checkpointT: 0, exitButton: null, mapModal: null,
  currentMapLevelId: null, lastRecordsSync: 0, startTime: 0,
  onLegacyStart(level) {
    const sig = Data.LEVELS["w1-l6"].gameLevel;
    // keep the signature context only for a (re)start of the signature flight itself (map launch, retry); Next after L40 is legacy L41
    if (!(this.currentMapLevelId === "w1-l6" && Number(level) === sig)) this.currentMapLevelId = legacyId(level);
    syncStableRecords();
  },
  markSignatureCleared() {
    if (!idSave || typeof idSave !== "object") idSave = migrateStableIds();
    idSave.signatureCleared = Object.assign({}, idSave.signatureCleared, { "w1-l6": true });
    safeSet(STORE_KEY, JSON.stringify(idSave));
  },
  canLaunchLegacy(level) { const id = this.currentMapLevelId || legacyId(level); return !id || isIDUnlocked(id); },
  syncLevelProgress() { syncStableRecords(); },
  readProgress() { return readBossSave(); },
  openMap() { renderMap(); this.ensureModal().hidden = false; },
  closeMap() { if (this.mapModal) this.mapModal.hidden = true; },
  ensureModal() {
    if (this.mapModal) return this.mapModal;
    const el = document.createElement("div"); el.id = "dipwingBplusMap"; el.hidden = true;
    el.innerHTML = `<div class="dw-map-card" role="dialog" aria-modal="true" aria-labelledby="dwMapTitle">
      <div class="dw-map-head"><div><div class="dw-eyebrow">DIPWING · ADVENTURE 1.0</div><h2 id="dwMapTitle"></h2></div><button type="button" class="dw-close" data-dw-close aria-label="">×</button></div>
      <p class="dw-intro" id="dwMapIntro"></p><div id="dwMapW1"></div><div id="dwMapBoss"></div>
      <div class="dw-challenges" id="dwChallenges"></div><div class="dw-world-list" id="dwWorldList"></div>
      <details class="dw-legacy"><summary></summary><p>Spelbara äldre banor behåller sina gamla rekord och medaljer under nya ID:n. Nya signaturbanor visas som Kommer snart.</p><div id="dwAllIds"></div></details>
      <div class="dw-map-foot"><button type="button" class="dw-primary dw-back" data-dw-close></button></div>
    </div>`;
    el.addEventListener("click", e => {
      const close = e.target.closest("[data-dw-close]"); if (close) { this.closeMap(); return; }
      const level = e.target.closest("[data-dw-level]"); if (level) {
        const id = level.getAttribute("data-dw-level"), entry = Data.LEVELS[id];
        if (entry && isIDUnlocked(id)) {
          this.closeMap(); Bridge.launchLegacy(entry.gameLevel, id); // sets currentMapLevelId = id before showReady
        }
        return;
      }
      if (e.target.closest("[data-dw-boss]")) {
        if (w1NormalComplete()) { this.closeMap(); this.start(); }
        return;
      }
    });
    document.body.appendChild(el); this.mapModal = el; this.refreshTexts(); return el;
  },
  installUI() {
    const menu = document.querySelector("#menuCard .menuBottom");
    if (menu && !document.getElementById("dwMapButton")) {
      const b = document.createElement("button"); b.type = "button"; b.id = "dwMapButton"; b.className = "btn secondary dw-home-map";
      b.textContent = txt("🗺️ Världskarta 1.0", "🗺️ World map 1.0");
      b.addEventListener("click", () => this.openMap());
      const play = document.getElementById("playBtn");
      if (play && play.parentNode === menu) play.insertAdjacentElement("afterend", b); else menu.prepend(b);
    }
    const subtitle = document.getElementById("menuSubtitle");
    if (subtitle && !document.getElementById("dwHomeHint")) {
      const hint = document.createElement("div"); hint.id = "dwHomeHint"; hint.className = "dw-home-hint";
      hint.textContent = txt("Vid sjön väntar Ålmor. Ingen brådska – flyg vidare i din egen takt.",
        "Ålmor waits by the lake. No rush — explore at your own pace.");
      subtitle.insertAdjacentElement("afterend", hint);
    }
    const st = document.createElement("style"); st.id = "dwBossStyle";
    st.textContent = `
      #dipwingBplusMap{position:fixed;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;padding:calc(12px + env(safe-area-inset-top)) 12px calc(12px + env(safe-area-inset-bottom));background:rgba(10,16,35,.84);backdrop-filter:blur(8px);font-family:Nunito,system-ui,sans-serif;color:#1a1433}
      #dipwingBplusMap[hidden]{display:none!important}.dw-map-card{width:min(660px,100%);max-height:100%;overflow:auto;background:linear-gradient(160deg,#fff8e9,#e8f6ed);border:3px solid #1a1433;border-radius:22px;padding:16px;box-shadow:0 10px 0 #1a1433,0 24px 60px #0008}
      .dw-map-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.dw-eyebrow{font-size:10px;letter-spacing:2px;font-weight:1000;color:#497a68}.dw-map-head h2{margin:2px 0 0;font-size:28px;line-height:1.05}.dw-close{width:46px;height:46px;border:2px solid #1a1433;border-radius:14px;background:#fff;font-size:28px;font-weight:900;color:#1a1433}
      .dw-intro{font-size:13px;line-height:1.45;margin:10px 0 14px;color:#4d5b50}.dw-section-title{font-size:13px;font-weight:1000;letter-spacing:.5px;margin:10px 0 8px}.dw-route{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
      .dw-node{min-height:62px;border:2px solid #1a1433;border-radius:14px;background:#fff;padding:7px 5px;color:#1a1433;font:900 12px/1.2 Nunito,system-ui,sans-serif;box-shadow:0 3px 0 #1a1433;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer}
      .dw-node small{font-size:10px;font-weight:700;color:#63766a}.dw-node:disabled{opacity:.55;cursor:not-allowed;box-shadow:none}.dw-node.boss{background:linear-gradient(140deg,#d0f2ed,#fff1bf);min-height:74px}.dw-node.done{background:#d9f2d9}.dw-node.locked{background:#eee8de}
      .dw-route-line{text-align:center;color:#56816c;font-size:16px;font-weight:1000;margin:5px 0}.dw-boss-row{display:flex;align-items:center;gap:8px;margin-top:10px;padding:10px;border:2px dashed #498e84;border-radius:14px;background:#f4fffa}.dw-boss-copy{flex:1;min-width:0}.dw-boss-copy b{display:block;font-size:15px}.dw-boss-copy small{display:block;font-size:11px;line-height:1.35;color:#4c665d;margin-top:3px}.dw-boss-button{min-width:112px;min-height:48px;border:2px solid #1a1433;border-radius:12px;background:#1a706b;color:#fff;font:900 12px Nunito,system-ui,sans-serif;padding:8px}
      .dw-challenges{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}.dw-challenge{border:1px solid #9cae9f;border-radius:12px;background:#eff0e8;padding:9px;font-size:11px;font-weight:900;color:#5b675e;text-align:center}.dw-world-list{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:12px 0}.dw-world{background:#ffffffa8;border:1px solid #bdc9ba;border-radius:11px;padding:8px;font-size:11px}.dw-world b{display:block;font-size:12px}.dw-world small{display:block;color:#617568;margin-top:3px}.dw-legacy{margin-top:12px;border-top:1px solid #bcc8bb;padding-top:10px;font-size:12px}.dw-legacy summary{font-weight:1000;cursor:pointer;min-height:44px;display:flex;align-items:center}.dw-legacy p{color:#617568;font-size:11px}.dw-id-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.dw-id-grid .dw-node{min-height:46px;font-size:10px}.dw-map-foot{display:flex;justify-content:flex-end;margin-top:14px}.dw-primary{min-height:46px;border:2px solid #1a1433;border-radius:13px;background:#e1e9da;color:#1a1433;font:900 13px Nunito,system-ui,sans-serif;padding:8px 16px}
      .dw-home-hint{max-width:360px;margin:5px auto 0;text-align:center;font-size:11px;line-height:1.3;font-weight:800;color:#52816d}.dw-home-map{margin:0 0 5px;min-height:44px}
      #dwBossExit{position:absolute;z-index:100;width:auto;max-width:none;padding:0 12px;white-space:nowrap;/* 7a: "← Karta" was clipped */ top:calc(10px + env(safe-area-inset-top));right:calc(10px + env(safe-area-inset-right));min-width:46px;min-height:46px;border:2px solid #1a1433;border-radius:13px;background:#fff8e9;color:#1a1433;font:900 12px Nunito,system-ui,sans-serif;box-shadow:0 3px 0 #1a1433}
      #dwBossResult{position:fixed;inset:0;z-index:110;display:flex;align-items:center;justify-content:center;padding:20px;background:#07192bcc}.dw-result-card{width:min(420px,100%);padding:24px;border:3px solid #1a1433;border-radius:22px;background:linear-gradient(150deg,#fff8e9,#d8f4eb);text-align:center;box-shadow:0 8px 0 #1a1433}.dw-result-card h2{font-size:29px;margin:0 0 8px}.dw-result-card p{font-size:13px;line-height:1.45}.dw-result-card button{min-height:48px;width:100%;margin-top:8px;border:2px solid #1a1433;border-radius:12px;background:#1a706b;color:white;font:900 13px Nunito,system-ui,sans-serif}
      @media(max-width:370px){.dw-map-card{padding:12px}.dw-map-head h2{font-size:24px}.dw-route{gap:6px}.dw-node{font-size:11px;min-height:58px}.dw-world-list{grid-template-columns:1fr}.dw-id-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.dw-boss-button{min-width:96px}}
    `;
    document.head.appendChild(st);
    this.ensureModal();
    this.exitButton = document.getElementById("dwBossExit");
    if (!this.exitButton) {
      const b = document.createElement("button"); b.id = "dwBossExit"; b.type = "button"; b.textContent = txt("← Karta", "← Map"); b.hidden = true;
      b.addEventListener("click", () => this.leave()); document.getElementById("stage").appendChild(b); this.exitButton = b;
    }
    this.renderMap();
  },
  refreshTexts() {
    // 7a (REVIEW_7 B15): every new text follows the current language, also texts created before the language was set.
    const set = (sel, sv, en, attr) => { const el = typeof sel === "string" ? document.querySelector(sel) : sel; if (!el) return; if (attr) el.setAttribute(attr, txt(sv, en)); else el.textContent = txt(sv, en); };
    set("#dwMapButton", "🗺️ Världskarta 1.0", "🗺️ World map 1.0");
    set("#dwHomeHint", "Vid sjön väntar Ålmor. Ingen brådska – flyg vidare i din egen takt.", "Ålmor waits by the lake. No rush — explore at your own pace.");
    set("#dwBossExit", "← Karta", "← Map");
    if (this.mapModal) {
      set(this.mapModal.querySelector("#dwMapTitle"), "Världskarta", "World map");
      set(this.mapModal.querySelector(".dw-close"), "Stäng", "Close", "aria-label");
      set(this.mapModal.querySelector(".dw-legacy summary"), "Visa alla stabila ban-ID:n · äldre banor", "Show all stable level IDs · legacy flights");
      set(this.mapModal.querySelector(".dw-back"), "← Till spelet", "← Back to the game");
    }
  },
  renderMap() {
    const modal = this.ensureModal(); this.refreshTexts();
    syncStableRecords();
    const w1Complete = w1NormalComplete(), beaten = bossComplete(), complete = w1Complete && beaten;
    const intro = modal.querySelector("#dwMapIntro");
    intro.textContent = txt("Klara de sex vanliga banorna för att öppna nästa värld. Ålmor är en separat slutnod – bossen blockerar aldrig W2.",
      "Clear the six regular flights to open the next world. Ålmor is a separate final node — the boss never blocks W2.");
    const track = modal.querySelector("#dwMapW1"); track.innerHTML = "";
    const heading = document.createElement("div"); heading.className = "dw-section-title";
    heading.textContent = txt("W1 · GRÖNA DALEN", "W1 · GREEN VALLEY") + (complete ? "  👑" : ""); track.appendChild(heading);
    const route = document.createElement("div"); route.className = "dw-route";
    for (let n = 1; n <= 6; n++) {
      const id = `w1-l${n}`, entry = Data.LEVELS[id], done = isLevelDone(id), unlocked = isIDUnlocked(id);
      const b = document.createElement("button"); b.type = "button"; b.className = "dw-node" + (done ? " done" : "") + (!unlocked ? " locked" : "");
      b.disabled = !unlocked; b.setAttribute("data-dw-level", id);
      const label = entry.signature ? txt("Signatur · Vattenfallet", "Signature · Waterfall") : txt("Äldre bana L" + entry.legacyLevel, "Legacy flight L" + entry.legacyLevel);
      b.innerHTML = `<b>${id}</b><small>${done ? txt("Avklarad", "Cleared") : unlocked ? label : txt("Låst", "Locked")}</small>`;
      route.appendChild(b);
    }
    track.appendChild(route);
    const boss = document.createElement("div"); boss.className = "dw-boss-row";
    const copy = document.createElement("div"); copy.className = "dw-boss-copy";
    const bossTitle = document.createElement("b"); bossTitle.textContent = "🐉 Ålmor · " + txt("Tidvattenväktaren", "Tidekeeper");
    const bossSub = document.createElement("small"); bossSub.textContent = beaten ? txt("Trofén finns i museet. Master Crown: ", "Trophy added to the museum. Master Crown: ") + (readBossSave().masterCrown ? "✓" : "—") :
      txt(w1Complete ? "Alla sex banor klara. Bossnoden är öppen när du vill." : "Klara fem äldre banor och signaturbanan Vattenfallet. Ingen nedräkning.",
        w1Complete ? "All six flights cleared. The boss node is open whenever you choose." : "Clear the five legacy flights and the Waterfall signature flight. No countdown.");
    copy.append(bossTitle, bossSub);
    const play = document.createElement("button"); play.type = "button"; play.className = "dw-boss-button"; play.setAttribute("data-dw-boss", "1");
    play.disabled = !w1Complete || beaten;
    play.textContent = beaten ? txt("Besegrad ✓", "Defeated ✓") : w1Complete ? txt("Möt Ålmor", "Face Ålmor") : txt("🔒 Ålmor", "🔒 Ålmor");
    boss.append(copy, play); track.appendChild(boss);
    const challenge = modal.querySelector("#dwChallenges"); challenge.innerHTML = "";
    for (const label of [txt("W1 ◆ · Utmaningar", "W1 ◆ · Challenges"), txt("Hardcore-expedition", "Hardcore Expedition")]) {
      const d = document.createElement("div"); d.className = "dw-challenge";
      d.textContent = beaten ? label + " · " + txt("Kommer snart", "Coming soon") : label + " · " + txt("Besegra Ålmor", "Defeat Ålmor"); challenge.appendChild(d);
    }
    const worlds = modal.querySelector("#dwWorldList"); worlds.innerHTML = "";
    for (let w = 2; w <= 8; w++) {
      const first = (w - 1) * 5 + 1;
      const available = worldUnlocked(w) && (Number(Bridge.store.unlocked) || 1) >= first;
      const d = document.createElement("div"); d.className = "dw-world";
      const b = document.createElement("b"); b.textContent = `W${w} · ${txt(WORLD_LABELS_SV[w - 1], WORLD_LABELS[w - 1])}`;
      const sm = document.createElement("small"); sm.textContent = available
        ? txt("Äldre banor finns kvar · ny signaturbana kommer snart", "Legacy flights remain playable · new signature flight coming soon")
        : txt("Kommer snart", "Coming soon");
      d.append(b, sm); worlds.appendChild(d);
    }
    const all = modal.querySelector("#dwAllIds"); all.innerHTML = "";
    const idGrid = document.createElement("div"); idGrid.className = "dw-id-grid";
    for (const [id, entry] of Object.entries(Data.LEVELS)) {
      const n = entry.legacyLevel, unlocked = isIDUnlocked(id);
      const b = document.createElement("button"); b.type = "button"; b.className = "dw-node" + (!unlocked ? " locked" : "");
      b.disabled = !unlocked; b.setAttribute("data-dw-level", id);
      const rec = idSave.records && idSave.records[id] && idSave.records[id].classic;
      const desc = entry.signature ? txt("Signaturbana · Vattenfallet", "Signature flight · Waterfall") : n == null ? txt("Kommer snart", "Coming soon") : (rec && rec.cleared ? txt("Avklarad", "Cleared") : `Legacy L${n}`);
      b.innerHTML = `<b>${id}</b><small>${desc}</small>`;
      idGrid.appendChild(b);
    }
    all.appendChild(idGrid);
    const note = modal.querySelector(".dw-legacy p");
    note.textContent = txt("Äldre banor som fortfarande finns i spelet behåller sin spelbarhet, sina rekord och medaljer via dessa ID:n. Nya signaturbanor visas som Kommer snart.",
      "Existing flights remain playable with their records and medals mapped to these IDs. New signature flights are marked Coming soon.");
  },
  validateAll(seed) {
    // 7a (REVIEW_7 B1): the runtime validates the boss script in its native data format before the fight starts.
    const errors = [];
    for (let ph = 1; ph <= 3; ph++) for (const mercy of [false, true]) {
      for (const e of Data.validateTimeline(Data.makeTimeline(ph, seed, mercy), Sim)) errors.push(`fas ${ph}${mercy ? " (lugnt)" : ""}: ${e}`);
      for (const e of Data.validateWeakPoints(ph, Data.makeTimeline(ph, seed, mercy))) errors.push(`fas ${ph}${mercy ? " (lugnt)" : ""}: ${e}`);
    }
    return errors;
  },
  start(seed, forcePreview) {
    if ((!forcePreview && !w1NormalComplete()) || this.active) return false;
    const vSeed = Number.isFinite(seed) ? (seed >>> 0) : null;
    this.seed = vSeed != null ? vSeed : (((Date.now() >>> 0) ^ ((readBossSave().attempts || 0) * 2654435761)) >>> 0);
    const errors = this.validateAll(this.seed);
    this.lastValidation = errors;
    if (errors.length) {
      try { console.warn("[Ålmor] boss script rejected:", errors); } catch (e) {}
      const intro = this.ensureModal().querySelector("#dwMapIntro");
      if (intro) intro.textContent = txt("Ålmor vilar just nu – bossens manus klarade inte säkerhetskontrollen.", "Ålmor is resting – the boss script failed its safety check.");
      this.ensureModal().hidden = false;
      return false;
    }
    this.phase = 1; this.deaths = [0, 0, 0]; this.mercy = false; this.finished = false; this.won = false;
    this.collected = []; this.secretSequenceIndex = 0; this.h2Hook = false;
    this.startPhase(false);
    this.active = true; window.DipwingBossActive = true;
    Bridge.beginBoss();
    this.syncBird();
    window.DipwingBossView = this.makeView();
    if (this.exitButton) this.exitButton.hidden = false;
    this.closeMap();
    return true;
  },
  startPhase(checkpoint) {
    this.acc = 0; this.phaseT = 0; this.breakT = 0;
    this.sim = Sim.createBossState((this.seed ^ (this.phase * 0x45d9f3b)) >>> 0, this.phase,
      { x: 480 * 0.32, y: 330, floorY: 708 });
    this.attacks = Data.makeTimeline(this.phase, this.seed, this.mercy);
    this.rings = Data.makeWeakPoints(this.phase);
    this.warningPlayed = new Set();
    this.checkpointNotice = checkpoint ? txt("Checkpoint: fas ", "Checkpoint: phase ") + this.phase : "";
    this.checkpointT = checkpoint ? 1.5 : 0;
    this.phaseEnd = Math.max(Data.ALMOR.phases[this.phase - 1].duration,
      ...this.attacks.map(a => a.impactAt + a.duration + 0.55));
    this.phaseEnd = Math.min(18, this.phaseEnd);
  },
  activeHazards(t) {
    const out = [];
    let tide = false;
    for (const a of this.attacks) {
      if (a.kind === "tide" && t >= a.impactAt) tide = true;
      if (a.kind !== "tide" && t >= a.impactAt && t <= a.impactAt + a.duration) {
        out.push({ id: a.id, kind: "rect", x0: a.rect.x0, x1: a.rect.x1, y0: a.rect.y0, y1: a.rect.y1 });
      }
    }
    if (tide) out.push({ id: "rising-tide", kind: "rect", x0: 0, x1: 480, y0: 600, y1: 720 });
    this.sim.floorY = tide ? 600 : 708;
    return out;
  },
  update(dt) {
    if (!this.active || this.finished) return;
    const S = Bridge.S;
    const d = Math.max(0, Math.min(0.05, Number(dt) || 0));
    S.time += d;
    if (this.checkpointT > 0) this.checkpointT = Math.max(0, this.checkpointT - d);
    if (this.breakT > 0) {
      this.breakT = Math.max(0, this.breakT - d);
      if (this.breakT === 0) { this.phase++; if (this.phase > 3) this.win(); else this.startPhase(false); }
      return;
    }
    this.acc = Math.min(this.acc + d, Sim.PHYS.STEP * Sim.PHYS.MAX_STEPS);
    let n = 0;
    while (this.acc >= Sim.PHYS.STEP && n < Sim.PHYS.MAX_STEPS && !this.finished) {
      this.acc -= Sim.PHYS.STEP; n++;
      const t = this.sim.t;
      for (const a of this.attacks) {
        if (!this.warningPlayed.has(a.id) && t >= a.impactAt - a.warning) {
          this.warningPlayed.add(a.id); try { if (window.AudioFX) AudioFX.play("bossAttack"); } catch (e) {}
        }
        if (t >= a.impactAt && t <= a.impactAt + a.duration && !a._played) {
          a._played = true; try { if (window.AudioFX) AudioFX.play("bossProjectile"); } catch (e) {}
        }
      }
      const hazards = this.activeHazards(t);
      const result = Sim.bossStep(this.sim, Sim.PHYS.STEP, hazards);
      this.phaseT = this.sim.t;
      this.collectWeakPoints(this.phaseT);
      this.syncBird();
      if (result.hit) { this.onDeath(); break; }
      if (this.phaseT >= this.phaseEnd) { this.breakT = Data.ALMOR.rules.phaseBreak; try { AudioFX.play("bossHit"); } catch (e) {} break; }
    }
    window.DipwingBossView = this.makeView();
  },
  syncBird() {
    const S = Bridge.S, b = this.sim.bird;
    S.bird.x = b.x; S.bird.y = b.y; S.bird.vy = b.vy;
    S.bird.wing = b.wing; S.bird.rot = clamp(b.vy / 700, -0.45, 1.35);
    S.bird.flapAt = S.time; S.bird.alive = true;
    S.ptime = this.sim.t; S.score = this.collected.length;
  },
  flap() {
    if (!this.active || this.finished || this.breakT > 0) return;
    Sim.bossFlap(this.sim); try { AudioFX.flap(); } catch (e) {}
    const S = Bridge.S; S.bird.flapAt = S.time;
  },
  collectWeakPoints(t) {
    for (const ring of this.rings) {
      if (ring.collected || ring.missed || t < ring.bornAt) continue;
      const f = clamp((t - ring.bornAt) / Data.ALMOR.weakPoints.travelDuration, 0, 1);
      const x = ring.x0 + (ring.x1 - ring.x0) * f;
      if (t > ring.expireAt) { ring.missed = true; continue; }
      const b = this.sim.bird, dx = b.x - x, dy = b.y - ring.y;
      if (dx * dx + dy * dy <= 26 * 26) {
        ring.collected = true; this.collected.push({ phase: this.phase, order: ring.order, at: t });
        try { AudioFX.play("bossHit"); } catch (e) {}
        if (this.phase === 3) {
          const expected = Data.ALMOR.weakPoints.phase3Sequence;
          if (ring.order === expected[this.secretSequenceIndex]) this.secretSequenceIndex++;
          else this.secretSequenceIndex = ring.order === expected[0] ? 1 : 0;
          if (this.secretSequenceIndex >= expected.length) this.h2Hook = true;
        }
      }
    }
  },
  onDeath() {
    const idx = this.phase - 1; this.deaths[idx]++;
    try { AudioFX.play("bossHit"); } catch (e) {}
    const checkpoint = Data.checkpointAfterDeath(this.phase, this.deaths[idx]);
    this.mercy = checkpoint.mercy;
    this.startPhase(true); // same phase checkpoint; no continue screen, no countdown
    this.syncBird();
    window.DipwingBossView = this.makeView();
  },
  win() {
    this.finished = true; this.won = true; this.phase = 3;
    const flawless = !this.mercy && this.deaths.every(n => n === 0);
    const prev = readBossSave();
    const save = Object.assign({}, prev, {
      version: 1, beaten: true, trophy: true, museumItem: "almor-pearl-shell", pearlTrail: true,
      masterCrown: !!prev.masterCrown || flawless, flawless: !!prev.flawless || flawless,
      h2SecretHook: !!prev.h2SecretHook || (!!this.h2Hook && !this.mercy),
      attempts: (Number(prev.attempts) || 0) + 1, lastMercy: this.mercy,
      lastDeaths: this.deaths.slice(), completedAt: new Date().toISOString()
    });
    writeBossSave(save);
    idSave.boss = save; safeSet(STORE_KEY, JSON.stringify(idSave));
    try { AudioFX.setBossMode(false); AudioFX.play("bossDefeat"); } catch (e) {}
    this.checkpointNotice = txt("Ålmor är besegrad!", "Ålmor is defeated!"); this.checkpointT = 99;
    window.DipwingBossView = this.makeView();
    this.showResult(save);
  },
  showResult(save) {
    let el = document.getElementById("dwBossResult"); if (!el) {
      el = document.createElement("div"); el.id = "dwBossResult"; document.body.appendChild(el);
    }
    el.innerHTML = `<div class="dw-result-card" role="dialog" aria-modal="true"><div style="font-size:38px">🏆</div><h2>${txt("Tidvattenvän", "Friend of the Tide")}</h2>
      <p>${txt("Ålmor har lugnat sjön. En trofé och ett museiföremål har lagts till.", "Ålmor has calmed the lake. A trophy and museum item have been added.")}</p>
      <p>${save.masterCrown ? txt("👑 Master Crown + pärlspår upplåst.", "👑 Master Crown + pearl trail unlocked.") : txt("Pärlspår upplåst. Master Crown kräver en seger utan nådshjälp eller dödsfall.", "Pearl trail unlocked. Master Crown requires a flawless win without mercy assistance.")}</p>
      <p>${save.h2SecretHook ? txt("Ett särskilt ljusmönster har registrerats.", "A special light sequence has been recorded.") : txt("Museet har en anteckning om ett ännu olöst ljusmönster.", "The museum notes an unresolved light sequence.")}</p>
      <button type="button" id="dwResultMap">${txt("Till världskartan", "Back to world map")}</button><button type="button" id="dwResultRetry">${txt("Flyg Ålmor igen", "Fight Ålmor again")}</button></div>`;
    el.hidden = false;
    document.getElementById("dwResultMap").onclick = () => { el.hidden = true; this.leave(); this.openMap(); };
    document.getElementById("dwResultRetry").onclick = () => { el.hidden = true; this.active = false; window.DipwingBossActive = false;
      try { AudioFX.setBossMode(false); } catch (e) {} if (this.exitButton) this.exitButton.hidden = true; Bridge.endBoss(); this.start(); };
  },
  leave() {
    if (!this.active) { this.openMap(); return; }
    this.active = false; this.finished = false; window.DipwingBossActive = false;
    window.DipwingBossView = { active: false, phase: this.phase, t: 0, hazards: [], tide: false };
    const result = document.getElementById("dwBossResult"); if (result) result.hidden = true;
    if (this.exitButton) this.exitButton.hidden = true;
    try { AudioFX.setBossMode(false); } catch (e) {}
    Bridge.endBoss(); this.openMap();
  },
  makeView() {
    const t = this.sim ? this.sim.t : 0;
    const tide = this.attacks.some(a => a.kind === "tide" && t >= a.impactAt);
    const reduced = Bridge.reducedMotion();
    // Ålmor takes a visible breath just before the warning begins; reduced motion freezes the body only.
    const next = this.attacks.filter(a => a.impactAt > t).sort((a, b) => a.impactAt - b.impactAt)[0];
    let inhale = 0;
    if (!reduced && next) {
      const start = next.impactAt - next.warning - 0.55, end = next.impactAt - next.warning;
      if (t >= start && t < end) inhale = Math.sin(clamp((t - start) / Math.max(0.001, end - start), 0, 1) * Math.PI / 2);
    }
    // Attacks visibly travel from the depth layer toward the game plane at the specified 190 px/s.
    // They become lethal only at impactAt in activeHazards(), never while still in depth.
    const visible = this.attacks.filter(a => t >= a.impactAt - a.warning && t <= a.impactAt + a.duration)
      .map(a => ({ id: a.id, kind: a.kind, rect: a.rect, shape: a.shape, lane: a.lane,
        progress: clamp((t - (a.impactAt - a.warning)) / Math.max(0.001, a.warning), 0, 1),
        depthDistance: Data.ALMOR.rules.scrollSpeed * a.warning, lethal: t >= a.impactAt }));
    return { active: this.active, phase: this.phase, t: reduced ? 0 : t, inhale,
      phaseT: t, scrollSpeed: Data.ALMOR.rules.scrollSpeed, tide, hazards: visible, bodyStyle: "segmented-lagoon-eel" };
  },
  drawFallbackEel(ctx, t) {
    // Decorative 2D fallback only; the 3D build normally uses Render3D's depth group.
    const rm = Bridge.reducedMotion(); if (rm) t = 0;
    ctx.save(); ctx.globalAlpha = 0.72; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const y = 260 + Math.sin(t * 0.72) * 12;
    ctx.beginPath(); ctx.moveTo(210, y);
    ctx.bezierCurveTo(280, y - 96, 330, y + 84, 412, y - 8);
    ctx.strokeStyle = "#226a69"; ctx.lineWidth = 34; ctx.stroke();
    ctx.strokeStyle = "#7ed3c2"; ctx.lineWidth = 25; ctx.stroke();
    ctx.strokeStyle = "#c3f4dc"; ctx.lineWidth = 7; ctx.stroke();
    ctx.fillStyle = "#7ed3c2"; ctx.strokeStyle = "#226a69"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(208, y, 35, 27, -0.18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(220, y - 8, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#17243a"; ctx.beginPath(); ctx.arc(222, y - 8, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },
  renderOverlay() {
    if (!this.active) return;
    const B = Bridge, S = B.S, ctx = B.ctx;
    ctx.save();
    ctx.setTransform(S.scale, 0, 0, S.scale, 0, 0);
    ctx.translate(S.offX || 0, -(S.camY || 0));
    const rm = B.reducedMotion(), t = this.sim.t;
    // Reduced motion freezes decorative body movement, never gameplay warnings, hazards or weak points.
    if (!window.__R3D || !window.__R3D.active) this.drawFallbackEel(ctx, t);
    // Stable HUD, no colour-only cues: phase count, text labels and patterned warning contours.
    ctx.fillStyle = "rgba(13,31,48,.82)"; ctx.strokeStyle = "#d7f1df"; ctx.lineWidth = 2;
    roundRect(ctx, 14, 16, 250, 61, 13); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#f5fff2"; ctx.font = "900 15px Nunito,system-ui,sans-serif";
    ctx.fillText("ÅLMOR · " + txt("TIDVATTENVÄKTAREN", "TIDEKEEPER"), 27, 40);
    ctx.font = "800 11px Nunito,system-ui,sans-serif"; ctx.fillStyle = "#b9e5d3";
    ctx.fillText(txt("FAS", "PHASE") + " " + this.phase + "/3  ·  " + txt(Data.ALMOR.phases[this.phase - 1].title, Data.ALMOR.phases[this.phase - 1].titleEn), 27, 62);
    const phaseCollected = this.collected.filter(x => x.phase === this.phase).length;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.arc(222 + i * 15, 55, 5, 0, Math.PI * 2);
      ctx.fillStyle = i < phaseCollected ? "#ffd76a" : "rgba(255,255,255,.22)"; ctx.fill();
      ctx.strokeStyle = "#fff2bd"; ctx.stroke();
    }
    if (this.mercy) {
      ctx.fillStyle = "#fff0c4"; roundRect(ctx, 276, 20, 110, 27, 9); ctx.fill();
      ctx.fillStyle = "#653d24"; ctx.font = "900 10px Nunito,system-ui,sans-serif"; ctx.fillText(txt("NÅDHJÄLP", "MERCY MODE"), 287, 38);
    }
    // Weak points stay on the gameplay plane; their gold ring is always distinct from hazard contours.
    for (const r of this.rings) {
      if (r.collected || r.missed || t < r.bornAt || t > r.expireAt) continue;
      const f = clamp((t - r.bornAt) / Data.ALMOR.weakPoints.travelDuration, 0, 1);
      const x = r.x0 + (r.x1 - r.x0) * f, y = r.y;
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = "#513a12"; ctx.lineWidth = 9; ctx.strokeRect(-12, -12, 24, 24);
      ctx.strokeStyle = "#ffd65a"; ctx.lineWidth = 5; ctx.strokeRect(-12, -12, 24, 24);
      ctx.fillStyle = "#fff7d6"; ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    // Full warning contour, visible for the complete telegraph interval. Each family has a distinct pattern and glyph.
    for (const a of this.attacks) {
      const warnStart = a.impactAt - a.warning;
      if (t < warnStart || t > a.impactAt + a.duration) continue;
      const warning = t < a.impactAt;
      const r = a.rect;
      ctx.save(); ctx.lineWidth = warning ? 3 : 4;
      ctx.strokeStyle = a.kind === "tide" ? "#79e6f0" : a.kind === "fish" ? "#ffe69c" : a.kind === "sweep" ? "#ffbd73" : "#a4e6ff";
      ctx.setLineDash(a.kind === "fish" ? [3, 5] : a.kind === "sweep" ? [10, 5] : [6, 4]);
      ctx.strokeRect(r.x0 + 2, r.y0 + 2, r.x1 - r.x0 - 4, r.y1 - r.y0 - 4);
      ctx.setLineDash([]);
      if (a.kind === "pillar") {
        for (let x = r.x0 + 8; x < r.x1 - 2; x += 12) { ctx.beginPath(); ctx.moveTo(x, r.y0 + 8); ctx.lineTo(x, r.y1 - 8); ctx.stroke(); }
      } else if (a.kind === "fish") {
        const cy = a.lane === "dive" ? r.y1 - 37 : Math.min((r.y0 + r.y1) / 2, r.y0 + 37); // 7a: chevron marks the arc tip of the leap/dive ctx.beginPath(); ctx.moveTo(r.x0 + 16, cy); ctx.lineTo(r.x0 + 30, cy - 12); ctx.lineTo(r.x1 - 22, cy); ctx.lineTo(r.x0 + 30, cy + 12); ctx.closePath(); ctx.stroke();
      } else if (a.kind === "sweep") {
        const cy = (r.y0 + r.y1) / 2; ctx.beginPath(); ctx.moveTo(35, cy); ctx.lineTo(445, cy); ctx.moveTo(35, cy); ctx.lineTo(48, cy - 10); ctx.moveTo(35, cy); ctx.lineTo(48, cy + 10); ctx.moveTo(445, cy); ctx.lineTo(432, cy - 10); ctx.moveTo(445, cy); ctx.lineTo(432, cy + 10); ctx.stroke();
      } else if (a.kind === "tide") {
        ctx.beginPath(); for (let x = 0; x <= 480; x += 12) { const y = r.y0 + 8 + Math.sin(x * 0.06) * 5; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
      }
      if (warning && t >= warnStart) {
        const left = Math.max(0.01, a.impactAt - t);
        const fromTop = a.lane === "cascade" || a.lane === "deep" || a.lane === "dive", ly = (fromTop || r.y0 < 100) ? r.y1 + 8 : r.y0 - 30; // 7a: label on the open side
        ctx.fillStyle = "rgba(13,31,48,.78)"; roundRect(ctx, clamp((r.x0 + r.x1) / 2 - 56, 8, 364), clamp(ly, 85, 680), 112, 23, 7); ctx.fill();
        ctx.fillStyle = "#fff7dc"; ctx.font = "900 11px Nunito,system-ui,sans-serif";
        const label = a.kind === "pillar" ? (fromTop ? txt("KASKAD ▼", "CASCADE ▼") : txt("PELARE ▲", "PILLAR ▲")) : a.kind === "fish" ? (a.lane === "dive" ? txt("DYKFISK ▼", "DIVING FISH ▼") : txt("FLYGFISK ▲", "FLYING FISH ▲")) : a.kind === "sweep" ? txt("STJÄRTSVEP", "TAIL SWEEP") : txt("TIDVATTEN", "RISING TIDE");
        ctx.fillText(label + " · " + left.toFixed(1) + "s", clamp((r.x0 + r.x1) / 2 - 51, 13, 369), clamp(ly + 16, 102, 697));
      }
      ctx.restore();
    }
    if (this.breakT > 0) {
      ctx.fillStyle = "rgba(11,30,46,.86)"; roundRect(ctx, 90, 345, 300, 92, 18); ctx.fill();
      ctx.fillStyle = "#f9ffed"; ctx.textAlign = "center"; ctx.font = "900 21px Nunito,system-ui,sans-serif";
      ctx.fillText(txt("Fas ", "Phase ") + this.phase + txt(" klarad", " cleared"), 240, 383);
      ctx.font = "700 12px Nunito,system-ui,sans-serif"; ctx.fillText(txt("Ålmor samlar kraft · 1,8 s", "Ålmor gathers strength · 1.8 s"), 240, 411);
      ctx.textAlign = "left";
    }
    if (this.checkpointT > 0) {
      ctx.fillStyle = "rgba(11,30,46,.85)"; roundRect(ctx, 125, 95, 230, 34, 10); ctx.fill();
      ctx.fillStyle = "#fff1c7"; ctx.font = "900 14px Nunito,system-ui,sans-serif"; ctx.textAlign = "center"; ctx.fillText(this.checkpointNotice, 240, 117); ctx.textAlign = "left";
    }
    ctx.restore();
  }
};
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function renderMap() { Boss.renderMap(); }
Boss.installUI();
Boss.refreshTexts();
try { new MutationObserver(() => { Boss.refreshTexts(); if (Boss.mapModal && !Boss.mapModal.hidden) Boss.renderMap(); })
  .observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] }); } catch (e) {}
window.DipwingBoss = Boss;
window.DipwingBossView = { active: false, phase: 1, t: 0, hazards: [], tide: false };
// Local unpublished preview switch for visual review; no URL or server dependency.
try { if (new URLSearchParams(location.search).get("boss-preview") === "1" && window.GAME_BUILD && GAME_BUILD.testHooks === true) { // 7a (B18): test builds only
  setTimeout(() => { Boss.start(20261123, true); }, 500);
} } catch (e) {}
})();
