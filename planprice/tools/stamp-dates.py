#!/usr/bin/env python3
"""PlanPrice post-generation date stamp.

Rewrites the site-level and compare-page "checked" dates in BUILT html so
they agree with the registry (data/site-data.json), without regenerating
the site. This is how the current tree gets fixed while a full regeneration
is out of scope.

What is stamped
---------------
All pages:
  * Footer: "Prices verified <ISO> by the PlanPrice research team"
    -> registry prices_verified_date.
compare/<slug>.html (that page's registry date from page_checked_dates):
  * "Prices checked <ISO>" / "prices checked <ISO>" (plain text, including
    the hand-written pairs' "Prices checked <ISO> by the PlanPrice research
    team" footer line and the compare sets' meta description), and
  * "prices checked <time datetime=\\"D\\">D</time>".
All non-compare pages (site date):
  * "prices checked <time datetime=\\"D\\">D</time>", and the whitelisted
    plain-text template phrasings below.

Whitelist for plain-text checked lines on listing/category pages
----------------------------------------------------------------
Derived by grepping the built tree for every distinct "checked <ISO date>"
phrasing outside compare/ and outside deals/ per-product facts, then keeping
ONLY the exact generated template phrasings:
  * "tracked, checked <date>."          (categories/* meta descriptions)
  * "promos checked <date>."           (canadian.html meta: "list prices and
                                        promos checked <date>.")
  * "verified pricing, checked <date>." (free.html meta description)
  * "prices checked <time datetime=\\"<date>\\"><date></time>"
                                        (categories/*, deals.html, free.html
                                        section-sub lines)
Anything else containing "checked <date>" is article prose with its own
check date (guides/, glossary/, calculators/, ...) and is NEVER stamped:
no blanket replacement of "checked <date>" happens anywhere in this script.
Deals pages (deals/<slug>.html) are not stamped for per-product
facts/pills — those dates are data-driven per product; the shared footer
applies there, plus (PP-DEAL-META-AUDIT-GAP) the meta description's
" Checked <date> by the PlanPrice research team." suffix when present,
stamped to the product's canonical date.

Safety
------
Fails (exit nonzero, writes NOTHING) if: the registry is missing/invalid,
the registry map disagrees with a recomputation from the data files, any
compare/*.html on disk lacks a registry page_checked_dates entry, or any
file read fails. Idempotent: a second run changes 0 files.
Supports --dry-run, which prints per-file change counts and writes nothing.

Usage: python3 tools/stamp-dates.py [--root PP] [--dry-run]
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import site_data  # noqa: E402

# Stamped-form patterns are shared with audit-literals.py via site_data
# (named-group layout: prefix / date / attr / inner / suffix).
ISO = site_data.ISO
FOOTER_RE = site_data.FOOTER_RE
TIME_RE = site_data.TIME_RE
COMPARE_PLAIN_RE = site_data.COMPARE_PLAIN_RE
WHITELIST_RES = site_data.WHITELIST_RES


def _sub_count(pattern: re.Pattern, text: str, make_repl) -> tuple:
    count = 0

    def repl(match):
        nonlocal count
        new = make_repl(match)
        if new != match.group(0):
            count += 1
        return new

    return pattern.sub(repl, text), count


def stamp_text(rel: str, text: str, registry: dict, canon: dict = None) -> tuple:
    """Return (new_text, {pattern_name: changed_count}) for one file."""
    site = site_data.site_date(registry)
    counts: dict = {}

    text, counts["footer"] = _sub_count(
        FOOTER_RE, text, lambda m: f"{m.group('prefix')}{site}{m.group('suffix')}"
    )

    if rel.startswith("deals/"):
        # deals/<slug>.html: per-product facts/pills are data-driven; the
        # shared footer (above) plus the META checked-date suffix
        # (PP-DEAL-META-AUDIT-GAP) are the stamps on these pages. The meta
        # suffix carries the product's canonical date; pages whose meta has
        # no suffix are left untouched (the form is never invented).
        if canon:
            slug = Path(rel).stem
            expected = canon.get(slug)
            if expected:
                text, counts["deal meta checked"] = _sub_count(
                    site_data.META_CHECKED_RE,
                    text,
                    lambda m: f"{m.group('prefix')}{expected}{m.group('suffix')}",
                )
        return text, counts

    if rel.startswith("compare/"):
        slug = Path(rel).stem
        page_date = site_data.registry_page_date(registry, slug)
        # Time form first, then the plain form (the plain regex cannot match
        # the time form — a "<time" follows "checked ", not a digit).
        text, counts["compare checked <time>"] = _sub_count(
            TIME_RE, text, lambda m: f'{m.group("prefix")}<time datetime="{page_date}">{page_date}</time>'
        )
        text, counts["compare Prices/prices checked"] = _sub_count(
            COMPARE_PLAIN_RE, text, lambda m: f"{m.group('prefix')}{page_date}"
        )
        return text, counts

    text, counts["prices checked <time>"] = _sub_count(
        TIME_RE, text, lambda m: f'{m.group("prefix")}<time datetime="{site}">{site}</time>'
    )
    for name, pattern in WHITELIST_RES:
        text, counts[name] = _sub_count(pattern, text, lambda m: f"{m.group('prefix')}{site}")
    return text, counts


def plan_and_stamp(root: Path, dry_run: bool) -> tuple:
    """Validate everything and read every file BEFORE writing anything.
    Returns (files_changed, total_replacements, per_file_counts)."""
    registry = site_data.load_registry(root)

    compare_pages = sorted((root / "compare").glob("*.html")) if (root / "compare").is_dir() else []
    for page in compare_pages:
        site_data.registry_page_date(registry, page.stem)  # raises if missing

    canon = site_data.canonical_product_dates(root)
    mismatches = site_data.cross_check_registry(root, registry=registry, canon=canon)
    if mismatches:
        raise site_data.SiteDataError(
            "registry page_checked_dates disagrees with recomputation from data files: "
            + "; ".join(mismatches)
        )

    planned = []  # (path, rel, new_text, counts)
    for path in sorted(root.rglob("*.html")):
        rel = path.relative_to(root).as_posix()
        try:
            original = path.read_text(encoding="utf-8")
        except OSError as exc:
            raise site_data.SiteDataError(f"cannot read {path}: {exc}") from exc
        new_text, counts = stamp_text(rel, original, registry, canon)
        if new_text != original:
            planned.append((path, rel, new_text, {k: v for k, v in counts.items() if v}))

    total_replacements = sum(sum(c.values()) for _, _, _, c in planned)
    if not dry_run:
        for path, _rel, new_text, _counts in planned:
            path.write_text(new_text, encoding="utf-8")
    return planned, total_replacements


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Stamp PlanPrice checked dates from the registry.")
    parser.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    root = Path(args.root)
    try:
        planned, total = plan_and_stamp(root, args.dry_run)
    except site_data.SiteDataError as exc:
        print(f"stamp-dates: ERROR: {exc}", file=sys.stderr)
        return 2
    mode = "dry-run: would change" if args.dry_run else "changed"
    for _path, rel, _new_text, counts in planned:
        detail = ", ".join(f"{name} x{n}" for name, n in counts.items())
        print(f"{rel}: {sum(counts.values())} replacement(s) [{detail}]")
    print(f"stamp-dates: {mode} {len(planned)} file(s), {total} replacement(s) total")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
