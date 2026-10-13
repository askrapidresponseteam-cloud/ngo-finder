"""Download animal welfare NGOs from the government's open-data portal.

data.gov.in publishes NGO Darpan's registry as open datasets (one per state,
"District-, Registration-city- and Field-of-work-wise Names of NGOs..."). The
portal answers only from India and needs a free API key, so this runs on your
own computer, not in the cloud:

  1. Get a key (2 minutes, free): https://data.gov.in -> Sign up -> My Account
     -> Generate API key.
  2. python3 tools/darpan_fetch.py YOUR_KEY

It finds every NGO Darpan dataset in the catalog, downloads the rows whose
field of work says Animal Welfare (not animal husbandry or fisheries, which
are livestock economics), and writes them to scraper/data/darpan_animal.csv
with the dataset each row came from. Then, from the repo:

  python3 -m scraper.darpan            # merge into the live site data

Standard library only; no pip installs.
"""

import csv
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

BASE = "https://api.data.gov.in"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "scraper", "data", "darpan_animal.csv")
ANIMAL = re.compile(r"animal welfare|wildlife", re.I)
NOT_ANIMAL = re.compile(r"husbandry|dairy|fisheries", re.I)


def get(path, **params):
    url = BASE + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "kindaura-directory/1.0 (animal NGO directory)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def catalog(key):
    """Every NGO Darpan resource in the catalog (title, resource id)."""
    found, offset = [], 0
    while True:
        d = get("/lists", format="json", notfilters="[source]visualize.data.gov.in",
                filters="[title]darpan", offset=offset, limit=100, **{"api-key": key})
        rows = d.get("records") or []
        for r in rows:
            rid = r.get("index_name") or r.get("id") or ""
            title = (r.get("title") or "").strip()
            if rid and ("ngo" in title.lower() or "darpan" in title.lower()):
                found.append((rid, title))
        offset += len(rows)
        if not rows or offset >= int(d.get("total") or 0):
            break
    return found


FIELD_HINTS = ("field", "sector", "work")
NAME_HINTS = ("name", "ngo")
PLACE_HINTS = {"state": ("state",), "district": ("district",), "city": ("city", "registration_city", "town")}


def pick(fields, hints):
    for f in fields:
        low = f.lower()
        if any(h in low for h in hints):
            return f
    return ""


def rows_of(key, rid, title):
    """Animal-welfare rows of one resource: (name, state, district, city, field, rid, title)."""
    out, offset = [], 0
    fields = None
    while True:
        try:
            d = get("/resource/" + rid, format="json", offset=offset, limit=1000, **{"api-key": key})
        except Exception as err:
            print("    skipped ({})".format(err))
            return out
        recs = d.get("records") or []
        if fields is None:
            fields = [f.get("id") or f.get("name") for f in (d.get("field") or [])]
            fname, ffield = pick(fields, NAME_HINTS), pick(fields, FIELD_HINTS)
            fplace = {k: pick(fields, v) for k, v in PLACE_HINTS.items()}
            if not fname or not ffield:
                print("    no name/field columns in {} -> skipped (columns: {})".format(rid, fields))
                return out
        for r in recs:
            work = str(r.get(ffield) or "")
            if not ANIMAL.search(work):
                continue
            if NOT_ANIMAL.search(work) and not ANIMAL.search(NOT_ANIMAL.sub("", work)):
                continue
            out.append({
                "name": str(r.get(fname) or "").strip(),
                "state": str(r.get(fplace["state"]) or "").strip() if fplace["state"] else "",
                "district": str(r.get(fplace["district"]) or "").strip() if fplace["district"] else "",
                "city": str(r.get(fplace["city"]) or "").strip() if fplace["city"] else "",
                "field_of_work": work.strip(),
                "resource": rid, "dataset": title,
            })
        offset += len(recs)
        total = int(d.get("total") or 0)
        if not recs or (total and offset >= total):
            break
        time.sleep(0.3)
    return out


def main():
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        sys.exit(__doc__)
    key = sys.argv[1].strip()
    print("Looking for NGO Darpan datasets in the data.gov.in catalog...")
    cat = catalog(key)
    print("Found {} datasets.".format(len(cat)))
    all_rows = []
    for rid, title in cat:
        print("  " + title[:100])
        rows = rows_of(key, rid, title)
        print("    {} animal welfare rows".format(len(rows)))
        all_rows += rows
    seen, unique = set(), []
    for r in all_rows:
        k = (r["name"].lower(), r["state"].lower(), r["district"].lower())
        if r["name"] and k not in seen:
            seen.add(k)
            unique.append(r)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["name", "state", "district", "city", "field_of_work", "resource", "dataset"])
        w.writeheader()
        w.writerows(unique)
    print("\nWrote {} unique groups to {}".format(len(unique), OUT))
    print("Next: python3 -m scraper.darpan")


if __name__ == "__main__":
    main()
