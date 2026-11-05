#!/usr/bin/env python3
"""Tests for stamp-dates.py / audit-literals.py / site_data.py.

Stdlib unittest only. Fixture trees are built in tempdirs; the real tree is
only READ (cadence far-future check and the registry recompute cross-check).

Run: python3 tools/test_stamp_audit.py
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
REAL_ROOT = TOOLS.parent
sys.path.insert(0, str(TOOLS))
import site_data  # noqa: E402

SITE_DATE = "2026-10-25"
STALE = "2026-09-30"

FOOTER = (
    '<p class="fine">Prices verified {d} by the PlanPrice research team. '
    "Always confirm current pricing.</p>"
)


def run_tool(script, *args):
    return subprocess.run(
        [sys.executable, str(TOOLS / script), *args],
        capture_output=True,
        text=True,
    )


def build_fixture(base: Path) -> Path:
    """A minimal but fully consistent PlanPrice tree.

    Products: housecall-pro (2026-10-23), jobber (2026-09-30), alpha
    (2026-10-25). The compare page housecall-pro-vs-jobber therefore has
    registry date 2026-09-30 (the min), which differs from the site date —
    that difference is the point of several tests.
    """
    root = base / "pp"
    (root / "data" / "sweeps").mkdir(parents=True)
    (root / "compare").mkdir()
    (root / "categories").mkdir()
    (root / "deals").mkdir()

    sweep = {
        "sweep_month": "2026-10",
        "sweep_date": "2026-10-25",
        "source": "test fixture",
        "products": [
            {"slug": "housecall-pro", "last_verified": "2026-10-23"},
            {"slug": "jobber", "last_verified": "2026-09-30"},
            {"slug": "alpha", "last_verified": "2026-10-25"},
        ],
    }
    (root / "data" / "sweeps" / "2026-10-25.json").write_text(json.dumps(sweep))
    vendors = [
        {"slug": "housecall-pro", "verified": "2026-10-23"},
        {"slug": "jobber", "verified": "2026-09-30"},
        {"slug": "alpha", "verified": "2026-10-25"},
    ]
    (root / "data" / "compare-vendors.json").write_text(json.dumps(vendors))
    (root / "data" / "compare.json").write_text(json.dumps({"sets": []}))

    # Pages start out already stamped correctly EXCEPT where a test wants
    # staleness; helpers below write the clean versions.
    (root / "index.html").write_text(FOOTER.format(d=SITE_DATE))
    (root / "categories" / "listing.html").write_text(
        '<p>2 products tracked, checked {d}.</p>'
        '<p>prices checked <time datetime="{d}">{d}</time></p>'.format(d=SITE_DATE)
        + FOOTER.format(d=SITE_DATE)
    )
    (root / "compare" / "housecall-pro-vs-jobber.html").write_text(
        '<meta content="Prices checked {d}.">'
        '<p>prices checked <time datetime="{d}">{d}</time></p>'.format(d="2026-09-30")
        + FOOTER.format(d=SITE_DATE)
    )
    (root / "deals" / "alpha.html").write_text(
        '<div class="facts-item"><dt>Verified</dt><dd>Prices verified '
        '<time datetime="{d}">Oct 25, 2026</time></dd></div>'.format(d=SITE_DATE)
        + FOOTER.format(d=SITE_DATE)
    )

    registry = {
        "site": "planprice.ca",
        "registry_version": 1,
        "variables": {
            "prices_verified_date": {
                "value": SITE_DATE,
                "as_of": SITE_DATE,
                "source": "test fixture",
                "review_cadence_days": 30,
            },
            "products_tracked_count": {
                "value": 49,
                "as_of": SITE_DATE,
                "source": "test fixture",
                "review_cadence_days": 30,
            },
        },
        "page_checked_dates": site_data.compute_page_checked_dates(root),
        "rules": {
            "compare_page_date": "min of member products' last_verified",
            "site_date": "variables.prices_verified_date",
        },
    }
    (root / "data" / "site-data.json").write_text(json.dumps(registry, indent=2))
    return root


class FixtureTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = build_fixture(Path(self._tmp.name))

    def tearDown(self):
        self._tmp.cleanup()

    def stamp(self, *extra):
        return run_tool("stamp-dates.py", "--root", str(self.root), *extra)

    def audit(self, *extra):
        return run_tool(
            "audit-literals.py", "--root", str(self.root), "--today", "2026-11-05", *extra
        )


class StampTests(FixtureTestCase):
    def test_footer_replaced(self):
        index = self.root / "index.html"
        index.write_text(FOOTER.format(d=STALE))
        result = self.stamp()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"Prices verified {SITE_DATE} by the PlanPrice", index.read_text())

    def test_listing_time_tag_replaced_with_site_date(self):
        listing = self.root / "categories" / "listing.html"
        listing.write_text(
            '<p>2 products tracked, checked {d}.</p>'
            '<p>prices checked <time datetime="{d}">{d}</time></p>'.format(d=STALE)
            + FOOTER.format(d=STALE)
        )
        result = self.stamp()
        self.assertEqual(result.returncode, 0, result.stderr)
        text = listing.read_text()
        self.assertIn(
            f'prices checked <time datetime="{SITE_DATE}">{SITE_DATE}</time>', text
        )
        self.assertIn(f"tracked, checked {SITE_DATE}.", text)

    def test_compare_fixture_replaced_with_registry_page_date_not_site_date(self):
        page = self.root / "compare" / "housecall-pro-vs-jobber.html"
        page.write_text(
            '<meta content="Prices checked {d}.">'
            '<p>prices checked <time datetime="{d}">{d}</time></p>'
            '<p class="fine">Prices checked {d} by the PlanPrice research team.</p>'.format(
                d=SITE_DATE
            )
            + FOOTER.format(d=SITE_DATE)
        )
        result = self.stamp()
        self.assertEqual(result.returncode, 0, result.stderr)
        text = page.read_text()
        self.assertIn('Prices checked 2026-09-30.', text)
        self.assertIn(
            'prices checked <time datetime="2026-09-30">2026-09-30</time>', text
        )
        self.assertIn(
            "Prices checked 2026-09-30 by the PlanPrice research team", text
        )

    def test_stamp_is_idempotent(self):
        index = self.root / "index.html"
        index.write_text(FOOTER.format(d=STALE))
        first = self.stamp()
        self.assertEqual(first.returncode, 0, first.stderr)
        snapshot = {
            p: p.read_bytes() for p in sorted(self.root.rglob("*.html"))
        }
        second = self.stamp()
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertIn("changed 0 file(s), 0 replacement(s)", second.stdout)
        for path, data in snapshot.items():
            self.assertEqual(path.read_bytes(), data)

    def test_stamp_fails_loudly_and_writes_nothing_when_compare_page_lacks_registry_entry(self):
        (self.root / "compare" / "alpha-vs-jobber.html").write_text(
            f'<meta content="Prices checked {SITE_DATE}.">'
        )
        index = self.root / "index.html"
        index.write_text(FOOTER.format(d=STALE))
        before = index.read_bytes()
        result = self.stamp()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("alpha-vs-jobber", result.stderr + result.stdout)
        # Nothing was written: the stale footer is still stale.
        self.assertEqual(index.read_bytes(), before)


class AuditTests(FixtureTestCase):
    def test_audit_catches_planted_stale_footer(self):
        index = self.root / "index.html"
        index.write_text(FOOTER.format(d=STALE))
        result = self.audit()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("index.html", result.stdout)
        self.assertIn(STALE, result.stdout)

    def test_audit_passes_clean_fixture_tree(self):
        result = self.audit()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("no findings", result.stdout)


class RealTreeTests(unittest.TestCase):
    def test_cadence_far_future_flags_prices_verified_date_stale(self):
        result = run_tool(
            "audit-literals.py", "--root", str(REAL_ROOT), "--today", "2027-06-01"
        )
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("prices_verified_date", result.stdout)
        self.assertIn("stale", result.stdout)

    def test_site_data_recompute_cross_check_agrees_with_registry_for_real_tree(self):
        self.assertEqual(site_data.cross_check_registry(REAL_ROOT), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
