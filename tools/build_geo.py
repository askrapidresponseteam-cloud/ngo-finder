"""Build scraper/data/india_pins.csv and india_districts.csv from the India
Post All India Pincode Directory (as packaged by the IndiaPIN project,
https://github.com/harshvardhaniimi/IndiaPIN, data dated Dec 2021).

    python tools/build_geo.py path/to/pincode.csv
"""

import csv
import os
import sys
from collections import Counter, defaultdict

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scraper", "data")
SMALL = {"and", "of", "the"}
STATE_FIX = {
    "THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU": "Dadra and Nagar Haveli and Daman and Diu",
}
# Karnataka names as used everywhere else in this project.
KA_FIX = {"CHAMARAJANAGARA": "Chamarajanagar", "DAVANGERE": "Davanagere",
          "RAMANAGARA": "Bengaluru South (Ramanagara)"}


def title(s):
    words = s.strip().lower().split()
    return " ".join(w if (i and w in SMALL) else w.capitalize() for i, w in enumerate(words))


def main(src):
    by_pin = defaultdict(list)
    with open(src, encoding="utf-8", errors="replace") as fh:
        for r in csv.DictReader(fh):
            by_pin[r["Pincode"].strip()].append(r)
    pins, dist_points = [], defaultdict(list)
    for pin, rows in sorted(by_pin.items()):
        state_raw = Counter(r["StateName"].strip() for r in rows).most_common(1)[0][0]
        dist_raw = Counter(r["District"].strip() for r in rows).most_common(1)[0][0]
        state = STATE_FIX.get(state_raw, title(state_raw))
        district = KA_FIX.get(dist_raw) if state == "Karnataka" and dist_raw in KA_FIX else title(dist_raw)
        lats, lons = [], []
        for r in rows:
            try:
                la, lo = float(r["Latitude"]), float(r["Longitude"])
            except (TypeError, ValueError):
                continue
            if 6 <= la <= 37.5 and 68 <= lo <= 97.5:  # inside India's box
                lats.append(la)
                lons.append(lo)
        lat = round(sum(lats) / len(lats), 4) if lats else ""
        lon = round(sum(lons) / len(lons), 4) if lons else ""
        pins.append((pin, state, district, lat, lon))
        if lat != "":
            dist_points[(state, district)].append((lat, lon))
        else:
            dist_points.setdefault((state, district), [])
    with open(os.path.join(OUT, "india_pins.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["pin", "state", "district", "lat", "lon"])
        w.writerows(pins)
    with open(os.path.join(OUT, "india_districts.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["state", "district", "lat", "lon", "pins"])
        for (state, district), pts in sorted(dist_points.items()):
            n = sum(1 for p in pins if p[1] == state and p[2] == district)
            lat = round(sum(p[0] for p in pts) / len(pts), 4) if pts else ""
            lon = round(sum(p[1] for p in pts) / len(pts), 4) if pts else ""
            w.writerow([state, district, lat, lon, n])
    print(len(pins), "pins,", len(dist_points), "districts")


if __name__ == "__main__":
    main(sys.argv[1])
