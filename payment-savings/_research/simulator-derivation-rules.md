# Simulator Derivation Rules — validated 2026-09-28

Purpose: the site simulator asks only 3 questions per sector, then auto-builds the
full setup from these rules. The builder implements these formulas EXACTLY.
Every number the user can change afterwards; these are the defaults.

Conventions: `round()` = round-half-up. `clamp(v,lo,hi)` bounds the result.
"wired_drops" = 1 cable run per wired device (each POS station, KDS screen,
printer, AP, lottery terminal). Switch size = smallest of 8/16/24/48 ports
that covers wired_drops + APs + 4 spare ports.

Global inference rules (never asked, always derived):
- POS stations, terminals, KDS screens, printers, scanners, scales: WIRED.
- Handheld/tablet devices (pay-at-table, room tablets): wireless.
- Guest wifi: default ON for full-service restaurant, quick-service/café,
  hotel, salon. Default OFF for retail, grocery (available as a toggle).
- Every auto-added item shows a one-line "why this appeared" note.

---

## 1. Full-service restaurant

Questions: # tables (T) / bar? (B) / takeout-delivery mode (M)

| Derived item | Rule | Source |
|---|---|---|
| Pay-at-table handhelds | T≤10 → 1; 11–30 → 2; >30 → 3 | hospitalitytech.com pay-at-table FAQ (2024): "up to 10 tables… one terminal; 11 to 30… two; more than 30… at least three" |
| Fixed POS stations | clamp(1 + B + max(0, ceil((T−15)/20)), 1, 6). The 1 = host stand; B = bar station | Heuristic — **verify with Joseph** (medium confidence) |
| KDS screens | T≤30 → 2; 31–60 → 3; >60 → 4 | katalystos.com KDS FAQ: "Most full-service restaurants run 2–4 screens (cold line, hot line, expo, sometimes pastry)"; spoton.com: "one screen per section: grill, cold, expo" |
| Kitchen printers | T≤30 → 1; else 2 | Heuristic — **verify with Joseph** (medium) |
| Receipt printers / cash drawers | = fixed POS stations (bar included) | Standard practice |
| Access points | max(1, round(T×60/2000)); est. total sqft = T×60 (dining + kitchen + bar + circulation) | 1 AP per ~2,000 sq ft from _research/infrastructure-costs.md (2026-09-28) |
| Guest wifi | ON (dining) | Inference rule |
| Takeout mode | in-house → online-ordering module; apps → aggregator tablet(s) as "toy" tier; both → both | _research/sector-systems-integrations.md |

## 2. Quick-service / café

Questions: drive-thru? (D) / eat-in seats (S) / kiosks (K: have/want/no)

| Derived item | Rule | Source |
|---|---|---|
| Order counters | S=0 → 1; S≤30 → 2; 31–80 → 3; >80 → 4 | Heuristic — **verify with Joseph** (medium) |
| KDS screens | (S≤40 → 1; else 2) + (1 if D) | katalystos.com: "Quick-serve and fast-casual typically run 1–2 (make-line + expo)" |
| Drive-thru terminal | 1 if D | Standard |
| Kiosks | if K in (have, want): max(2, round(S/40)) if S>0 else 2 | Heuristic — **verify with Joseph** (low-medium) |
| Access points | S=0 → 1; else max(1, round(S/50)) | Heuristic — **verify with Joseph** (medium) |
| Guest wifi | ON | Inference rule |

## 3. Retail

Questions: store sq ft (F) / sell by weight? (W) / self-checkouts (C: have/want/no)

| Derived item | Rule | Source |
|---|---|---|
| Checkout lanes | clamp(round(sqrt(F/800)), 1, 10). 800→1, 5,000→2, 20,000→5, 100,000→10 | Heuristic (sublinear scaling — lanes grow slower than floor space). **Verify with Joseph** (medium). Directional support: Progressive Grocer via thefreelibrary.com notes lane counts track volume with wide variation |
| Back-office PCs | F<3,000 → 1; ≤15,000 → 2; else 3 | Heuristic — **verify with Joseph** (medium) |
| Scales | 1 if W | Direct |
| Self-checkouts | want → max(2, round(lanes/2)); have → 2 (editable) | Heuristic — **verify with Joseph** (low-medium) |
| Access points (staff) | max(1, round(F/5000)) | Heuristic — **verify with Joseph** (medium) |
| Guest wifi | OFF by default (toggle available) | Inference rule |

## 4. Hotel & hospitality

Questions: # rooms (R) / # floors (N) / F&B on site? (F)

| Derived item | Rule | Source |
|---|---|---|
| Access points | max(N, ceil(R/25)) + 1 (lobby) + (1 if F) | thenetworkinstallers.com hospitality guide (2026): "one AP per 20–30 guest rooms… with higher density in lobbies, conference rooms"; per-floor minimum from practitioner norms (tomshardware.com hotel wifi thread: corridor AP covers ~12–16 rooms each way) |
| Front-desk stations | clamp(1 + ceil(R/75), 1, 5). 20→2, 150→3, 400→5 | Heuristic — **verify with Joseph** (medium) |
| F&B outlet | if F: 2 POS stations + 2 KDS (mini restaurant setup) | Cross-sector rule |
| Guest wifi | ON (whole property) | Inference rule |
| Back office | 2 wired drops | Standard |

## 5. Grocery / convenience

Questions: store sq ft (F) / deli counter? (D) / lottery terminal? (L)

| Derived item | Rule | Source |
|---|---|---|
| Checkout lanes | max(1, round(F/3000)). 2,500→1, 12,000→4, 45,000→15 | Heuristic (grocery is lane-dense vs general retail). **Verify with Joseph** (medium) |
| Deli | if D: +1 POS station + 1 scale at deli counter | Direct |
| Lottery terminal | 1 if L (wired drop; Ontario rules flagged in sector-systems-integrations.md) | Direct |
| Access points (staff) | max(1, round(F/5000)) | Heuristic — **verify with Joseph** (medium) |
| Guest wifi | OFF by default (toggle available) | Inference rule |

## 6. Services / salon

Questions: # chairs (C) / treatment rooms? (TR) / retail at counter? (RT)

| Derived item | Rule | Source |
|---|---|---|
| Reception POS | C≤10 → 1; else 2 | Heuristic — **verify with Joseph** (medium-high; single reception desk is the norm) |
| Booking calendars | = C (software seats, not hardware) | Direct from booking software pricing (_research/system-monthly-costs.md) |
| Room tablet | 1 if TR>0 (wireless, consultations/room checkout) | Heuristic — **verify with Joseph** (medium) |
| Barcode scanner | 1 if RT (retail inventory at reception) | Direct |
| Access points | max(1, round(C/12)) — covers waiting-area guest wifi | Heuristic — **verify with Joseph** (medium) |
| Guest wifi | ON (waiting area) | Inference rule |

---

## Simulations (all 18 pass the smell test)

Method: rules implemented in Python (/tmp/sim_rules2.py), 3 scenarios per sector
(small/medium/large). Reviewed each output for absurdity (e.g., 40 terminals for
10 tables, 1 AP for a 12-floor hotel). No rule produced an absurd result; two
rules were tightened during validation (retail/grocery staff APs 1/3000→1/5000
sq ft; restaurant sq ft estimate 25→60 sq ft/table to include kitchen/bar).

### Full-service restaurant
- **12 tables, no bar, in-house takeout** → 2 handhelds, 1 fixed POS (host), 2 KDS, 1 kitchen printer, 1 receipt printer + drawer, 1 AP, 5 wired drops → 16-port switch. *Plausible: small bistro.*
- **45 tables, bar, in-house + apps** → 3 handhelds, 4 fixed (host+bar+2 server), 3 KDS, 2 kitchen printers, 1 AP, 13 wired drops → 24-port switch. *Plausible: busy mid-size restaurant.*
- **120 tables (banquet), bar, both** → 3 handhelds, 6 fixed (capped), 4 KDS, 4 APs, 18 wired drops → 48-port switch. *Plausible at scale; note banquet halls often run fewer fixed stations (events pre-paid) — surfaced as an editable override.*

### Quick-service / café
- **No drive-thru, 20 seats, no kiosks** → 2 counters, 1 KDS, 1 AP, 3 wired drops → 8-port switch. *Plausible: neighbourhood café.*
- **Drive-thru, 60 seats, wants kiosks** → 3 counters, 3 KDS (incl. DT), 1 DT terminal, 2 kiosks, 1 AP, 7 wired drops → 16-port switch. *Plausible.*
- **Drive-thru, 120 seats, has kiosks** → 4 counters, 3 KDS, 1 DT terminal, 3 kiosks, 2 APs, 8 wired drops → 16-port switch. *Plausible: large fast-casual.*

### Retail
- **800 sq ft boutique** → 1 lane, 1 back-office PC, 1 AP, 2 wired drops → 8-port switch. *Plausible.*
- **5,000 sq ft, weighed goods, wants self-checkout** → 2 lanes, 1 scale, 2 SCO, 2 back-office PCs, 1 AP, 7 wired drops → 16-port switch. *Plausible: specialty food shop.*
- **25,000 sq ft, has self-checkout** → 6 lanes, 2 SCO, 3 back-office PCs, 5 APs, 11 wired drops → 24-port switch. *Plausible: large-format independent.*

### Hotel & hospitality
- **20 rooms / 2 floors, no F&B** → 3 APs, 2 front-desk stations, 7 wired drops → 16-port switch. *Plausible: small inn.*
- **150 rooms / 5 floors, F&B** → 8 APs, 3 front-desk stations, 2 F&B POS + 2 KDS, 17 wired drops → 48-port switch. *Plausible: mid-size full-service.*
- **400 rooms / 12 floors, F&B** → 18 APs, 5 front-desk stations (capped), 2 F&B POS + 2 KDS, 29 wired drops → 48-port switch. *Plausible: large hotel; AP count tracks floors and the 1-per-25-rooms rule.*

### Grocery / convenience
- **2,500 sq ft corner store** → 1 lane, 1 AP, 1 wired drop → 8-port switch. *Plausible.*
- **12,000 sq ft, deli** → 4 lanes, 1 deli POS + scale, 2 APs, 5 wired drops → 16-port switch. *Plausible: independent grocer.*
- **45,000 sq ft, deli + lottery** → 15 lanes, deli POS + scale, lottery terminal, 9 APs, 17 wired drops → 48-port switch. *Plausible: full supermarket.*

### Services / salon
- **4 chairs** → 1 reception POS, 4 booking calendars, 1 AP, 1 wired drop → 8-port switch. *Plausible.*
- **8 chairs, 2 treatment rooms, retail** → 1 reception POS, 8 calendars, 1 room tablet, 1 scanner, 1 AP. *Plausible.*
- **20 chairs, 5 rooms, retail** → 2 reception POS, 20 calendars, 1 room tablet, 1 scanner, 2 APs. *Plausible: large spa.*

---

## Red-pen list for Joseph (by confidence)

**High confidence (sourced):**
- Restaurant handheld bands (1/2/3 by table count) — hospitalitytech.com
- KDS 2–4 full-service / 1–2 QSR — katalystos.com, spoton.com
- Hotel 1 AP per 20–30 rooms — thenetworkinstallers.com

**Medium confidence (heuristic, grounded but Joseph should confirm):**
- Restaurant fixed stations = 1 + bar + ceil((T−15)/20), cap 6
- Retail lanes = round(sqrt(F/800)), cap 10
- Grocery lanes = round(F/3000)
- QSR counters by seat bands (2/3/4)
- Hotel front-desk = 1 + ceil(R/75), cap 5
- Staff APs = 1 per 5,000 sq ft (retail/grocery); 1 per 50 seats (QSR); 1 per 12 chairs (salon)
- Back-office PCs by store size; kitchen printers 1→2 at 30 tables

**Low-medium (roughest, most likely to need tuning):**
- Kiosk count = max(2, round(S/40))
- Self-checkout want → max(2, round(lanes/2)); have → 2
- Salon room tablet (1 if any treatment rooms)

**Deliberate simplifications to be aware of:**
- Banquet/event halls use the restaurant rules; they usually need fewer fixed stations — the simulator should note this as an editable override.
- "Have kiosks / have self-checkout" assumes a default count (2) the user adjusts — the simulator must make this obvious.
- No revenue/volume question is asked; monthly card volume is collected separately at the audit-CTA step, not in the 3 questions.

---

## Lifecycle amortization (added 2026-09-28, Joseph's rule)
- Every upfront-cost hardware item carries an expected useful life in years
  (`life`), sourced from published manufacturer/industry figures with an access
  date and a confidence flag. Thin evidence is labelled "estimate".
- Monthly equivalent = `upfront ÷ (life_years × 12)` — NOT a universal 36 months.
- A cheaper item that dies sooner can show a HIGHER monthly equivalent than a
  pricier longer-lived one; the catalog surfaces this explicitly.
- Applies to EVERY equipment list: needs/infra/toys tiers AND the station
  builder (add-ons + all-in-one). Old hardcoded "÷ 36" labels removed.

## Support plans — three types (added 2026-09-28, Joseph's rule)
Per item/category, THREE support types are modelled, not just with/without:
1. **Monthly contract, tech on site** (`support.contract`): monthly fee and/or
   upfront over a term. `monthly = (upfront ÷ term_months) + monthly_fee`.
2. **Break/fix** (`support.breakfix`): pay per incident.
   `monthly = per_incident × expected_calls_per_year ÷ 12`.
3. **Hybrid** (`support.hybrid`): lighter contract + reduced per-visit rate.
   `monthly = contract_monthly + (per_incident × calls/yr ÷ 12)`.
- The incident rate is an ADJUSTABLE owner assumption (default 1 call/yr,
  adjustable 0–10 per item), never presented as a fact.
- The catalog shows a TCO line for NONE + all three priced plans, side by side.
- Plain-language guidance: contract suits multi-lane/high-volume (an hour of
  downtime costs more than the contract); break/fix suits a single-location
  owner-operator who can swap a spare and wait a day; hybrid is the middle ground.
- Advance replacement is flagged wherever sourced (prevents downtime/lost sales).
- Pricing is sourced with URLs + access dates, or marked "quote-based". NEVER
  invented. Unpriced plans render as info-only and stay out of the TCO math.
- State: `st.support` ∈ {"none","contract","breakfix","hybrid"}; `st.incidents` = calls/yr.
- Station builder add-ons and all-in-one boxes get the same three-plan selector
  (compact select), with per-lane support cost in the lane total.

## Install costs + pay-now vs pay-monthly (added 2026-09-28, Joseph's rule)
- New "Installation & setup" tier: one-time line items (mounting kits, cable
  drops, network config, POS software setup, menu build, staff training).
  Pricing sourced or quote-based; NEVER invented.
- Cable drops and similar one-time infrastructure work are paid UP FRONT at
  install — NEVER presented as monthly. Install items contribute 0 to the monthly
  total by construction (`itemMonthly` returns 0 for the install tier).
- POS terminal leases (tagged `lease:true`) and similar leased/financed hardware
  go in the MONTHLY column. Purchased hardware never appears in the monthly
  column — its amortized equivalent lives in the grand total for comparison only.
- Average tech install time (`installHrs`, hours on site) on every hardware item;
  ranges (retrofit vs new build) show what drives the variance, midpoint feeds math.
- Install-hours research (2026-09-28): published per-device install-time data
  barely exists — vendors publish bundled/flat-fee cost far more than hours.
  Countertop peripherals are minutes-to-under-an-hour jobs (trip-charge minimums
  dominate, not per-device hours). Sourced anchors: 1–2 terminal install FAQ
  (ivepos.com, Medium); KDS self-setup claims (Fresh KDS); signage cluster
  pricing (crowntv-us.com, aiscreen.io); self-checkout install manual (CVS,
  20–40 min software load/lane); AP install costs (wcctechgroup.com); cable
  drops High confidence 1–3 hr/run (accutechcom.com; Rx Technology 1.5 hr @
  $95/hr; labor is 60–70% of drop cost). Everything else is a labelled Low
  confidence estimate — NEVER presented as fact.
- Install labor = Σ(installHrs × qty) × techRate. techRate is an ADJUSTABLE
  assumption ($/hr). Default $125 = midpoint of the researched CA$100–150/hr
  billed-rate estimate for on-site small-business IT/low-voltage work (Low
  confidence — no published Canadian POS installer rate found; derived from
  CA$28–38/hr wages × 2–2.5× billed multiple; US low-voltage US$30–120/hr).
  Researched 2026-09-28. The merchant sets their real rate.
- Pay-now vs pay-monthly breakout:
  PAY NOW = hardware purchases + install labor + install line items + go-live training.
  PAY MONTHLY = leased hardware + SaaS + support contracts + expected break/fix
  + new-hire training + processing fees.

## Training module (added 2026-09-28, Joseph's rule)
- Two tracks, plain language: TECH training (learning the system — buttons, KDS,
  handhelds) vs PROCESS training (learning the business workflows — rush flow,
  exception handling, who does what). Merchants under-budget both.
- Starter materials per sector: quick-start checklist + role cheat sheets
  (cashier, kitchen/back-of-house, manager). Genuinely usable, printable.
- Labor cost math — training is paid time:
  - Go-live (one-time, pay-now): employees × hrs/employee × wage + trainer
    (self = $0 fee; tech = trainer_hrs × techRate).
  - New-hire training (ongoing, monthly): employees × turnover/yr × hrs/hire × wage ÷ 12.
  - Turnover multiplier is VISIBLE and ADJUSTABLE (default 75%/yr — US hospitality
    avg ~73–76%, BLS via Escoffier/7shifts, accessed 2026-09-28; merchant sets theirs).
  - Wage default $18/hr adjustable (Ontario minimum $17.95/hr from Oct 1, 2026, ontario.ca).
  - Hour defaults are estimates, labelled as such (go-live 6 hrs/employee, 4 hrs/new hire, 4 trainer hrs).
