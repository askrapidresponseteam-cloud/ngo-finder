"""Groups the directory's owner has taken off the directory.

scraper/data/removed.csv lists them: a phrase the group's name (or another
name, or a listed person) contains, the state, and a short neutral note. They
are left out of every build, and check_site.py fails if one comes back. Keep
the note neutral: this file is public, so it never says why.

Take them out of an existing site data file in place:
    python3 -m scraper.removed site/data/ngos.json
"""

import csv
import json
import os
import re
import sys

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "removed.csv")


def _fold(s):
    return re.sub(r"[^a-z0-9]+", " ", str(s or "").lower()).strip()


def load(path=PATH):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as fh:
        return [r for r in csv.DictReader(fh) if (r.get("name_contains") or "").strip()]


def matches(rec, rules=None):
    """rec: a site record (n, k, pp, st)."""
    rules = load() if rules is None else rules
    names = " | ".join([rec.get("n", "")] + list(rec.get("k") or []) +
                       [p.get("n", "") for p in (rec.get("pp") or [])])
    hay = " " + _fold(names) + " "
    for r in rules:
        if " " + _fold(r["name_contains"]) + " " in hay and (not r.get("state") or r["state"] == rec.get("st")):
            return r
    return None


def keep(records, rules=None):
    rules = load() if rules is None else rules
    return [r for r in records if not matches(r, rules)]


def patch_file(path):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    before = len(data["orgs"])
    data["orgs"] = keep(data["orgs"])
    data.setdefault("meta", {})["count"] = len(data["orgs"])
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    return before - len(data["orgs"])


if __name__ == "__main__":
    for p in sys.argv[1:] or [os.path.join("site", "data", "ngos.json")]:
        print("{}: {} removed".format(p, patch_file(p)))
