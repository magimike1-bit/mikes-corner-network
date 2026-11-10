"""PlanPrice site-data registry helpers — the single shared source for the
checked-date rule.

Both stamp-dates.py and audit-literals.py import this module, so the registry
(site-data.json) and the tools can never disagree about how a page date is
derived.

The rule, in one place:
  * A product's canonical last_verified is the latest non-null value across
    data/sweeps/*.json; where a product still has no value there, the field
    ``verified`` from data/compare-vendors.json is the fallback.
  * A compare page's date is the MINIMUM of its member products' canonical
    dates — a comparison is only as fresh as its stalest side. If a member
    has no date anywhere, the page is flagged ``partial`` and its date is
    the minimum of the members that do have one.
  * The site-wide date is registry variable ``prices_verified_date``.

``compute_page_checked_dates(root)`` recomputes the compare-page map from
the data files; ``cross_check_registry(root)`` compares it against the map
written into site-data.json and reports every mismatch (a mismatch is an
error: stamp-dates.py fails on it, audit-literals.py reports it).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Canonical stamped-form patterns, shared by stamp-dates.py and
# audit-literals.py (the single layout both tools use, named groups so
# each tool reads the parts it needs: stamp uses prefix/suffix, audit
# uses date/attr/inner). Grouping only — these match exactly what the
# two tools' former private copies matched.
ISO = r"\d{4}-\d{2}-\d{2}"
FOOTER_RE = re.compile(
    r"(?P<prefix>Prices verified )(?P<date>" + ISO + r")(?P<suffix> by the PlanPrice research team)"
)
TIME_RE = re.compile(
    r"(?P<prefix>[Pp]rices checked )<time datetime=\"(?P<attr>" + ISO + r")\">(?P<inner>" + ISO + r")</time>"
)
COMPARE_PLAIN_RE = re.compile(r"(?P<prefix>[Pp]rices checked )(?P<date>" + ISO + r")")
# Deal-page META form (PP-DEAL-META-AUDIT-GAP): the " Checked <date> by the
# PlanPrice research team." suffix inside a deal page's meta description
# (extracted into products.json meta_description by PP-GEN-DRIFT; the suffix
# is present on 37 of 49 deal pages and must never be invented for the 12
# that do not carry it — both tools only judge/rewrite the form when it is
# present, and its date is the product's canonical date, not the site date).
META_CHECKED_RE = re.compile(
    r"(?P<prefix> Checked )(?P<date>" + ISO + r")(?P<suffix> by the PlanPrice research team\.)"
)
# Whitelisted plain-text template phrasings for non-compare pages
# (see stamp-dates.py header for the derivation).
WHITELIST_RES = [
    ("tracked, checked", re.compile(r"(?P<prefix>tracked, checked )(?P<date>" + ISO + r")")),
    ("promos checked", re.compile(r"(?P<prefix>promos checked )(?P<date>" + ISO + r")")),
    (
        "verified pricing, checked",
        re.compile(r"(?P<prefix>verified pricing, checked )(?P<date>" + ISO + r")"),
    ),
]

BASIS = "min(member last_verified); chain: data/sweeps/*.json then data/compare-vendors.json"
SITE_VARIABLE = "prices_verified_date"


class SiteDataError(Exception):
    """Registry or source data is missing/invalid. Always fail loudly."""


def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SiteDataError(f"missing data file: {path}") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise SiteDataError(f"cannot read/parse {path}: {exc}") from exc


def data_dir(root: Path) -> Path:
    return Path(root) / "data"


def registry_path(root: Path) -> Path:
    return data_dir(root) / "site-data.json"


def load_registry(root: Path) -> dict:
    path = registry_path(root)
    registry = _read_json(path)
    if not isinstance(registry, dict):
        raise SiteDataError(f"{path}: registry is not a JSON object")
    variables = registry.get("variables")
    if not isinstance(variables, dict) or SITE_VARIABLE not in variables:
        raise SiteDataError(f"{path}: missing variable {SITE_VARIABLE!r}")
    site_value = (variables.get(SITE_VARIABLE) or {}).get("value")
    if not isinstance(site_value, str) or not DATE_RE.match(site_value):
        raise SiteDataError(
            f"{path}: variable {SITE_VARIABLE!r} has no valid ISO date value: {site_value!r}"
        )
    if not isinstance(registry.get("page_checked_dates"), dict):
        raise SiteDataError(f"{path}: missing/invalid page_checked_dates map")
    return registry


def site_date(registry: dict) -> str:
    return registry["variables"][SITE_VARIABLE]["value"]


def canonical_product_dates(root: Path) -> dict:
    """slug -> latest non-null last_verified across sweeps, else the
    compare-vendors ``verified`` fallback. Slugs with no record anywhere
    are simply absent from the returned map."""
    root = Path(root)
    canon: dict[str, str] = {}
    sweeps_dir = data_dir(root) / "sweeps"
    if not sweeps_dir.is_dir():
        raise SiteDataError(f"missing sweeps directory: {sweeps_dir}")
    sweep_files = sorted(sweeps_dir.glob("*.json"))
    if not sweep_files:
        raise SiteDataError(f"no sweep files under {sweeps_dir}")
    for sweep_file in sweep_files:
        sweep = _read_json(sweep_file)
        products = sweep.get("products")
        if not isinstance(products, list):
            raise SiteDataError(f"{sweep_file}: missing products list")
        for entry in products:
            slug = entry.get("slug")
            verified = entry.get("last_verified")
            if slug and verified:
                if not DATE_RE.match(str(verified)):
                    raise SiteDataError(
                        f"{sweep_file}: product {slug!r} has non-ISO last_verified {verified!r}"
                    )
                if slug not in canon or verified > canon[slug]:
                    canon[slug] = verified
    vendors_path = data_dir(root) / "compare-vendors.json"
    if vendors_path.exists():
        vendors = _read_json(vendors_path)
        if not isinstance(vendors, list):
            raise SiteDataError(f"{vendors_path}: expected a JSON list")
        for entry in vendors:
            slug = entry.get("slug")
            verified = entry.get("verified")
            if slug and verified and slug not in canon:
                if not DATE_RE.match(str(verified)):
                    raise SiteDataError(
                        f"{vendors_path}: product {slug!r} has non-ISO verified {verified!r}"
                    )
                canon[slug] = verified
    return canon


# Filename/member mismatches: the page slug is historical and does not
# split into real product slugs. Membership here is explicit and wins
# over the "-vs-" filename split.
#   capsule-vs-pipedrive: the product's slug is "capsule-crm"
#   (data/products.json, deals/capsule-crm.html); the page predates the
#   "-crm" slug suffix. Both members are verified, so the page is NOT
#   partial: capsule-crm 2026-10-25, pipedrive 2026-10-10 -> min 2026-10-10.
MEMBER_OVERRIDES = {
    "capsule-vs-pipedrive": ["capsule-crm", "pipedrive"],
}


def compare_members(root: Path) -> list:
    """[(compare_slug, [member_product_slug, ...]), ...] for every compare
    page: the explicit sets from data/compare.json first, then every other
    compare/*.html on disk, whose membership is the two product slugs
    around "-vs-" in the filename (unless MEMBER_OVERRIDES names them)."""
    root = Path(root)
    members: list = []
    seen: set = set()
    compare_cfg_path = data_dir(root) / "compare.json"
    if compare_cfg_path.exists():
        cfg = _read_json(compare_cfg_path)
        for compare_set in cfg.get("sets") or []:
            slug = compare_set.get("slug")
            products = compare_set.get("products")
            if not slug or not isinstance(products, list) or not products:
                raise SiteDataError(f"{compare_cfg_path}: invalid compare set {compare_set!r}")
            members.append((slug, list(products)))
            seen.add(slug)
    compare_dir = root / "compare"
    if compare_dir.is_dir():
        for page in sorted(compare_dir.glob("*.html")):
            slug = page.stem
            if slug in seen:
                continue
            if slug in MEMBER_OVERRIDES:
                members.append((slug, list(MEMBER_OVERRIDES[slug])))
                seen.add(slug)
                continue
            parts = slug.split("-vs-")
            if len(parts) != 2 or not all(parts):
                raise SiteDataError(
                    f"{page}: compare page slug {slug!r} is neither a compare.json set "
                    "nor a '<a>-vs-<b>' pair"
                )
            members.append((slug, parts))
            seen.add(slug)
    return members


def compute_page_checked_dates(root: Path, canon: dict = None) -> dict:
    """Recompute the page_checked_dates map from the data files.

    ``canon`` optionally supplies a pre-computed canonical_product_dates
    map; when omitted it is computed from the data files as before."""
    root = Path(root)
    if canon is None:
        canon = canonical_product_dates(root)
    result: dict = {}
    for slug, members in compare_members(root):
        dates = {member: canon.get(member) for member in members}
        present = [d for d in dates.values() if d]
        if not present:
            raise SiteDataError(
                f"compare/{slug}.html: no member product has a verified date anywhere "
                "(data/sweeps/*.json or data/compare-vendors.json)"
            )
        entry = {
            "date": min(present),
            "members": list(members),
            "basis": BASIS,
        }
        missing = [member for member, d in dates.items() if not d]
        if missing:
            entry["partial"] = True
            entry["note"] = (
                "Partial: "
                + ", ".join(missing)
                + " unverified (no record in data/sweeps/*.json or "
                "data/compare-vendors.json); date is the minimum of the "
                "verified member(s): "
                + ", ".join(sorted(set(present)))
                + "."
            )
        result[f"compare/{slug}.html"] = entry
    return result


def registry_page_date(registry: dict, slug: str) -> str:
    entry = registry["page_checked_dates"].get(f"compare/{slug}.html")
    if not entry or not entry.get("date"):
        raise SiteDataError(
            f"site-data.json: no page_checked_dates entry for compare slug {slug!r}"
        )
    return entry["date"]


def cross_check_registry(root: Path, registry: dict = None, canon: dict = None) -> list:
    """Return a list of mismatch strings between the registry's written
    page_checked_dates map and a fresh recomputation from the data files.
    An empty list means the registry and the data agree.

    ``registry`` and ``canon`` optionally supply a pre-loaded registry
    and a pre-computed canonical_product_dates map, so callers that
    already loaded them do not pay for a second load/recompute; when
    omitted both are derived from ``root`` exactly as before."""
    root = Path(root)
    if registry is None:
        registry = load_registry(root)
    written = registry["page_checked_dates"]
    try:
        computed = compute_page_checked_dates(root, canon=canon)
    except SiteDataError as exc:
        return [f"recompute failed: {exc}"]
    mismatches: list = []
    for key in sorted(set(written) | set(computed)):
        if key not in written:
            mismatches.append(f"{key}: missing from site-data.json page_checked_dates")
            continue
        if key not in computed:
            mismatches.append(f"{key}: in site-data.json but not recomputable from data files")
            continue
        w, c = written[key], computed[key]
        for field in ("date", "members"):
            if w.get(field) != c.get(field):
                mismatches.append(
                    f"{key}: site-data.json {field}={w.get(field)!r} != recomputed {c.get(field)!r}"
                )
        if bool(w.get("partial")) != bool(c.get("partial")):
            mismatches.append(
                f"{key}: site-data.json partial={w.get('partial')!r} != recomputed {c.get('partial')!r}"
            )
    return mismatches
