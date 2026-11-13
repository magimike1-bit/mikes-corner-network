#!/usr/bin/env python3
"""PlanPrice article-level checked-date record (PP-ARTICLE-CHECKED-DATES).

Guide/article prose carries hand-typed per-article "Prices checked ..."
claims: real per-page facts owned by the content pipeline's editorial
process. This module is the article-level record for them:

  * extract_claims(text) parses every "Prices checked" claim in a page:
    the claim head (up to the "by Mike, editor of PlanPrice" marker, a
    source-note colon, or a parenthetical) and the dates the head states.
  * article_dates(text) returns the article's canonical date set: the
    sorted union of the dates across its claim heads.
  * The CLI writes data/article-checks.json from the current prose.
    Prose is the source of truth today; the record then guards it:
    tools/audit-literals.py recomputes the extraction on every run and
    reports any drift between prose and record.

Date forms handled (all observed in the live corpus):
  ISO            2026-10-25
  dual ISO       2026-10-05 and 2026-10-11
  triple ISO     2026-09-17, 2026-10-05, and 2026-10-11
  range          2026-09-18 to 2026-10-12  (both endpoints recorded)
  long form      October 25, 2026
  month only     October 2026              (recorded as 2026-10)
  month list     September, October 2026   (bare month inherits the year)

Secondary dates inside a claim's parenthetical or source-note detail
(e.g. "(Toast/QBO/FreshBooks 2026-10-11)") are per-vendor facts, not the
article-level claim: they stay in the preserved raw claim text but are
not part of the article's date set. An article with no "Prices checked"
claim gets an entry with empty dates and the "no-claim" flag — a date is
never invented for it.

Usage: python3 tools/article_checks.py [--root PP] [--write]
  Without --write, prints the record to stdout (dry run).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

CLAIM_RE = re.compile(r"[Pp]rices checked ")
HEAD_END_RE = re.compile(r" by Mike, editor of PlanPrice|[:\(;]")
ISO_RE = re.compile(r"\b(20\d{2})-(0[1-9]|1[0-2])-([0-3]\d)\b")
MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5,
    "june": 6, "july": 7, "august": 8, "september": 9, "october": 10,
    "november": 11, "december": 12,
}
MONTH_NAME = "|".join(MONTHS)
LONG_RE = re.compile(
    r"\b(" + MONTH_NAME + r")\s+([0-3]?\d),\s*(20\d{2})\b", re.IGNORECASE
)
MONTH_YEAR_RE = re.compile(
    r"\b(" + MONTH_NAME + r")\s+(20\d{2})\b", re.IGNORECASE
)
BARE_MONTH_RE = re.compile(r"\b(" + MONTH_NAME + r")\b", re.IGNORECASE)
YEAR_RE = re.compile(r"\b(20\d{2})\b")


def _dates_in_head(head: str) -> list[str]:
    """All dates a claim head states, as ISO day (YYYY-MM-DD) or month
    (YYYY-MM) strings, in order of appearance."""
    found: list[tuple[int, str]] = []
    consumed: list[tuple[int, int]] = []
    unaccounted: list[str] = []

    def overlaps(span: tuple[int, int]) -> bool:
        return any(span[0] < e and s < span[1] for s, e in consumed)

    for m in ISO_RE.finditer(head):
        d = f"{m.group(1)}-{m.group(2)}-{int(m.group(3)):02d}"
        found.append((m.start(), d))
        consumed.append(m.span())
    for m in LONG_RE.finditer(head):
        if overlaps(m.span()):
            continue
        mon = MONTHS[m.group(1).lower()]
        d = f"{m.group(3)}-{mon:02d}-{int(m.group(2)):02d}"
        found.append((m.start(), d))
        consumed.append(m.span())
    for m in MONTH_YEAR_RE.finditer(head):
        if overlaps(m.span()):
            continue
        mon = MONTHS[m.group(1).lower()]
        found.append((m.start(), f"{m.group(2)}-{mon:02d}"))
        consumed.append(m.span())
    # A bare month name ("September, October 2026") inherits the year of
    # the nearest year token that follows it in the head. The year list is
    # computed lazily, on the first bare month that needs it.
    years = None
    for m in BARE_MONTH_RE.finditer(head):
        if overlaps(m.span()):
            continue
        if years is None:
            years = [(mm.start(), mm.group(1)) for mm in YEAR_RE.finditer(head)]
        later = [y for pos, y in years if pos > m.start()]
        if later:
            mon = MONTHS[m.group(1).lower()]
            found.append((m.start(), f"{later[0]}-{mon:02d}"))
            consumed.append(m.span())
        else:
            # A bare month with no following year token anywhere in the
            # head cannot be dated; mark it so the claim surfaces as
            # unparsed instead of silently dropping the month.
            unaccounted.append(m.group(0))
    return [d for _, d in sorted(found)], unaccounted


def extract_claims(text: str) -> list[dict]:
    """Every 'Prices checked' claim in a page: {raw_head, dates}."""
    claims = []
    for m in CLAIM_RE.finditer(text):
        seg = text[m.start():m.start() + 400]
        # A claim never crosses a tag boundary or an attribute quote.
        cut = len(seg)
        for stop in ("<", '"'):
            i = seg.find(stop)
            if i != -1:
                cut = min(cut, i)
        seg = seg[:cut].rstrip()
        end = HEAD_END_RE.search(seg)
        head = seg[:end.start()].rstrip() if end else seg
        dates, unaccounted = _dates_in_head(head)
        claim = {"raw_head": head, "dates": dates}
        if unaccounted:
            claim["unaccounted"] = unaccounted
        claims.append(claim)
    return claims


def article_dates(text: str) -> list[str]:
    """The article's canonical date set: the sorted union of the dates
    across its claim heads."""
    return sorted({d for c in extract_claims(text) for d in c["dates"]})


def article_record(text: str) -> dict:
    """The record entry for one article's HTML."""
    claims = extract_claims(text)
    dates = sorted({d for c in claims for d in c["dates"]})
    flags = []
    if not claims:
        flags.append("no-claim")
    elif any(not c["dates"] or c.get("unaccounted") for c in claims):
        flags.append("unparsed-claim")
    return {"dates": dates, "claims": claims, "flags": flags}


def build_record(root: Path) -> dict:
    articles = {}
    for path in sorted((root / "guides").glob("*.html")):
        articles[path.stem] = article_record(path.read_text(encoding="utf-8"))
    return {
        "_meta": {
            "purpose": "Article-level checked-date record for guides/*.html "
                       "(PP-ARTICLE-CHECKED-DATES). Prose is the source of "
                       "truth; audit-literals.py flags any drift between "
                       "prose and this record.",
            "rule": "dates = the sorted union of dates stated in the head "
                    "of each 'Prices checked' claim (before any source-note "
                    "colon or parenthetical). Month-only claims record as "
                    "YYYY-MM. Articles with no claim carry empty dates and "
                    "the no-claim flag; no date is ever invented.",
            "regenerate": "python3 tools/article_checks.py --write",
        },
        "articles": articles,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    ap.add_argument("--write", action="store_true",
                    help="write data/article-checks.json (default: print)")
    args = ap.parse_args(argv)
    root = Path(args.root)
    record = build_record(root)
    payload = json.dumps(record, indent=2, ensure_ascii=False) + "\n"
    if args.write:
        out = root / "data" / "article-checks.json"
        out.write_text(payload, encoding="utf-8")
        n = len(record["articles"])
        flagged = sum(1 for a in record["articles"].values() if a["flags"])
        print(f"wrote {out} ({n} articles, {flagged} flagged)")
    else:
        sys.stdout.write(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
