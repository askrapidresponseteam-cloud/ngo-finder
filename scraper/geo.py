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
    ("Kerala", "cannanore"): "Kannur", ("Andhra Pradesh", "vizag"): "Visakhapatnam",
    ("Tamil Nadu", "trichy"): "Tiruchirappalli", ("Tamil Nadu", "tuticorin"): "Thoothukudi",
    ("Odisha", "cuttak"): "Cuttack", ("Punjab", "mohali"): "Sas Nagar",
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


@lru_cache(maxsize=4)
def map_grid(step=0.5):
    """[lat, lon] cell centres covering India, from the PIN code locations."""
    cells = set()
    for _, _, lat, lon in _tables()[0].values():
        if not lat or not lon:
            continue
        la, lo = float(lat), float(lon)
        if 6 < la < 37.5 and 68 < lo < 97.5:
            cells.add((round(la / step), round(lo / step)))
    # Fill small gaps (cells mostly surrounded by land) so the outline reads as one shape.
    for _ in range(2):
        add = set()
        for a, b in {(a + i, b + j) for a, b in cells for i in (-1, 0, 1) for j in (-1, 0, 1)} - cells:
            if sum((a + i, b + j) in cells for i in (-1, 0, 1) for j in (-1, 0, 1)) >= 5:
                add.add((a, b))
        cells |= add
    return [[round(a * step, 2), round(b * step, 2)] for a, b in sorted(cells)]
