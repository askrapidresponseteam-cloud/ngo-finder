"""Bring an existing site data file up to the current rules, in place:
map listings must pass the current name filter (ola_places.name_ok), network
notes are added (networks.py), and groups taken off the directory stay off
(removed.py). Run it after a data refresh that was built with older code:

    python3 -m scraper.fixups site/data/ngos.json
"""

import json
import sys

from . import networks, removed
from .sources import ola_places


def fix(data):
    before = len(data["orgs"])
    orgs = [o for o in data["orgs"] if o.get("src") != ["Ola Maps"] or ola_places.name_ok(o.get("n"))]
    dropped_names = before - len(orgs)
    orgs = removed.keep([networks.apply(o) for o in orgs])
    data["orgs"] = orgs
    data.setdefault("meta", {})["count"] = len(orgs)
    return {"map listings dropped": dropped_names, "taken off": before - dropped_names - len(orgs), "groups": len(orgs)}


def fix_file(path):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    report = fix(data)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    return report


if __name__ == "__main__":
    for p in sys.argv[1:] or ["site/data/ngos.json"]:
        print(p, fix_file(p))
