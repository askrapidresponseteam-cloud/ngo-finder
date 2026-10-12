"""States and districts of India, and placing an address in them.

Data: scraper/data/india_pins.csv and india_districts.csv, built by
tools/build_geo.py from the India Post All India Pincode Directory.
Karnataka keeps the project's own 31-district list (it includes Vijayanagara
and Bengaluru South, which are newer than the PIN data) and its town aliases.
"""

import csv
import difflib
import os
import re
from functools import lru_cache

from . import districts as ka

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
PIN_RE = re.compile(r"(?<!\d)([1-8]\d{2})\s?(\d{3})(?!\d)")

STATE_ALIASES = {
    "orissa": "Odisha", "pondicherry": "Puducherry", "new delhi": "Delhi", "nct of delhi": "Delhi",
    "delhi ncr": "Delhi", "chattisgarh": "Chhattisgarh", "uttaranchal": "Uttarakhand",
    "jammu & kashmir": "Jammu and Kashmir", "j&k": "Jammu and Kashmir",
    "andaman & nicobar": "Andaman and Nicobar Islands", "andaman and nicobar": "Andaman and Nicobar Islands",
    "andaman & nicobar islands": "Andaman and Nicobar Islands",
    "dadra & nagar haveli": "Dadra and Nagar Haveli and Daman and Diu",
    "dadra and nagar haveli": "Dadra and Nagar Haveli and Daman and Diu",
    "daman & diu": "Dadra and Nagar Haveli and Daman and Diu", "daman and diu": "Dadra and Nagar Haveli and Daman and Diu",
    "tamilnadu": "Tamil Nadu", "telengana": "Telangana", "west bengal": "West Bengal",
}
# Old or common names for districts outside Karnataka.
DISTRICT_ALIASES = {
    ("Haryana", "gurgaon"): "Gurugram", ("Uttar Pradesh", "allahabad"): "Prayagraj",
    ("Uttar Pradesh", "faizabad"): "Ayodhya", ("West Bengal", "calcutta"): "Kolkata",
    ("Maharashtra", "bombay"): "Mumbai", ("Tamil Nadu", "madras"): "Chennai",
    ("Telangana", "secunderabad"): "Hyderabad", ("Maharashtra", "poona"): "Pune",
    ("Kerala", "trivandrum"): "Thiruvananthapuram", ("Kerala", "cochin"): "Ernakulam",
    ("Kerala", "calicut"): "Kozhikode", ("Kerala", "trichur"): "Thrissur", ("Kerala", "palghat"): "Palakkad",
    ("Kerala", "cannanore"): "Kannur", ("Andhra Pradesh", "vizag"): "Visakhapatanam", ("Andhra Pradesh", "visakhapatnam"): "Visakhapatanam",
    ("Tamil Nadu", "trichy"): "Tiruchirappalli", ("Tamil Nadu", "thoothukudi"): "Tuticorin",
    ("Odisha", "cuttak"): "Cuttack", ("Punjab", "mohali"): "S.a.s Nagar", ("Punjab", "sas nagar"): "S.a.s Nagar",
}


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")


@lru_cache(maxsize=1)
def _tables():
    pins, by_state = {}, {}
    with open(os.path.join(HERE, "india_pins.csv"), encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            pins[r["pin"]] = (r["state"], r["district"], r["lat"], r["lon"])
    centres = {}
    with open(os.path.join(HERE, "india_districts.csv"), encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            by_state.setdefault(r["state"], []).append(r["district"])
            centres[(r["state"], r["district"])] = (r["lat"], r["lon"])
    by_state["Karnataka"] = list(ka.DISTRICTS)
    centres[("Karnataka", "Vijayanagara")] = ("15.2689", "76.3909")  # Hosapete
    return pins, by_state, centres


def states():
    return sorted(_tables()[1])


def districts_of(state):
    return sorted(_tables()[1].get(state, []))


def centre(state, district):
    return _tables()[2].get((state, district), ("", ""))


@lru_cache(maxsize=4096)
def normalize_state(name):
    if not name:
        return ""
    low = re.sub(r"\s+", " ", name.strip().lower().replace("&", " & ")).replace(" & ", " & ")
    low = re.sub(r"\s+", " ", low)
    if low in STATE_ALIASES:
        return STATE_ALIASES[low]
    for s in states():
        if s.lower() == low:
            return s
    return ""


def normalize_district(state, name):
    """Official district name within a state, or ''."""
    if not name or not state:
        return ""
    if state == "Karnataka":
        return ka.normalise(name)
    low = re.sub(r"\b(dist|district|dt)\b\.?", " ", name.lower())
    low = re.sub(r"[^a-z ]+", " ", low)
    low = re.sub(r"\s+", " ", low).strip()
    if not low:
        return ""
    if (state, low) in DISTRICT_ALIASES:
        return DISTRICT_ALIASES[(state, low)]
    options = districts_of(state)
    for d in options:
        if d.lower() == low:
            return d
    hit = difflib.get_close_matches(low, [d.lower() for d in options], n=1, cutoff=0.86)
    if hit:
        return next(d for d in options if d.lower() == hit[0])
    return ""


def from_pin(text):
    """(state, district, lat, lon) from the first Indian PIN code in text."""
    pins = _tables()[0]
    for m in PIN_RE.finditer(text or ""):
        hit = pins.get(m.group(1) + m.group(2))
        if hit:
            return hit
    return None


def _state_in(text):
    low = " " + (text or "").lower() + " "
    best = ""
    for s in states():
        if re.search(r"(?<![a-z])" + re.escape(s.lower()) + r"(?![a-z])", low) and len(s) > len(best):
            best = s
    if best:
        return best
    for alias, s in STATE_ALIASES.items():
        if re.search(r"(?<![a-z])" + re.escape(alias) + r"(?![a-z])", low):
            return s
    return ""


def locate(text, hint_state=""):
    """Best (state, district) for an address or place text."""
    text = text or ""
    hint = normalize_state(hint_state) if hint_state else ""
    pin = from_pin(text)
    if pin:
        state, district = pin[0], pin[1]
        if state == "Karnataka" and district == "Ballari" and ka.guess_from_text(text) == "Vijayanagara":
            district = "Vijayanagara"  # carved out of Ballari in 2021, after the PIN data
        if not hint or hint == state:
            return state, district
    state = _state_in(text) or hint
    if state == "Karnataka" or (not state and ka.guess_from_text(text)):
        return "Karnataka", ka.guess_from_text(text)
    if not state:
        return "", ""
    low = text.lower()
    for d in sorted(districts_of(state), key=len, reverse=True):
        if re.search(r"(?<![a-z])" + re.escape(d.lower()) + r"(?![a-z])", low):
            return state, d
    for (st, alias), d in DISTRICT_ALIASES.items():
        if st == state and re.search(r"(?<![a-z])" + re.escape(alias) + r"(?![a-z])", low):
            return state, d
    return state, ""


@lru_cache(maxsize=1)
def _pins_by_district():
    out = {}
    for state, district, lat, lon in _tables()[0].values():
        if lat and lon:
            out.setdefault((state, district), []).append((float(lat), float(lon)))
    return out


def spread_points(state, district, k):
    """Up to k PIN code locations in a district, spread out (farthest point first)."""
    pts = sorted(set(_pins_by_district().get((state, district), [])))
    if not pts or k <= 0:
        return []
    clat, clon = centre(state, district)
    chosen = []
    seed = (float(clat), float(clon)) if clat and clon else pts[0]
    dist = [(p[0] - seed[0]) ** 2 + (p[1] - seed[1]) ** 2 for p in pts]
    while len(chosen) < min(k, len(pts)):
        i = max(range(len(pts)), key=lambda j: dist[j])
        chosen.append(pts[i])
        dist = [min(dist[j], (pts[j][0] - pts[i][0]) ** 2 + (pts[j][1] - pts[i][1]) ** 2) for j in range(len(pts))]
    return chosen


def pin_count(state, district):
    return len(_pins_by_district().get((state, district), []))


def pin_location(pin):
    hit = _tables()[0].get(str(pin))
    return (hit[2], hit[3]) if hit and hit[2] else ("", "")


@lru_cache(maxsize=1)
def _pin_grid():
    grid = {}
    for state, district, lat, lon in _tables()[0].values():
        if lat and lon:
            la, lo = float(lat), float(lon)
            grid.setdefault((int(la), int(lo)), []).append((la, lo, state, district))
    return grid


@lru_cache(maxsize=1)
def _shapes():
    import json
    try:
        with open(os.path.join(HERE, "india_states_map.json"), encoding="utf-8") as fh:
            return json.load(fh).get("states", {})
    except (OSError, ValueError):
        return {}


def _inside(lat, lon, ring):
    inside, n = False, len(ring) // 2
    j = n - 1
    for i in range(n):
        xi, yi, xj, yj = ring[2 * i], ring[2 * i + 1], ring[2 * j], ring[2 * j + 1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def state_at(lat, lon):
    """States whose outline contains the point (Ladakh shares the Jammu and Kashmir
    outline). Rings are combined even-odd, so holes count; if outlines overlap, the
    smaller state wins (Delhi inside the rough edge of its neighbours)."""
    hits = []
    for name, rings in _shapes().items():
        if sum(_inside(lat, lon, r) for r in rings) % 2:
            xs = [v for r in rings for v in r[0::2]]
            ys = [v for r in rings for v in r[1::2]]
            hits.append(((max(xs) - min(xs)) * (max(ys) - min(ys)), name))
    if not hits:
        return set()
    name = min(hits)[1]
    return {name, "Ladakh"} if name == "Jammu and Kashmir" else {name}


def nearest(lat, lon):
    """(state, district) for a point: the state outline it falls in, and the
    nearest PIN code location in that state. ('', '') outside India."""
    try:
        la, lo = float(lat), float(lon)
    except (TypeError, ValueError):
        return "", ""
    allowed = state_at(la, lo)
    grid, best = _pin_grid(), None
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            for p in grid.get((int(la) + i, int(lo) + j), []):
                if allowed and p[2] not in allowed:
                    continue
                d = (p[0] - la) ** 2 + (p[1] - lo) ** 2
                if best is None or d < best[0]:
                    best = (d, p[2], p[3])
    # Outside every outline: only accept a point right next to a PIN location (coast, islands).
    if best is None or (not allowed and best[0] > 0.01) or best[0] > 1.0:
        return "", ""
    state, district = best[1], best[2]
    if state == "Karnataka" and district not in ka.DISTRICTS:
        district = ka.normalise(district) or ""
    return state, district
