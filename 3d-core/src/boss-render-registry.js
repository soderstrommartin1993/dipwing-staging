/* Data-driven boss presentation registry. No simulation or collision ownership. */
(function(){"use strict";
  var renderers=Object.create(null);
  window.DipwingBossRenderRegistry=Object.freeze({
    register:function(id,fn){if(typeof id!=="string"||!id||typeof fn!=="function")throw new TypeError("invalid boss renderer");renderers[id]=fn;},
    render:function(id,view,reducedMotion,scene){var fn=renderers[id];if(!fn)return false;fn(view,reducedMotion,scene);return true;},
    has:function(id){return typeof renderers[id]==="function";}
  });
})();
