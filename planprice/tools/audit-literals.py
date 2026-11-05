#!/usr/bin/env python3
"""PlanPrice checked-date audit sweep.

Scans all *.html under the site root and reports every checked/verified
date that disagrees with the registry (data/site-data.json) or with the
canonical per-product chain (data/sweeps/*.json, then
data/compare-vendors.json). The date rules themselves live in
tools/site_data.py, shared with stamp-dates.py, so audit and stamp can
never drift apart.

Findings (each printed with file + expected + found):
  (a) Footer "Prices verified <ISO> by the PlanPrice research team" whose
      date != registry prices_verified_date. Applies to every page,
      including deals/<slug>.html (their footer is the site-level line).
  (b) "prices checked" literals in the stamped forms (see stamp-dates.py
      for the form list and the plain-text whitelist):
        - <time> form on any page except deals/<slug>.html
        - plain "Prices checked <ISO>" / "prices checked <ISO>" on
          compare/ pages (expected: that page's registry date)
        - whitelisted plain template phrasings ("tracked, checked <ISO>.",
          "promos checked <ISO>.", "verified pricing, checked <ISO>.") on
          all other pages (expected: the site date)
      Article prose "checked <date>" lines outside these forms are the
      articles' own check dates and are deliberately NOT audited — the
      audit only judges what the stamp pass owns.
      deals/<slug>.html per-product contexts are excluded here; they are
      checked under (c).
  (c) deals/<slug>.html: "Prices verified <time datetime=\\"D\\">..." and
      "✓ Verified D" must equal the canonical chain date for that slug.
      A slug with no chain date whose page claims one is a finding; a page
      claiming no date at all is a finding too.
  (d) Cadence: for each registry variable, if --today minus as_of exceeds
      review_cadence_days, the variable is reported stale.
  Also: the registry's page_checked_dates map must agree with a
  recomputation from the data files (site_data.cross_check_registry).

Exit 0 when there are no findings, 1 when there are findings, 2 when the
audit itself cannot run (e.g. registry missing/invalid).

Usage: python3 tools/audit-literals.py [--root PP] [--today YYYY-MM-DD]
"""

from __future__ import annotations

import argparse
import datetime
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import site_data  # noqa: E402

# Stamped-form patterns are shared with stamp-dates.py via site_data
# (named-group layout: prefix / date / attr / inner / suffix). ISO is
# still used below for the audit-only deal-page patterns.
ISO = site_data.ISO
FOOTER_RE = site_data.FOOTER_RE
TIME_RE = site_data.TIME_RE
COMPARE_PLAIN_RE = site_data.COMPARE_PLAIN_RE
WHITELIST_RES = site_data.WHITELIST_RES
DEAL_TIME_RE = re.compile(
    r"Prices verified <time datetime=\"(" + ISO + r")\">[^<]*</time>"
)
DEAL_PILL_RE = re.compile(r"✓ Verified (" + ISO + r")")


class Auditor:
    def __init__(self, root: Path, today: datetime.date):
        self.root = root
        self.today = today
        self.findings: list = []
        self.registry = site_data.load_registry(root)
        self.site = site_data.site_date(self.registry)
        self.canon = site_data.canonical_product_dates(root)

    def add(self, kind: str, rel: str, expected: str, found: str):
        self.findings.append(
            f"FINDING ({kind}) {rel}: expected {expected}, found {found}"
        )

    def applicable_date(self, rel: str):
        if rel.startswith("compare/"):
            slug = Path(rel).stem
            try:
                return site_data.registry_page_date(self.registry, slug)
            except site_data.SiteDataError:
                self.add(
                    "compare-registry",
                    rel,
                    "a page_checked_dates entry in site-data.json",
                    "no registry entry",
                )
                return None
        return self.site

    def check_file(self, path: Path):
        rel = path.relative_to(self.root).as_posix()
        text = path.read_text(encoding="utf-8")

        # (a) footer
        for match in FOOTER_RE.finditer(text):
            if match.group("date") != self.site:
                self.add("a:footer", rel, self.site, match.group("date"))

        if rel.startswith("deals/") and path.name != "deals.html":
            self.check_deal_page(rel, text)
            return

        expected = self.applicable_date(rel)
        if expected is None:
            return

        # (b) <time> form
        for match in TIME_RE.finditer(text):
            attr, inner = match.group("attr"), match.group("inner")
            if attr != expected or inner != expected:
                self.add(
                    "b:prices checked <time>",
                    rel,
                    expected,
                    f"datetime={attr} text={inner}",
                )
        if rel.startswith("compare/"):
            # (b) plain form on compare pages
            for match in COMPARE_PLAIN_RE.finditer(text):
                if match.group("date") != expected:
                    self.add("b:Prices checked", rel, expected, match.group("date"))
        else:
            # (b) whitelisted plain template phrasings only
            for name, pattern in WHITELIST_RES:
                for match in pattern.finditer(text):
                    if match.group("date") != expected:
                        self.add(f"b:{name}", rel, expected, match.group("date"))

    def check_deal_page(self, rel: str, text: str):
        slug = Path(rel).stem
        expected = self.canon.get(slug)
        claims = [m.group(1) for m in DEAL_TIME_RE.finditer(text)]
        claims += [m.group(1) for m in DEAL_PILL_RE.finditer(text)]
        if not claims:
            self.add(
                "c:deal date claim",
                rel,
                f"a verified-date claim ({expected or 'no canonical date'})",
                "no date claims on page",
            )
            return
        if expected is None:
            self.add(
                "c:deal date claim",
                rel,
                "no date claim (slug has no canonical date in sweeps/compare-vendors)",
                ", ".join(sorted(set(claims))),
            )
            return
        for found in claims:
            if found != expected:
                self.add("c:deal verified date", rel, expected, found)

    def check_cadence(self):
        for name, variable in (self.registry.get("variables") or {}).items():
            as_of_raw = variable.get("as_of")
            cadence = variable.get("review_cadence_days")
            if not as_of_raw or not isinstance(cadence, int):
                continue
            as_of = datetime.date.fromisoformat(as_of_raw)
            age = (self.today - as_of).days
            if age > cadence:
                self.add(
                    "d:stale variable",
                    "data/site-data.json",
                    f"{name} reviewed within {cadence} days of {self.today.isoformat()}",
                    f"{name} as_of {as_of_raw} ({age} days old)",
                )

    def run(self) -> list:
        for mismatch in site_data.cross_check_registry(
            self.root, registry=self.registry, canon=self.canon
        ):
            self.add("registry", "data/site-data.json", "registry agrees with recomputation", mismatch)
        for path in sorted(self.root.rglob("*.html")):
            self.check_file(path)
        self.check_cadence()
        return self.findings


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Audit PlanPrice checked dates against the registry.")
    parser.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    parser.add_argument("--today", default=None, help="YYYY-MM-DD (default: today's date)")
    args = parser.parse_args(argv)
    root = Path(args.root)
    today = (
        datetime.date.fromisoformat(args.today) if args.today else datetime.date.today()
    )
    try:
        auditor = Auditor(root, today)
        findings = auditor.run()
    except site_data.SiteDataError as exc:
        print(f"audit-literals: ERROR: {exc}", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"audit-literals: ERROR: {exc}", file=sys.stderr)
        return 2
    for finding in findings:
        print(finding)
    if findings:
        print(f"audit-literals: {len(findings)} finding(s)")
        return 1
    print("audit-literals: no findings")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
