"""The organisation record and the logic for merging duplicates."""

from dataclasses import dataclass, field
from typing import List

from . import districts, geo
from .text import clean, name_key

CONFIDENCE_RANK = {"high": 3, "medium": 2, "low": 1}
BENGALURU = {"Bengaluru Urban", "Bengaluru Rural", "Bengaluru South (Ramanagara)"}


@dataclass
class Org:
    name: str
    source: str
    confidence: str = "low"
    district: str = ""
    city: str = ""
    address: str = ""
    phones: List[str] = field(default_factory=list)
    emails: List[str] = field(default_factory=list)
    website: str = ""
    social: List[str] = field(default_factory=list)
    awbi_code: str = ""
    awbi_valid_upto: str = ""
    lat: str = ""
    lon: str = ""
    source_urls: List[str] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)
    sources: List[str] = field(default_factory=list)
    snippet: str = ""
    people: List[dict] = field(default_factory=list)
    aka: List[str] = field(default_factory=list)
    categories: List[str] = field(default_factory=list)
    reg_address: str = ""
    place_id: str = ""
    state: str = ""

    def __post_init__(self):
        self.name = clean(self.name)
        self.address = clean(self.address)
        self.reg_address = clean(self.reg_address)
        self.city = clean(self.city)
        self.aka = [clean(a) for a in self.aka if clean(a) and clean(a) != self.name]
        self.state = geo.normalize_state(self.state) if self.state else ""
        known = geo.normalize_district(self.state, self.district) if (self.state and self.district) else ""
        if self.state == "Karnataka" and self.district in districts.DISTRICTS:
            known = self.district
        text = " , ".join(x for x in (self.city, self.address, self.reg_address, self.district) if x)
        if not known and self.state:
            known = geo.normalize_district(self.state, self.city)  # a district the source states wins
        if known:
            self.district = known
        else:
            st, d = geo.locate(text, self.state)
            if st and self.state and st != self.state and geo.from_pin(text):
                self.state = st  # PIN codes beat old state labels (e.g. pre-2014 Andhra Pradesh)
            self.state = self.state or st
            self.district = d if (not self.state or st == self.state or not st) else ""
            if not self.district and self.state:
                self.district = geo.normalize_district(self.state, self.city)
        if self.state == "Karnataka" and self.district == "Ballari" and \
                districts.guess_from_text(" ".join([self.address, self.reg_address, self.city])) == "Vijayanagara":
            self.district = "Vijayanagara"  # carved out of Ballari in 2021
        if self.source and self.source not in self.sources:
            self.sources.append(self.source)
        for p in self.people:
            p.setdefault("key", _person_key(p.get("name", "")))

    @property
    def key(self):
        return name_key(self.name)

    def match_keys(self):
        """Name keys usable for matching: the main name plus distinctive aliases."""
        keys = {self.key} if self.key else set()
        for a in self.aka:
            k = name_key(a)
            # A bare acronym like "CWS" is too ambiguous to merge on.
            if k and (len(k.split()) >= 2 or len(k) >= 7):
                keys.add(k)
        return keys

    def absorb(self, other):
        """Fold another record of the same organisation into this one."""
        for src in other.sources:
            if src not in self.sources:
                self.sources.append(src)
        if CONFIDENCE_RANK[other.confidence] > CONFIDENCE_RANK[self.confidence]:
            # Prefer the official spelling; keep ours as an alias.
            if self.name != other.name and self.name not in other.aka:
                self.aka.append(self.name)
            self.name, self.confidence = other.name, other.confidence
        elif other.name != self.name and other.name not in self.aka:
            self.aka.append(other.name)
        for attr in ("state", "district", "city", "address", "reg_address", "website", "awbi_code", "place_id",
                     "awbi_valid_upto", "lat", "lon", "snippet"):
            if not getattr(self, attr) and getattr(other, attr):
                setattr(self, attr, getattr(other, attr))
        if other.people:
            from .people import merge_into
            merge_into(self, other.people, limit=10)
        for attr in ("phones", "emails", "social", "source_urls", "notes", "aka", "categories"):
            mine = getattr(self, attr)
            for item in getattr(other, attr):
                if item and item not in mine and item != self.name:
                    mine.append(item)


def _person_key(name):
    import re
    low = name.lower()
    for h in ("dr.", "dr ", "col.", "capt.", "mr.", "mrs.", "ms.", "smt.", "shri ", "sri "):
        low = low.replace(h, " ")
    return re.sub(r"[^a-z]", "", low)


def _districts_compatible(a, b):
    if a.state and b.state and a.state != b.state:
        return False
    if not a.district or not b.district or a.district == b.district:
        return True
    return a.district in BENGALURU and b.district in BENGALURU


def _domain(url):
    url = (url or "").lower().split("//")[-1]
    return url.split("/")[0].replace("www.", "")


def _same(a, b):
    if a.place_id and b.place_id and a.place_id == b.place_id:
        return True
    if a.awbi_code and b.awbi_code:
        return a.awbi_code == b.awbi_code
    if not _districts_compatible(a, b):
        return False
    if a.key and a.key == b.key:
        return True
    if a.match_keys() & b.match_keys():
        return True
    da, db = _domain(a.website), _domain(b.website)
    if da and da == db and "." in da:
        return True
    return False


def _similar(a, b):
    """Fuzzy fallback: nearly the same set of name words, in a compatible area."""
    if a.awbi_code and b.awbi_code or not _districts_compatible(a, b):
        return False
    ta, tb = set(a.key.split()), set(b.key.split())
    if len(ta) < 2 or len(tb) < 2:
        return False
    return len(ta & tb) / len(ta | tb) >= 0.8


def merge(records):
    """Merge duplicates, keeping the most trustworthy version first.
    Exact name, alias, code or website matches win over fuzzy ones."""
    ordered = sorted(records, key=lambda r: -CONFIDENCE_RANK[r.confidence])
    out = []
    for rec in ordered:
        target = next((k for k in out if _same(k, rec)), None) or \
            next((k for k in out if _similar(k, rec)), None)
        if target:
            target.absorb(rec)
        else:
            out.append(rec)
    return out
