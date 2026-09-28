/* session.js — the simulator's shared session store.
 *
 * Every simulator module imports { S } from here instead of reaching for
 * window-level globals. sim-core populates S.DATA at boot (after loadData());
 * section modules (visual-map, training, net-plan, margin-eaters) read the
 * current sector, state and catalog data through S, and call S.recalc() to
 * trigger a full re-render. Nothing outside js/ touches S.
 */
export const S = {
  DATA: null,            // catalog data from data/*.json (set by sim-core at boot)
  sector: "retail",
  state: {},             // itemId -> {checked, optIdx, qty, ...}
  TRAIN: { wage: 18, hrsPerEmp: 6, emps: null, empsTouched: false,
    trainerMode: "self", trainerHrs: 4, turnover: 0.75, hireHrs: 4 },
  techRate: 125,
  guestWifi: false,
  terminalsTouched: false,
  pinSync: false,
  stationsAuto: true,
  terminalsAuto: true,
  reqsAuto: { scale: true, scanner: true },
  D: null,               // derived per-sector quantities (derive() cache)
  ME: null,              // margin-eaters inputs cache
  NET: null,             // network-plan zone wiring cache
  mapViewPref: null,     // "svg" | "list" | null (auto)
  mapNarrow: typeof window !== "undefined" && window.innerWidth < 720,
  recalc: null,          // set by sim-core boot; sections call S.recalc()
};
