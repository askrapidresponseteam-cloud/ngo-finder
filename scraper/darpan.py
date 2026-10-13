"""Merge NGO Darpan's animal welfare NGOs into the site data, without duplicates.

Input: scraper/data/darpan_animal.csv, written by tools/darpan_fetch.py (run on
your own computer; see that file). Every row came from a data.gov.in NGO Darpan
dataset with Animal Welfare as a field of work.

A row is added only if no listed group already has that name (spelling
differences like Organisation/Organisations or a trailing bracket count as the
same) in the same state. Groups taken off the directory stay off. Each added
record links to the dataset it came from.

    python3 -m scraper.darpan [site/data/ngos.json]
"""

import csv
import json
import os
import sys

from . import geo, removed
from .deep import _name_key

HERE = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(HERE, "data", "darpan_animal.csv")
NOTE = "Registered on NGO Darpan (the government's NGO registry) with Animal Welfare as a field of work"
SOURCE = "https://www.data.gov.in/catalogs?query=darpan"


def records(path=CSV):
    if not os.path.exists(path):
        sys.exit("No {} yet. Run tools/darpan_fetch.py on your own computer first (see that file).".format(path))
    out = []
    with open(path, encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            name = (r.get("name") or "").strip()
            state = geo.normalize_state((r.get("state") or "").strip()) or (r.get("state") or "").strip()
            if len(name) < 4 or not state:
                continue
            district = geo.normalize_district(state, (r.get("district") or "").strip()) or "Unknown"
            out.append({
                "n": name, "k": [], "c": ["animal"], "st": state, "d": district,
                "a": (r.get("city") or "").strip(), "ad": "", "ra": "", "p": [], "e": [], "w": "", "s": [],
                "ac": "", "av": "", "src": ["NGO Darpan"], "sr": [SOURCE], "u": False, "m": "",
                "nt": [NOTE], "pp": [],
            })
    return out


def merge(data, rows):
    have = set()
    for o in data["orgs"]:
        have.add((_name_key(o["n"]), o["st"]))
        for k in o.get("k") or []:
            have.add((_name_key(k), o["st"]))
    added = []
    for r in rows:
        key = (_name_key(r["n"]), r["st"])
        if key in have:
            continue
        have.add(key)
        added.append(r)
    added = removed.keep(added)
    data["orgs"] += added
    data.setdefault("meta", {})["count"] = len(data["orgs"])
    return added


def main(path):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    rows = records()
    added = merge(data, rows)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    print("{}: {} rows in the CSV, {} new groups added, {} groups in all".format(
        path, len(rows), len(added), len(data["orgs"])))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join("site", "data", "ngos.json"))
