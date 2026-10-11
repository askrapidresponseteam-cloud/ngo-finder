"""Google Maps (Places API, New) as a lead finder.

Why: most small shelters and rescue trusts in Karnataka exist only as a
Google Maps listing. This sweeps every district, taluk town and Bengaluru
locality with Text Search.

Staying free: only "Pro" fields are requested (name, address, location,
types, status, Maps link), so every call counts against the 5,000 free Text
Search Pro calls a month. A usage counter on disk stops the sweep at
--places-max calls per calendar month (default 4,500).

Staying within Google's terms: Places content (names, addresses, phones)
must not be stored long term or republished; place IDs may be kept. So:
  * a lead that matches a group we already know only adds its place ID
    (used for an "Open in Google Maps" link)
  * other leads are confirmed on the open web (the group's own site,
    Facebook, Instagram or a news mention) and published from that source
  * leads that cannot be confirmed go to a "Leads to confirm" working list
    in your spreadsheet, never to the website. Re-run monthly; confirm by
    phone and add them to scraper/data/my_additions.csv to publish them.
"""

import json
import os
import re
import threading
import time
from dataclasses import dataclass, field
from typing import List

from .. import districts
from ..classify import is_relevant, looks_governmental
from ..net import CACHE_DIR

ENDPOINT = "https://places.googleapis.com/v1/places:searchText"
FIELD_MASK = ",".join([
    "places.id", "places.displayName", "places.formattedAddress", "places.location",
    "places.types", "places.primaryType", "places.businessStatus", "places.googleMapsUri",
    "nextPageToken",
])
# Rough box around Karnataka; results outside the state are dropped by address.
KARNATAKA_BOX = {"rectangle": {"low": {"latitude": 11.5, "longitude": 74.0},
                               "high": {"latitude": 18.5, "longitude": 78.6}}}
USAGE_FILE = os.path.join(CACHE_DIR, "google-places-usage.json")

DISTRICT_QUERIES = ["animal shelter", "animal rescue", "animal welfare trust", "dog shelter",
                    "animal care trust", "gaushala", "wildlife rescue", "snake rescue"]
TOWN_QUERIES = ["animal shelter", "animal rescue trust", "gaushala"]
LOCALITY_QUERIES = ["animal shelter", "animal rescue", "dog rescue"]

NGO_WORDS = re.compile(
    r"trust|foundation|society|sangha|sangh\b|samiti|samithi|seva|sewa|\bngo\b|welfare|rescue|"
    r"shelter|sanctuary|spca|s\.p\.c\.a|gaushala|goshala|gowshala|goushala|gośala|panjrapole|"
    r"pinjrapole|pinjarapole|godham|gau seva|go seva|ashram|ashraya|blue cross|"
    r"people for animals|\bpfa\b|animal care|home for|haven|refuge|network|collective|squad",
    re.I)
BAD_NAME = re.compile(
    r"clinic|pet ?shop|pets? store|pet ?zone|pet ?mart|grooming|groomer|\bspa\b|boarding|"
    r"breeder|breeding|kennels?(?!.*(trust|rescue))|aquarium|pet ?food|dairy|\bmilk|"
    r"veterinary|\bvet\b|vets\b|dr\.|doctor|pharmacy|medical|agro|feeds?\b|poultry|meat|"
    r"chicken|mutton|\bfish|forest office|range office|\brfo\b|\bzoo\b|"
    r"hospital(?!.*(trust|rescue|wildlife|people for animals|pfa|spca))", re.I)
BAD_TYPES = {"veterinary_care", "pet_store", "store", "shopping_mall", "grocery_store",
             "supermarket", "restaurant", "cafe", "lodging", "pharmacy", "hospital", "doctor",
             "farm", "car_repair"}


@dataclass
class Lead:
    place_id: str
    name: str
    address: str
    district: str
    lat: float = 0.0
    lon: float = 0.0
    maps_uri: str = ""
    types: List[str] = field(default_factory=list)
    queries: List[str] = field(default_factory=list)

    @property
    def maps_link(self):
        return "https://www.google.com/maps/place/?q=place_id:" + self.place_id


class Budget(Exception):
    pass


class Usage:
    """Calls made this calendar month, kept on disk across runs."""

    def __init__(self, cap, path=None):
        self.cap = cap
        self.path = path or USAGE_FILE  # looked up at call time, so tests can point it elsewhere
        self.month = time.strftime("%Y-%m")
        self.data = {}
        try:
            with open(self.path, encoding="utf-8") as fh:
                self.data = json.load(fh)
        except (OSError, ValueError):
            self.data = {}

    @property
    def used(self):
        return self.data.get(self.month, 0)

    _lock = threading.Lock()

    def take(self):
        with self._lock:
            self._take()

    def _take(self):
        if self.used >= self.cap:
            raise Budget("monthly cap of {} requests reached".format(self.cap))
        self.data[self.month] = self.used + 1
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            with open(self.path, "w", encoding="utf-8") as fh:
                json.dump(self.data, fh)
        except OSError:
            pass


def query_plan(only=None, district_q=None, town_q=None, locality_q=None):
    """(query text, district it is for) pairs, broadest first."""
    district_q = district_q or DISTRICT_QUERIES
    town_q = town_q or TOWN_QUERIES
    locality_q = locality_q or LOCALITY_QUERIES
    plan = []
    targets = [d for d in districts.DISTRICTS if not only or d in only]
    for d in targets:
        for q in district_q:
            plan.append(("{} in {} district, Karnataka".format(q, d.split(" (")[0]), d))
    for d in targets:
        for t in districts.TALUK_TOWNS.get(d, []):
            for q in town_q:
                plan.append(("{} in {}, Karnataka".format(q, t), d))
    if not only or "Bengaluru Urban" in only:
        for loc in districts.BENGALURU_LOCALITIES:
            for q in locality_q:
                plan.append(("{} in {}, Bengaluru".format(q, loc), "Bengaluru Urban"))
    return plan


def candidate(name, address, types=(), closed=False, require_state=True):
    """Is a map listing plausibly an animal NGO, shelter or gaushala?"""
    if not name or closed:
        return False
    if require_state and "karnataka" not in (address or "").lower():
        return False
    if BAD_NAME.search(name) or looks_governmental(name):
        return False
    if set(types or []) & BAD_TYPES and not NGO_WORDS.search(name):
        return False
    return bool(NGO_WORDS.search(name) or is_relevant(name))


def keep(place):
    """Google Places listing filter."""
    return candidate((place.get("displayName") or {}).get("text", ""), place.get("formattedAddress", ""),
                     place.get("types") or [], place.get("businessStatus") == "CLOSED_PERMANENTLY")


def to_lead(place, query, queried_district):
    name = place["displayName"]["text"]
    addr = place.get("formattedAddress", "")
    district = districts.guess_from_text(addr) or queried_district
    loc = place.get("location") or {}
    return Lead(place_id=place["id"], name=name, address=addr, district=district,
                lat=loc.get("latitude", 0.0), lon=loc.get("longitude", 0.0),
                maps_uri=place.get("googleMapsUri", ""), types=place.get("types") or [],
                queries=[query])


def search(http, key, query, usage, max_pages=3):
    """All pages of one Text Search query (each page is one billable call)."""
    places, token = [], None
    for _ in range(max_pages):
        body = {"textQuery": query, "languageCode": "en", "regionCode": "IN", "pageSize": 20,
                "locationRestriction": KARNATAKA_BOX}
        if token:
            body["pageToken"] = token
        usage.take()
        resp = http.post(ENDPOINT, json=body, delay=0.2, retries=1, headers={
            "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELD_MASK})
        if resp.status_code in (401, 403):
            raise PermissionError("Google rejected the API key ({}): {}".format(
                resp.status_code, resp.text[:300]))
        if resp.status_code != 200:
            raise RuntimeError("Places HTTP {}: {}".format(resp.status_code, resp.text[:200]))
        data = resp.json()
        places.extend(data.get("places", []))
        token = data.get("nextPageToken")
        if not token or len(data.get("places", [])) < 20:
            break
    return places


def sweep(http, key, cap=4500, only=None, log=print):
    """Run the query plan; return unique leads and a log dict."""
    usage = Usage(cap)
    leads, info = {}, {"queries": 0, "calls_before": usage.used, "stopped": "", "kept": 0}
    plan = query_plan(only)
    log("  Google Places: {} queries planned, {} of {} monthly calls already used".format(
        len(plan), usage.used, cap))
    try:
        for i, (q, d) in enumerate(plan, 1):
            for place in search(http, key, q, usage):
                if not keep(place):
                    continue
                pid = place["id"]
                if pid in leads:
                    leads[pid].queries.append(q)
                else:
                    leads[pid] = to_lead(place, q, d)
            info["queries"] = i
            if i % 50 == 0:
                log("  Google Places: {}/{} queries, {} leads".format(i, len(plan), len(leads)))
    except Budget as err:
        info["stopped"] = str(err)
        log("  Google Places stopped: {}".format(err))
    info["calls_this_month"] = usage.used
    info["kept"] = len(leads)
    return list(leads.values()), info


def load_key(explicit=""):
    if explicit:
        return explicit.strip()
    if os.environ.get("GOOGLE_MAPS_API_KEY"):
        return os.environ["GOOGLE_MAPS_API_KEY"].strip()
    path = os.path.expanduser("~/.config/ka-ngo-scraper/google_maps_key")
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return ""


def confirm(leads, known, searcher, log=print):
    """Split leads into (new confirmed Org records, unconfirmed leads).

    Known groups only gain the place ID. New ones are published only when
    the open web confirms them, using what the web source shows.
    """
    from ..models import Org, _same, _similar
    from ..text import token_overlap
    from .websearch import Blocked, is_social, site_root, skip_url

    confirmed, pending = [], []
    attached = 0
    for i, lead in enumerate(leads, 1):
        probe = Org(name=lead.name, source="probe", district=lead.district)
        match = next((k for k in known if _same(k, probe)), None) or \
            next((k for k in known if _similar(k, probe)), None)
        if match:
            if not match.place_id:
                match.place_id = lead.place_id
                attached += 1
            continue
        town = districts.SEARCH_TOWN.get(lead.district, "Karnataka")
        try:
            hits = searcher.search('"{}" {}'.format(lead.name, town))
        except Blocked:
            pending.extend(leads[i - 1:])
            log("  search engines blocked; {} leads left unconfirmed".format(len(leads) - i + 1))
            break
        found = None
        for h in hits[:8]:
            url = h.get("url", "")
            if not url.startswith("http"):
                continue
            social = is_social(url)
            if not social and skip_url(url):
                continue
            if token_overlap(lead.name, h["title"]) >= 0.6 or token_overlap(lead.name, h["snippet"]) >= 0.8:
                found = (url, social)
                break
        if not found:
            pending.append(lead)
            continue
        url, social = found
        org = Org(
            name=lead.name,
            source="Google Maps lead, confirmed on web",
            confidence="medium",
            district=lead.district,
            website="" if social else site_root(url),
            social=[url] if social else [],
            source_urls=[url],
            place_id=lead.place_id,
            notes=["Found on Google Maps; confirmed on " + (urlparse_host(url) or "the web")],
        )
        known.append(org)
        confirmed.append(org)
        if i % 25 == 0:
            log("  confirming leads: {}/{}, {} confirmed".format(i, len(leads), len(confirmed)))
    log("  Google leads: {} matched known groups, {} confirmed new, {} to confirm by phone".format(
        attached, len(confirmed), len(pending)))
    return confirmed, pending


def urlparse_host(url):
    from urllib.parse import urlparse
    return (urlparse(url).netloc or "").replace("www.", "")
