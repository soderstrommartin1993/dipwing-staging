/* First-paint language + 3D loader. External file so staging CSP (script-src 'self') can run it.
   A 3D build may bake data-enabled="1" on #dipwingLoading; this script also enables the
   overlay for ?render=3d or localStorage pfb_render=3d. */
(function () {
  var loader = document.getElementById("dipwingLoading");
  var showLoader = !!(loader && loader.getAttribute("data-enabled") === "1");
  try {
    showLoader = showLoader
      || new URLSearchParams(location.search).get("render") === "3d"
      || localStorage.getItem("pfb_render") === "3d";
  } catch (e) {}
  if (loader && showLoader) loader.setAttribute("data-enabled", "1");
  else if (loader) { loader.hidden = true; if (loader.parentNode) loader.parentNode.removeChild(loader); }
  var lang = "";
  try {
    var raw = localStorage.getItem("pfb_save_v2");
    if (raw) { var save = JSON.parse(raw); if (save && (save.lang === "sv" || save.lang === "en")) lang = save.lang; }
  } catch (e) {}
  if (!lang) {
    try { lang = /^sv/i.test((navigator.languages && navigator.languages[0]) || navigator.language || "") ? "sv" : "en"; }
    catch (e) { lang = "sv"; }
  }
  document.documentElement.lang = lang;
  var label = document.getElementById("dipwingLoadingText");
  if (label) label.textContent = lang === "en" ? "Loading…" : "Laddar…";
  window.__dipwingInitialLanguage = lang;
})();
