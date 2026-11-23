/* Independent opt-in feature flags. Every flag is OFF unless explicitly enabled. */
(function(){"use strict";
  function enabled(name, storageKey){
    try {
      var q=new URLSearchParams(location.search).get(name);
      if(q==="1") return true;
      if(q==="0") return false;
      return !!(window.SafeStorage ? SafeStorage.get(storageKey)==="1" : localStorage.getItem(storageKey)==="1");
    } catch(e){ return false; }
  }
  window.DipwingFlags=Object.freeze({v2final:enabled("v2final","pfb_v2final")});
})();
