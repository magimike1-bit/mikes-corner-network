/* PlanPrice deal filter (PP-DEAL-FILTER) — progressive enhancement.
 *
 * The directory is fully rendered as static HTML (SEO + no-JS fallback).
 * This script only shows/hides/reorders rows; it never adds deal content.
 * If the index can't be fetched, the form stays hidden and the static list
 * is left exactly as-is.
 *
 * Facets are declarative: each entry names the control that drives it and a
 * predicate over the index product. To add a new facet, add the control's
 * markup to the filter form in tools/generate.mjs and one entry to FACETS
 * below — no other UI or logic changes needed.
 */
(function () {
  "use strict";

  var form = document.getElementById("deal-filter");
  if (!form) return;

  fetch("/data/deals-index.json", { credentials: "same-origin" })
    .then(function (res) {
      if (!res.ok) throw new Error("deals index HTTP " + res.status);
      return res.json();
    })
    .then(init)
    .catch(function () {
      /* No index (offline build, blocked fetch): form stays hidden and the
         full static list remains untouched. */
    });

  function init(index) {
    var bySlug = {};
    (index.products || []).forEach(function (p) {
      bySlug[p.slug] = p;
    });

    var catSel = document.getElementById("f-category");
    var dealsBox = document.getElementById("f-deals");
    var canadianBox = document.getElementById("f-canadian");
    var sortSel = document.getElementById("f-sort");
    var countEl = document.getElementById("f-count");

    var FACETS = [
      {
        id: "category",
        control: catSel,
        matches: function (p) {
          return catSel.value === "all" || p.category === catSel.value;
        },
      },
      {
        id: "dealsOnly",
        control: dealsBox,
        matches: function (p) {
          return !dealsBox.checked || p.dealHeadline != null;
        },
      },
      {
        id: "canadianOnly",
        control: canadianBox,
        matches: function (p) {
          return !canadianBox.checked || p.country === "CA";
        },
      },
    ]
      // Fail-safe (PP-SECTIONS): a facet whose control is absent from the
      // page (e.g. the category dropdown on single-category pages) is
      // skipped instead of throwing.
      .filter(function (f) {
        return f.control != null;
      });

    // Scope strictly to the homepage directory: deal-page "related" rows and
    // the expired-deals section carry no data-slug and are never touched.
    var sections = Array.prototype.slice.call(
      document.querySelectorAll("#all-deals .dir-cat")
    );
    var rows = [];
    sections.forEach(function (sec) {
      Array.prototype.slice
        .call(sec.querySelectorAll(".dir-row[data-slug]"))
        .forEach(function (li) {
          li._ppOrder = rows.length; // original static order = "Featured"
          rows.push(li);
        });
    });
    if (!rows.length) return;

    // Sort key per row. Quote-priced (priceSort null) sorts last in price
    // mode; ties always fall back to the original static order.
    function priceKey(li) {
      var p = bySlug[li.getAttribute("data-slug")] || {};
      var v = typeof p.priceSort === "number" ? p.priceSort : Infinity;
      return [v, li._ppOrder];
    }

    function compareKeys(a, b) {
      for (var i = 0; i < a.length && i < b.length; i++) {
        if (a[i] < b[i]) return -1;
        if (a[i] > b[i]) return 1;
      }
      return 0;
    }

    function apply() {
      var mode = sortSel ? sortSel.value : "featured";
      var shown = 0;
      sections.forEach(function (sec) {
        var ul = sec.querySelector(".dir-rows");
        var items = Array.prototype.slice
          .call(ul.children)
          .filter(function (li) {
            return li.hasAttribute("data-slug");
          });
        items.sort(function (a, b) {
          if (mode === "featured") return a._ppOrder - b._ppOrder;
          if (mode === "name-asc") {
            var pa = bySlug[a.getAttribute("data-slug")] || {};
            var pb = bySlug[b.getAttribute("data-slug")] || {};
            var c = String(pa.name || "").localeCompare(String(pb.name || ""));
            return c !== 0 ? c : a._ppOrder - b._ppOrder;
          }
          return compareKeys(priceKey(a), priceKey(b));
        });
        items.forEach(function (li) {
          ul.appendChild(li);
        });
        var visibleInSection = 0;
        items.forEach(function (li) {
          var p = bySlug[li.getAttribute("data-slug")];
          // Fail open: a row missing from the index stays visible rather
          // than vanishing on a stale or mismatched index.
          var ok = !p || FACETS.every(function (f) { return f.matches(p); });
          li.style.display = ok ? "" : "none";
          if (ok) {
            visibleInSection++;
            shown++;
          }
        });
        sec.style.display = visibleInSection ? "" : "none";
      });
      if (countEl) {
        countEl.textContent = shown + " of " + rows.length + " products shown";
      }
    }

    [catSel, dealsBox, canadianBox, sortSel]
      .filter(function (el) {
        return el != null;
      })
      .forEach(function (el) {
        el.addEventListener("change", apply);
      });
    form.hidden = false;
    apply();
  }
})();
