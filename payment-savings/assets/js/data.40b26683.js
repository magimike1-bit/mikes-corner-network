/* data.js — catalog data loader.
 *
 * All simulator catalog data (prices, lifecycles, support plans, install
 * hours, training content, typical setups, network zones, FX rates) lives in
 * data/*.json. A price update is a one-line JSON edit — no logic touched.
 *
 * DATA_VERSIONS is filled by tools/build-assets.mjs with per-file content
 * hashes so browsers re-fetch only the data files that actually changed.
 */
const FILES = {
  fx: "fx.json",
  hardware: "hardware.json",
  lifecycle: "lifecycle.json",
  support: "support.json",
  install: "install.json",
  recTiers: "rec-tiers.json",
  training: "training.json",
  typical: "typical.json",
  manual: "manual.json",
  sim: "sim.json",
  network: "network.json",
};

// __DATA_VERSIONS__ (build rewrites this line)
const DATA_VERSIONS = {"benchmarks.json":"407dc674","fx.json":"17364eea","hardware.json":"2cae3605","install.json":"8d1e0f33","lifecycle.json":"21ca534f","manual.json":"5e431e4c","network.json":"7b3c69d9","rec-tiers.json":"113c24fe","sim.json":"32c73b5b","support.json":"9bc86229","surcharge-rules.json":"0dde07aa","training.json":"e181cba5","typical.json":"38ff6d8f"};

function dataUrl(file) {
  const v = DATA_VERSIONS[file];
  return new URL("data/" + file + (v ? "?v=" + v : ""), document.baseURI).toString();
}

export async function loadData() {
  const out = {};
  for (const [key, file] of Object.entries(FILES)) {
    const res = await fetch(dataUrl(file));
    if (!res.ok) throw new Error("simulator data failed to load: " + file + " (" + res.status + ")");
    out[key] = await res.json();
  }
  stampCatalog(out);
  return out;
}

/* Stamp every option/addon with its parent item id, then attach researched
   lifecycle fallback + support blocks. Runs once at load; renderers use _item.
   (Ported from the inline stampCatalog pass — data enrichment, not logic.) */
export function stampCatalog(D) {
  const hw = D.hardware, tiers = [];
  Object.values(hw.sectors).forEach(sec => { tiers.push.apply(tiers, sec.needs || []); tiers.push.apply(tiers, sec.toys || []); });
  tiers.push.apply(tiers, hw.infra || []);
  tiers.push.apply(tiers, hw.install || []);
  tiers.forEach(it => {
    (it.options || []).forEach(o => {
      o._item = it.id;
      if (D.support.byLabel[o.label]) o.support = D.support.byLabel[o.label];
      else if (!o.support && o.upfront && D.lifecycle[it.id] && !it.noSupport) o.support = D.support.plans.quote;
      if (o.installHrs == null) {
        const IH = D.install.byLabel[o.label] || D.install.hours[it.id];
        if (IH) { o.installHrs = IH.h; o.installVar = IH.v + " (" + IH.c + " confidence — " + IH.s + ")" + (IH.est ? " [estimate]" : ""); }
      }
    });
    if (it.builder) {
      (it.addons || []).forEach(a => {
        a._item = it.id + ":" + a.id;
        if (a.upfront) a.support = D.support.byAddon[it.id + ":" + a.id] || D.support.plans.quote;
        const AH = D.install.hours[it.id + ":" + a.id];
        if (AH && a.installHrs == null) { a.installHrs = AH.h; a.installVar = AH.v + " (" + AH.c + " confidence — " + AH.s + ")" + (AH.est ? " [estimate]" : ""); }
      });
      if (it.aio) {
        it.aio._item = it.id + ":aio"; it.aio.support = D.support.plans.square;
        /* Square Register class = countertop terminal: use the researched terminal lifecycle, not the fallback. */
        const AL = D.lifecycle.terminal;
        if (it.aio.life == null && AL) { it.aio.life = AL.yrs; it.aio.lifeRange = AL.range; it.aio.lifeConf = AL.conf; it.aio.lifeSrc = AL.src; }
        const IH = D.install.hours[it.id + ":aio"];
        if (IH && it.aio.installHrs == null) { it.aio.installHrs = IH.h; it.aio.installVar = IH.v + " (" + IH.c + " confidence — " + IH.s + ")" + (IH.est ? " [estimate]" : ""); }
      }
    }
  });
}
