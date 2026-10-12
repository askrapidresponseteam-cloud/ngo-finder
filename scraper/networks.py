"""National networks a local group belongs to, added to its record so a search
for the network's founder or head finds every unit (for example, "Maneka
Gandhi" finds the People For Animals units). Only facts with a public source.

Patch an existing site data file in place:
    python3 -m scraper.networks site/data/ngos.json
"""

import json
import re
import sys

NETWORKS = [
    {
        "match": re.compile(r"people\s*for\s*animals|\bp\.?\s?f\.?\s?a\b", re.I),
        "note": "Part of People For Animals (PFA), the national network founded in 1992 by Maneka Gandhi, "
                "its chairperson; over 100 units across India",
        "source": "https://en.wikipedia.org/wiki/People_for_Animals",
    },
]


def apply(rec):
    """Add network notes and sources to one site record (dict with n, k, nt, sr)."""
    names = " ".join([rec.get("n", "")] + list(rec.get("k") or []))
    for net in NETWORKS:
        if net["match"].search(names):
            if net["note"] not in rec.setdefault("nt", []):
                rec["nt"].append(net["note"])
            if net["source"] not in rec.setdefault("sr", []):
                rec["sr"].append(net["source"])
    return rec


def patch_file(path):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    for rec in data["orgs"]:
        apply(rec)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    return sum(1 for r in data["orgs"] if any(n["note"] in r.get("nt", []) for n in NETWORKS))


if __name__ == "__main__":
    print("{} records linked to a national network".format(patch_file(sys.argv[1])))
