# Equipment Lifecycles — POS / Payment Hardware (Canadian small-business context)

Researched 2026-09-28. Access date applies to every row. Figures are Canadian-applicable
(Toronto retail context); no Canada-specific deviations found — these are global product
lifecycle numbers and Canada follows the same PCI / PCI-PTS regime.

**How to read confidence:** High = strong published evidence · Medium = solid industry/manufacturer
evidence · Low = thin evidence — treated as an **estimate** in the simulator and labelled as such.
"Estimate" rows are clearly marked; nothing is presented as a fact that isn't sourced.

**MTBF trap (do not misuse):** manufacturer MTBF figures (Epson 360k hrs, Elo 50k hrs) are
design/reliability targets, not calendar life — used only as relative indicators between
categories, never as the lifespan number.

**The dominant retirement driver is obsolescence, not mechanical failure.** POS terminals/PIN pads
→ PCI PTS version expiry; APs/routers → firmware support end + Wi-Fi generations; tablets →
iPadOS/app minimum versions; kiosks → the chassis outlives the compute/payment modules
(refurbishment path). Only cash drawers, switches and in-counter scanners die of actual
mechanical wear — and cash drawers essentially don't (4M-cycle rating).

**Harsh-environment split:** kitchen heat/grease materially shortens life for two categories —
consumer tablets used as KDS (3–4 yrs vs 5–7 purpose-built) and kitchen impact printers
(TM-U220 MTBF 180k hrs vs 360k hrs for the countertop TM-T88 thermal). No published
environment split exists for anything else.

| # | Category | Life (yrs) | Source | URL | Conf |
|---|----------|-----------|--------|-----|------|
| 1 | POS terminals / payment terminals (Moneris/Ingenico/Verifone class) | 5–7 (design ~10 yrs @ 100k-hr rating; practical 6+; PCI refresh forces 4–5) | Merchant Account Blog (merchantequip.com); FavorPOS lifespan guide | http://www.merchantequip.com/merchant-account-blog/archives/196 ; https://www.favorpos.com/how-long-does-a-pos-last-pos-system-lifespan-guide-favorpos.html | Medium |
| 2 | Cash drawers | 10–15 | FavorPOS ("over 10 years"); APG Series 4000 datasheet (4M cycles) | https://www.favorpos.com/how-long-does-a-pos-last-pos-system-lifespan-guide-favorpos.html ; https://staging.barcodefactory.com/pdf2/APG/m-43-004-rev-m-series-4000-english.pdf | Medium |
| 3 | Thermal receipt printers | 5 (industry 3–5; Epson hardware rated far longer: 20M-line mechanism, 3M-cut autocutter) | FavorPOS (3–5 yrs); Epson TM-T88VI spec (MTBF 360,000 hrs) | https://www.favorpos.com/how-long-does-a-pos-last-pos-system-lifespan-guide-favorpos.html ; https://www.epson.com.my/For-Work/Printers/POS-Printers/Epson-TM-T88VII-Thermal-Receipt-Printer/p/C31CJ57512 | Medium |
| 4 | Kitchen impact printers (Epson TM-U220 class) | 3–5 — use lower end in hot/greasy kitchens | FavorPOS (3–5); Epson.ca TM-U220 (MTBF 180,000 hrs, mechanism 7.5M lines) | https://www.favorpos.com/how-long-does-a-pos-last-pos-system-lifespan-guide-favorpos.html ; https://epson.ca/For-Work/Printers/POS/TM-U220-i-COM-Receipt-Kitchen-Printer---Multi-Station/p/C31C514A7941 | Medium |
| 5 | Mobile/Bluetooth receipt printers | **estimate** 3–4 | Epson TM-P20 datasheet (mechanism 10M lines, MTBF 120k hrs; service plans to 5 yrs); batteries (~2-yr) are the limiter | https://www.mbcestore.com/pdf/epson/mobilink-p20.pdf | Low |
| 6 | Label printers (DYMO LabelWriter class) | **estimate** 5 | LabelValue ("built for the long-distance ride — 2M inches / 500k labels"); ShipScience ("several years with proper maintenance"); DYMO publishes no figure | https://www.labelvalue.com/troubleshooting-guide-dymo-labelwriter-printers ; https://www.shipscience.com/dymo-labelwriter-4xl-vs-zebra-gx430t/ | Low |
| 7 | Handheld barcode scanners | 5–7 | FavorPOS ("5–7 years with regular cleaning") | https://www.favorpos.com/how-long-does-a-pos-last-pos-system-lifespan-guide-favorpos.html | Medium |
| 8 | Presentation scanners (Zebra DS9308 class) | **estimate** 5–7 | Zebra DS9300 spec — no MTBF published; "won't wear out" frictionless ratcheting base | https://valutrack.com/wp-content/uploads/2024/04/ds9300-presentation-scanner-spec-sheet-1.pdf | Low |
| 9 | In-counter grocery scanners (Zebra MP7000 class) | **estimate** 7–10 | Zebra MP7000 spec — no lifespan/MTBF; solid-state "no moving parts… fewest failure points in this class" | https://tecnicasystems.com/wp-content/uploads/2023/04/mp7000-specification-sheet-en-us_wlogo.pdf | Low |
| 10 | Price-computing retail scales | **estimate** 7–10 | Mettler Toledo XRT manual ("will provide years of accurate weighing") — no year figure published | http://advatek.myftp.org/manuals/Toledo/Express%20Line/Retail%20Scales/Standard%20Price%20Computing%20Scale/Standard%20Price%20Computing%20Scale.pdf | Low |
| 11a | KDS — consumer tablet as kitchen display | **estimate** 3–4 (heat/grease/steam; always-on charging degrades battery) | Apple vintage/obsolete policy (vintage 5 yrs, obsolete 7); Asurion (≥5 yrs consumer) | https://www.macworld.com/article/2035481/how-long-does-apple-support-ipads.html ; https://appleinsider.com/inside/ipad/tips/when-to-reuse-sell-or-recycle-an-old-iphone-or-ipad | Low |
| 11b | KDS — purpose-built commercial touchscreen | 5–7 (rated 60°C; Elo MTBF 50k hrs ≈ 5.7 yrs continuous) | Oracle Express Station 400 KDS specs; Elo 1715L manual (extended warranties to 5 yrs) | https://www.oracle.com/middleeast/food-beverage/restaurant-pos-systems/kds-kitchen-display-systems/ ; https://manuals.plus/elo/touchscreen-monitor-manual | Medium |
| 12 | Customer-facing displays / pole displays | 7–10 (panel 50k–60k hrs ⇒ ~8.5–10 yrs at 16 hrs/day) | Display Industry Association; Lavida Display (50k-hr backlight typical) | https://markets.financialcontent.com/lethbridgeherald/article/abnewswire-2026-8-29-how-to-choose-between-lcd-and-amoled-display-for-business-needs ; https://medium.com/@longwintechnology/reliable-tft-lcd-displays-for-kiosks-pos-atms-more-000e62fed4a8 | Medium |
| 13 | PIN pads | 5–7 (hardware design ~10 yrs; PCI PTS version expiry retires them) | Merchant Account Blog (100k-hr ≈ 10 yrs; practical 6+); PCI SSC bulletin (replace when PTS approval expires) | http://www.merchantequip.com/merchant-account-blog/archives/196 ; https://www.pcisecuritystandards.org/wp-content/uploads/2020/02/PCISSC_Bulletin_on_the_expiration_of_the_approval_of_PTS_POI_v3_devices_v1.1.pdf | Medium |
| 14 | Network switches (SMB managed/PoE) | 5–7 | Hummingbird Networks (~5 yrs); Allegiant (5–7); Stratus/Meraki partner (5–10) | https://www.hummingbirdnetworks.com/articles/how-often-should-i-replace-my-networking-devices ; https://allegiantnow.com/switch-up-your-network-when-to-replace-aging-hardware/ | Medium-High |
| 15 | Wi-Fi access points | 3–5 (retire on firmware-support end or density obsolescence) | Hummingbird Networks; Meraki support policy (7 yrs after end-of-sale) | https://www.hummingbirdnetworks.com/articles/how-often-should-i-replace-my-networking-devices | Medium |
| 16 | Routers / failover devices (Cradlepoint class) | 4–5 | Hummingbird Networks (~5 yrs); Cradlepoint NetCloud 1/3/5-yr subscription terms | https://www.hummingbirdnetworks.com/articles/how-often-should-i-replace-my-networking-devices ; https://www.sdxcentral.com/news/cradlepoint-moves-its-lte-focused-sd-wan-to-subscription-model/ | Medium |
| 17 | Tablets as POS (iPad/Android) | 4–5 (always-on/charging + app/OS minimum-version creep) | Macworld (iPadOS support); AppleInsider (vintage 5–7, obsolete 7+); Asurion (≥5 yrs typical) | https://www.macworld.com/article/2035481/how-long-does-apple-support-ipads.html ; https://appleinsider.com/inside/ipad/tips/when-to-reuse-sell-or-recycle-an-old-iphone-or-ipad | Medium |
| 18 | Tablet stands / mounts (Heckler WindFall class) | **estimate** 10+ mechanically; effective life = tablet generation | Heckler WindFall spec (heavy powder-coated steel, 2-yr warranty; stands tied to iPad generations) | http://heckler.com/library/h549bg-spec-sheet | Low |
| 19 | Self-checkout / self-order kiosks | 5–7 | Self-service kiosk market report (5–7); Firstouch buying guide (3–5 before refresh beats maintenance); Olea/ATM Marketplace (chassis 7–10+ structural) | https://hackmd.io/@iefIm5OrQ62os7vHV2HwPw/rkDMg9wY-x ; https://firstouchkiosk.com/blog/interactive-kiosk-buying-guide-what-to-look-for-before-you-invest/ ; https://www.atmmarketplace.com/articles/how-to-handle-end-of-life-atms-kiosks/ | Medium |
| 20 | Handheld ordering devices (Zebra TC26 class) | 3–5 | Zebra white paper citing VDC Research 2015 TCO (enterprise rugged handheld upgrade cycles 3–5 yrs; failures ~1% yr1 → ~8% yr4) | https://www.zebra.com/content/dam/zebra_new_ia/en-us/campaigns/os-migration/assess-your-business/2015%20White%20Paper%20-%20Zebra%20OS%20Migration_110715.pdf | High |
| 21 | Back-office PCs | 4–5 | GDS Technology (4–5); Seras IT (3–5); IDC via TechNewsWorld (commercial refresh 3–4) | https://www.gdstech.tech/blog/hardware-lifecycle-management-knowing-when-atlanta-businesses-should-repair-replace-or-refresh-technology ; http://technewsworld.com/story/favorable-refresh-cycle-windows-10-end-drove-2024-pc-shipment-growth-179536.html | High |
| 22 | UPS (network + lanes) | **estimate** 5 (batteries ~3–5 yrs are the limiter; the unit lasts longer) | no published small-business UPS lifespan found — labelled estimate per project rules | — | Low |

## Simulator application

- `LIFECYCLE` table in `simulator.html` maps each hardware item id to `{yrs, range, conf, src, note}`.
  Midpoint (`yrs`) feeds the math: monthly equivalent = upfront ÷ (yrs × 12).
- The full range + confidence + source render under each option ("⏳ Expected life").
- `est:true` rows render an explicit **(estimate)** tag — never presented as fact.
- Option-level `life` overrides exist where one item mixes classes (e.g. KDS: consumer-tablet
  option 3–4 yrs estimate vs purpose-built 5–7 yrs).
- Items with no `LIFECYCLE` entry (software, services, AI) carry no hardware life — the legacy
  36-month divisor only applies where no researched figure exists.
