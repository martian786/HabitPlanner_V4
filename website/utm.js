// /utm.js
(function () {
  const KEYS = ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","gclid","fbclid","ttclid"];
  const FIRST_KEY = "hb_utm_first";
  const LAST_KEY  = "hb_utm_last";

  function getParams() {
    const p = new URLSearchParams(location.search);
    const out = {};
    KEYS.forEach(k => { const v = p.get(k); if (v) out[k] = v; });
    return out;
  }
  function save(name, obj) { localStorage.setItem(name, JSON.stringify(obj)); }
  function load(name) { try { return JSON.parse(localStorage.getItem(name) || "{}"); } catch { return {}; } }

  // On every page load:
  const now = Date.now();
  const fromUrl = getParams();
  if (Object.keys(fromUrl).length) {
    const first = load(FIRST_KEY);
    if (!Object.keys(first).length) {
      fromUrl._ts = now;
      save(FIRST_KEY, fromUrl);        // first-touch UTMs
    }
    const last = {...fromUrl, _ts: now};
    save(LAST_KEY, last);               // last-touch UTMs
  }

  // Expose helpers
  window.HBUTM = {
    first: () => load(FIRST_KEY),
    last:  () => load(LAST_KEY),
    pick:  (prefer="first") => {
      const urlUTM = getParams();
      if (Object.keys(urlUTM).length) return urlUTM;
      const a = prefer === "last" ? load(LAST_KEY) : load(FIRST_KEY);
      return a || {};
    }
  };
})();
