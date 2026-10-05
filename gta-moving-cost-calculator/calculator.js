/* GTA Moving Cost Calculator — cost model and form logic.
   Ranges are pre-HST, for LOCAL GTA moves only, licensed/insured movers.
   Sources (researched 2026-10-05): onthemove1.ca, vrmoving.ca (citing HomeStars),
   moovy.ca, professionamover.ca.
   Peak-season and end-of-month show guidance notes only — no price multipliers
   (no sourced data exists for exact multipliers, so none are invented). */
(function () {
  "use strict";

  // Exact ranges from the brief. Do not "refine" these without a new source.
  var BASE_RANGES = {
    studio:     { low: 400,  high: 800,  label: "Studio" },
    one_bed:    { low: 400,  high: 800,  label: "1-bedroom" },
    two_bed:    { low: 700,  high: 1500, label: "2-bedroom" },
    three_bed:  { low: 1000, high: 2000, label: "3-bedroom" },
    four_plus:  { low: 1500, high: 2750, label: "4+ bedroom" }
  };

  var ADDON_RANGES = {
    packing:    { low: 150, high: 400, label: "Full packing service" },
    stairs:     { low: 50,  high: 150, label: "Stairs / walk-up, no elevator" },
    long_carry: { low: 50,  high: 150, label: "Long carry (truck can't park close)" }
  };

  var HST_RATE = 0.13;
  // AFFILIATE: single source for the quote CTA href. Replace with Joseph's
  // Awin Bark CA tracking link after his application. The static CTA box in
  // index.html (#cta-quotes) is synced from this constant on load (see init).
  var CTA_HREF = "https://www.bark.com/en/ca/";
  // Peak moving season in the GTA: June, July, August, September.
  var PEAK_MONTHS = { "6": true, "7": true, "8": true, "9": true };

  function money(n) {
    return "$" + n.toLocaleString("en-CA");
  }

  function compute(sizeKey, addonKeys) {
    var base = BASE_RANGES[sizeKey];
    var low = base.low;
    var high = base.high;
    var breakdown = [
      base.label + " home (base range): " + money(low) + "–" + money(high) + " pre-HST"
    ];
    addonKeys.forEach(function (key) {
      var a = ADDON_RANGES[key];
      low += a.low;
      high += a.high;
      breakdown.push(
        "+ " + a.label + ": " + money(a.low) + "–" + money(a.high) + " pre-HST"
      );
    });
    return { low: low, high: high, breakdown: breakdown };
  }

  function render(result, monthKey, endOfMonth) {
    var out = document.getElementById("calc-result");
    var withHstLow = Math.round(result.low * (1 + HST_RATE));
    var withHstHigh = Math.round(result.high * (1 + HST_RATE));

    var html = "";
    html += '<h2>Your estimated range</h2>';
    html += '<p class="range-line">' + money(result.low) + " – " + money(result.high) + " <span>pre-HST</span></p>";
    html += '<p class="range-hst">With 13% Ontario HST: ' + money(withHstLow) + " – " + money(withHstHigh) + "</p>";

    html += '<ul class="breakdown">';
    result.breakdown.forEach(function (line) {
      html += "<li>" + line.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</li>";
    });
    html += "</ul>";

    if (PEAK_MONTHS[monthKey]) {
      html += '<div class="guide-note" role="note"><strong>Peak-season guidance:</strong> ' +
        "June–September is the GTA's busiest moving season. We don't add a markup because " +
        "no reliable source gives an exact peak-season multiplier — but you should <strong>book early</strong>, " +
        "as the best-rated movers fill up fast.</div>";
    }
    if (endOfMonth) {
      html += '<div class="guide-note" role="note"><strong>End-of-month guidance:</strong> ' +
        "The 28th–31st are the busiest moving days of the month. " +
        "<strong>Book early</strong> if your date isn't flexible.</div>";
    }

    html += '<div class="cta-box">';
    html += "<p><strong>This is a starting estimate.</strong> Your exact price depends on the company, distance, and timing — get firm written quotes before booking.</p>";
    html += '<a class="cta-btn" href="' + CTA_HREF + '" target="_blank" rel="sponsored nofollow noopener">Get exact quotes from GTA movers</a>';
    html += '<p class="affiliate-disclosure">We may earn a commission if you request quotes through this link. It doesn\'t change your price.</p>';
    html += "</div>";

    out.innerHTML = html;
    out.hidden = false;
    out.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function onSubmit(event) {
    event.preventDefault();
    var form = document.getElementById("move-form");
    var size = form.querySelector('input[name="home-size"]:checked');
    if (!size) { return; } // radios always have a default checked; guard anyway
    var addons = Array.prototype.slice.call(
      form.querySelectorAll('input[name="addons"]:checked')
    ).map(function (el) { return el.value; });
    var month = document.getElementById("in-month").value;
    var endOfMonth = document.getElementById("in-endofmonth").checked;
    render(compute(size.value, addons), month, endOfMonth);
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("move-form").addEventListener("submit", onSubmit);
    // Keep the static content-section CTA in sync with the single CTA_HREF
    // constant, so a future tracking-link swap touches one place only.
    var staticCta = document.getElementById("cta-quotes");
    if (staticCta) { staticCta.href = CTA_HREF; }
  });

  // Export for testing / reuse.
  window.GtaMoveCalc = {
    compute: compute,
    BASE_RANGES: BASE_RANGES,
    ADDON_RANGES: ADDON_RANGES,
    HST_RATE: HST_RATE
  };
})();
