/* Local, cosmetic-only ★ progression. No currency, XP, ads, purchases or physics hooks. */
(function(){"use strict";
  var KEY="pfb_world_stars_v1";
  function read(){try{var v=JSON.parse(localStorage.getItem(KEY)||"{}");return v&&typeof v==="object"?v:{};}catch(e){return {};}}
  function write(v){try{localStorage.setItem(KEY,JSON.stringify(v));return true;}catch(e){return false;}}
  function world(v,id){v[id]=v[id]&&typeof v[id]==="object"?v[id]:{tier:1,levels:{},boss:{}};v[id].levels=v[id].levels||{};v[id].boss=v[id].boss||{};return v[id];}
  function tierUnlocked(v,id,t){var w=v[id];if(t===1)return true;if(!w)return false;return t===2?!!w.complete:t===3?!!w.star2:false;}
  function recordLevel(worldId,levelId,tier){var v=read(),w=world(v,worldId),t=Math.max(1,Math.min(3,Number(tier)||1));if(!tierUnlocked(v,worldId,t))return false;w.levels[levelId]=w.levels[levelId]||{};w.levels[levelId][t]=true;return write(v);}
  function recordBoss(worldId,tier){var v=read(),w=world(v,worldId),t=Math.max(1,Math.min(3,Number(tier)||1));if(!tierUnlocked(v,worldId,t))return false;w.boss[t]=true;return write(v);}
  function completeWorld(worldId,levelIds){var v=read(),w=world(v,worldId),changed=false;[1,2,3].forEach(function(t){var done=levelIds.every(function(id){return !!(w.levels[id]&&w.levels[id][t]);})&&!!w.boss[t];if(done&&!w.tierComplete){w.tierComplete={};}if(done&&!w.tierComplete[t]){w.tierComplete[t]=true;changed=true;}});if(w.tierComplete&&w.tierComplete[1])w.complete=true;if(w.tierComplete&&w.tierComplete[2])w.star2=true;if(w.tierComplete&&w.tierComplete[3])w.star3=true;if(changed)write(v);return changed;}
  function unlockStar2(worldId){var v=read(),w=v[worldId];if(!w||!w.complete)return false;w.star2=true;return write(v);}
  function unlockStar3(worldId){var v=read(),w=v[worldId];if(!w||!w.star2)return false;w.star3=true;return write(v);}
  function canSelect(worldId,tier){return tierUnlocked(read(),worldId,Math.max(1,Math.min(3,Number(tier)||1)));}
  function select(worldId,tier){if(!canSelect(worldId,tier))return false;var v=read(),w=world(v,worldId);w.tier=Math.max(1,Math.min(3,Number(tier)||1));return write(v);}
  function get(worldId){var v=read(),w=v[worldId]||{};return {tier:Math.max(1,Math.min(3,Number(w.tier)||1)),complete:!!w.complete,star2:!!w.star2,star3:!!w.star3,levels:w.levels||{},boss:w.boss||{}};}
  window.DipwingStars=Object.freeze({key:KEY,recordLevel:recordLevel,recordBoss:recordBoss,completeWorld:completeWorld,unlockStar2:unlockStar2,unlockStar3:unlockStar3,canSelect:canSelect,select:select,get:get});
})();
