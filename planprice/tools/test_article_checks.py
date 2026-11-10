#!/usr/bin/env python3
"""Unit tests for tools/article_checks.py (PP-ARTICLE-CHECKED-DATES)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import article_checks as ac


def dates(html):
    return ac.article_record(html)["dates"]


CASES = [
    # footer form, single ISO
    ('<p class="fine">Prices checked 2026-10-25 by the PlanPrice research team. Always', ["2026-10-25"]),
    # dual ISO (the entry's named edge case)
    ("Prices checked 2026-10-05 and 2026-10-11 by the PlanPrice research team.", ["2026-10-05", "2026-10-11"]),
    # triple ISO
    ("Prices checked 2026-09-17, 2026-10-05, and 2026-10-11 by the PlanPrice research team.", ["2026-09-17", "2026-10-05", "2026-10-11"]),
    # range: both endpoints
    ("Prices checked 2026-09-18 to 2026-10-12.", ["2026-09-18", "2026-10-12"]),
    # long form with source-note colon: secondary ISO dates after the colon excluded
    ("Prices checked October 25, 2026: square (vendor page, checked 2026-10-25); lightspeed (checked 2026-10-20).", ["2026-10-25"]),
    # semicolon source notes: secondary dates excluded
    ("Prices checked October 23, 2026 against Cisco's page; Zoom figures as recorded on October 18, 2026.", ["2026-10-23"]),
    # parenthetical per-vendor dates excluded
    ("Prices checked 2026-10-12 (Toast/QBO/FreshBooks 2026-10-11).", ["2026-10-12"]),
    # month only
    ("Prices checked October 2026.", ["2026-10"]),
    # month list inherits the year
    ("Prices checked September, October 2026; all USD as listed.", ["2026-09", "2026-10"]),
    # meta-description form stops at the attribute quote
    ('<meta name="description" content="Guide. Prices checked 2026-10-11.">', ["2026-10-11"]),
    # post-sweep date (the entry's other named edge case)
    ("Prices checked 2026-11-03 by the PlanPrice research team.", ["2026-11-03"]),
    # no claim at all
    ("<p>Nothing about checks here.</p>", []),
    # bare month with no following year: dropped from dates, claim flagged
    ("Prices checked October 25, 2026 and September.", ["2026-10-25"]),
]

fails = 0
for html, expected in CASES:
    got = dates(html)
    if got != expected:
        fails += 1
        print(f"FAIL: {html[:60]!r} -> {got}, expected {expected}")

rec = ac.article_record("Prices checked October 25, 2026 and September.")
assert rec["flags"] == ["unparsed-claim"], rec
rec = ac.article_record("<p>No claim.</p>")
assert rec["flags"] == ["no-claim"], rec
rec = ac.article_record('<p class="fine">Prices checked 2026-10-25 by the PlanPrice research team.</p>')
assert rec["flags"] == [], rec

if fails:
    print(f"test_article_checks: {fails} case(s) FAILED")
    raise SystemExit(1)
print(f"test_article_checks: all {len(CASES) + 3} assertions passed")
