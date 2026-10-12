"""Deep map sweep of one or more states, added to the live directory.

The monthly refresh asks each district from its centre and a few spread-out
points. This asks every PIN code area of the given states (one point per
4.5 km cell) for gaushalas, shelters and rescues, with local spellings, and
ADDS what it finds to the existing site data: nothing already listed changes,
other states are untouched, and new listings go through the same filters as
every build (animal-group names only, groups taken off stay off).

    python3 -m scraper.deep --states Karnataka            # needs the Ola Maps key
    python3 -m scraper.deep --states Karnataka --dry-run  # count the searches only
"""

import argparse
import json
import os
import re
import sys

from . import geo, lookup_page
from .net import Http
from .sources import ola_places

SITE_DATA = os.path.join("site", "data", "ngos.json")


def _name_key(n):
    """Same group written differently: "Duma's" and "Dumas", "Organisation" and
    "Organisations", "Iskon" and "ISKCON", a trailing "(CARE)"."""
    n = re.sub(r"\([^)]*\)", " ", n.lower()).replace("iskon", "iskcon")
    words = [w[:-1] if len(w) > 3 and w.endswith("s") else w for w in re.findall(r"[a-z0-9]+", n.replace("'", ""))]
    return " ".join(words)


def add(existing, new_records):
    """Records from new_records that are not already listed (same name and place,
    or the same map pin), in the order found."""
    seen = {(_name_key(r["n"]), r["st"], r["d"]) for r in existing}
    pins = {r["m"] for r in existing if r.get("m")}
    out = []
    for r in new_records:
        key = (_name_key(r["n"]), r["st"], r["d"])
        if key in seen or (r.get("m") and r["m"] in pins):
            continue
        seen.add(key)
        if r.get("m"):
            pins.add(r["m"])
        out.append(r)
    return out


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--states", required=True, help="comma separated, e.g. Karnataka")
    p.add_argument("--data", default=SITE_DATA)
    p.add_argument("--cap", type=int, default=90000, help="monthly Ola Maps request cap")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--save", default="", help="also save the found listings to this file")
    p.add_argument("--add-from", default="", help="no searching: add listings saved earlier with --save")
    args = p.parse_args(argv)
    states = [geo.normalize_state(x) for x in args.states.split(",") if x.strip()]
    if not all(states):
        sys.exit("unknown state in --states " + args.states)
    info = {}
    if args.add_from:
        with open(args.add_from, encoding="utf-8") as fh:
            found = json.load(fh)
    else:
        print("Deep sweep of {}: {} searches planned".format(", ".join(states), len(ola_places.plan(None, states, True))))
        if args.dry_run:
            return 0
        key = ola_places.load_key()
        if not key:
            sys.exit("no Ola Maps key (OLA_MAPS_API_KEY or ~/.config/ka-ngo-scraper/ola_maps_key)")
        orgs, info = ola_places.sweep(Http(delay=0.3), key, cap=args.cap, states=states, deep=True)
        found = [r for r in lookup_page.payload(orgs)["orgs"] if r["st"] in states]
        if args.save:
            os.makedirs(os.path.dirname(args.save) or ".", exist_ok=True)
            with open(args.save, "w", encoding="utf-8") as fh:
                json.dump(found, fh, ensure_ascii=False)
    with open(args.data, encoding="utf-8") as fh:
        data = json.load(fh)
    new = add(data["orgs"], found)
    data["orgs"] += new
    data["meta"]["count"] = len(data["orgs"])
    with open(args.data, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    print("Found {} listings that pass the filters; {} were new and are added. {} groups in all.".format(
        len(found), len(new), len(data["orgs"])))
    if info:
        print("Searches: {}; requests used this month: {}; {}".format(
            info.get("queries"), info.get("requests_this_month"), info.get("stopped") or "finished"))
    for r in new[:60]:
        print("  + {} | {}, {}".format(r["n"], r["d"], r["st"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
