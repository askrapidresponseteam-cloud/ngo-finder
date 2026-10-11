"""Ola Maps (Krutrim) Places API: the main map source.

Why Ola: 100,000 free requests a month with no billing needed inside the
free tier, and its terms allow showing its data alongside your own in an
app, as long as the app credits "Ola Maps" and says the data is available
under the Open Database License. The lookup site shows that credit.

How it searches: Ola's text search does not answer category searches like
"animal shelter" (tested Oct 2026, zero results everywhere), but its
autocomplete finds places by name near a location. Animal groups nearly
always carry the word in their name ("Asare Animal Trust", "Sri Krishna
Gaushala"), so the sweep asks autocomplete for those words around the
centre of every district, and around spread-out PIN code locations inside
it. Each place found is then looked up once for phone and website.

All of India is roughly 25,000 to 35,000 requests. A counter on disk stops at
--ola-max requests per calendar month (default 90,000), and requests are
spaced to stay far below Ola's per-minute limits.
"""

import os
import re
import uuid
from concurrent.futures import ThreadPoolExecutor

from .. import districts, geo
from ..enrich import norm_phone
from ..classify import is_relevant
from ..models import Org
from ..text import token_overlap
from .google_places import Budget, Usage, candidate, query_plan

BASE = "https://api.olamaps.io/places/v1"
USAGE_FILE = os.path.join(os.path.expanduser("~/.cache/ka-ngo-scraper"), "ola-usage.json")
DELAY = 0.3  # seconds between requests to api.olamaps.io (about 200 a minute at most)

DISTRICT_QUERIES = ["animal shelter", "animal rescue", "animal welfare trust", "dog shelter",
                    "animal care trust", "gaushala", "goshala", "cow shelter", "wildlife rescue",
                    "snake rescue", "animal hospital trust"]
TOWN_QUERIES = ["animal shelter", "animal rescue", "dog shelter", "gaushala", "animal welfare trust"]
LOCALITY_QUERIES = ["animal shelter", "animal rescue", "dog rescue", "cat rescue"]
# Every other district in India.
NATIONAL_QUERIES = ["animal shelter", "animal rescue", "animal welfare trust", "gaushala",
                    "dog shelter", "wildlife rescue"]

ATTRIBUTION = "Ola Maps (data available under the Open Database License)"


# Asked around each district centre.
CENTRE_TERMS = ["animal trust", "animal shelter", "animal rescue", "animal welfare", "animal care",
                "dog shelter", "stray", "gaushala", "goshala", "gau seva", "pinjrapole", "spca",
                "people for animals", "wildlife rescue", "snake rescue", "cow shelter"]
# Asked around each extra point inside a district.
POINT_TERMS = ["animal", "gaushala", "rescue", "shelter"]
CENTRE_RADIUS = 40000  # metres
POINT_RADIUS = 15000
PINS_PER_POINT = 10    # one extra point per this many PIN codes in a district...
MAX_POINTS = 8         # ...up to this many
KA_PINS_PER_POINT, KA_MAX_POINTS = 6, 20
# Places named after a gaushala or shelter that are not one: stations, roads, gates, localities.
NOT_A_GROUP = re.compile(
    r"\bstation\b|\bmetro\b|railway|bus ?(stop|stand|depot)|\bphatak\b|\bmarg\b|\broad\b|\brd\b|"
    r"\bstreet\b|\blane\b|\bgali\b|\bchowk\b|\bchauraha\b|\bgate\b|\bcolony\b|\bnagar\b|\bhalt\b|"
    r"junction|\bcircle\b|\bbridge\b|flyover|\bpost office\b|\bpetrol\b|\batm\b|\bbank\b|"
    r"\bschool\b|\bcollege\b|apartment|\bpg\b|hostel|\bhotel\b|restaurant|\bdhaba\b|"
    r"\bmandir\b|\btemple\b|\bmasjid\b|\bchurch\b|\bpark\b|\bmarket\b|\bbazaar\b|\bshop\b|"
    r"\bstore\b|\bmart\b|\btraders\b|\benterprises\b", re.I)
EMPTY = {"", "na", "n/a", "none", "null", "-", "nil", "0"}
PINJRAPOLE = re.compile(r"pinjrapole|panjrapole|pinjarapole|panjarapole|gaushala|goshala|gowshala", re.I)


def _loc(state, district):
    lat, lon = geo.centre(state, district)
    return "{},{}".format(lat, lon) if lat and lon else ""


def plan(only=None, states=None):
    """(input, state, district, location, radius) for every autocomplete call."""
    out = []
    for st in geo.states():
        if states and st not in states:
            continue
        for d in geo.districts_of(st):
            if only and d not in only:
                continue
            centre = _loc(st, d)
            if centre:
                out += [(t, st, d, centre, CENTRE_RADIUS) for t in CENTRE_TERMS]
            if st == "Karnataka":
                k = min(KA_MAX_POINTS, geo.pin_count(st, d) // KA_PINS_PER_POINT)
            else:
                k = min(MAX_POINTS, geo.pin_count(st, d) // PINS_PER_POINT)
            for lat, lon in geo.spread_points(st, d, k):
                loc = "{},{}".format(lat, lon)
                out += [(t, st, d, loc, POINT_RADIUS) for t in POINT_TERMS]
    return out


def ola_candidate(item):
    """A listing worth keeping: plausibly an NGO, and animal-related by name."""
    if not candidate(item["name"], item["address"], item["types"], item["closed"], require_state=False):
        return False
    if NOT_A_GROUP.search(item["name"]):
        return False
    return is_relevant(item["name"]) or bool(PINJRAPOLE.search(item["name"]))


class OlaError(Exception):
    pass


def _get(http, path, params, key):
    params = dict(params, api_key=key)
    resp = http.get(BASE + path, params=params, delay=DELAY, retries=1,
                    headers={"X-Request-Id": str(uuid.uuid4())})
    if resp.status_code in (401, 403):
        raise PermissionError("Ola Maps rejected the API key ({}): {}".format(resp.status_code, resp.text[:300]))
    if resp.status_code == 429:
        raise OlaError("Ola Maps rate limit hit (HTTP 429)")
    if resp.status_code != 200:
        raise OlaError("Ola Maps HTTP {}: {}".format(resp.status_code, resp.text[:200]))
    try:
        data = resp.json()
    except ValueError:
        raise OlaError("Ola Maps returned something that is not JSON: " + resp.text[:200])
    status = str(data.get("status", "ok")).lower()
    if status not in ("ok", "zero_results", "success"):
        raise OlaError("Ola Maps status {}: {}".format(data.get("status"), data.get("error_message", "")))
    return data


def parse_items(data):
    """Normalise a text search response into simple dicts."""
    items = data.get("predictions") or data.get("results") or data.get("places") or []
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        sf = it.get("structured_formatting") or {}
        desc = it.get("description") or ""
        name = it.get("name") or sf.get("main_text") or desc.split(",")[0]
        address = it.get("formatted_address") or desc or sf.get("secondary_text") or ""
        loc = (it.get("geometry") or {}).get("location") or it.get("location") or {}
        out.append({
            "id": it.get("place_id") or it.get("reference") or it.get("id") or "",
            "name": (name or "").strip(),
            "address": address.strip(),
            "lat": loc.get("lat") or loc.get("latitude") or "",
            "lng": loc.get("lng") or loc.get("longitude") or "",
            "types": it.get("types") or [],
            "closed": str(it.get("business_status", "")).upper() == "CLOSED_PERMANENTLY",
        })
    return out


def parse_details(data):
    r = data.get("result") or data.get("place") or {}
    phones = []
    for k in ("formatted_phone_number", "international_phone_number", "phone", "phone_number"):
        if r.get(k) and str(r[k]).strip().lower() not in EMPTY:
            n = norm_phone(str(r[k])) or str(r[k]).strip()
            if n and n not in phones:
                phones.append(n)
    loc = (r.get("geometry") or {}).get("location") or {}
    site = (r.get("website") or "").strip()
    if site.lower() in EMPTY or " " in site or "." not in site:
        site = ""
    elif not site.lower().startswith(("http://", "https://")):
        site = "https://" + site
    return {"name": (r.get("name") or "").strip(), "phones": phones, "website": site,
            "address": (r.get("formatted_address") or "").strip(),
            "lat": loc.get("lat", ""), "lng": loc.get("lng", "")}


STRICT = {"on": True}  # keep results inside the radius; switched off if Ola rejects the option


def search(http, key, term, usage, location="", radius=CENTRE_RADIUS):
    """Autocomplete: places whose name matches term, near location.

    Ola treats location as a hint and returns matches from anywhere in India,
    so strictbounds keeps them inside the radius. If Ola answers 400 to that
    option, the search is repeated without it and it stays off for the run.
    """
    usage.take()
    params = {"input": term}
    if location:
        params.update(location=location, radius=str(radius))
        if STRICT["on"]:
            try:
                return parse_items(_get(http, "/autocomplete", dict(params, strictbounds="true"), key))
            except OlaError as err:
                if "400" not in str(err):
                    raise
                STRICT["on"] = False
                usage.take()
    return parse_items(_get(http, "/autocomplete", params, key))


def details(http, key, place_id, usage):
    usage.take()
    return parse_details(_get(http, "/details", {"place_id": place_id}, key))


def sweep(http, key, cap=90000, only=None, log=print, workers=3, with_details=True, states=None):
    """Search every query in the plan; return Org records for shelters found."""
    usage = Usage(cap, path=USAGE_FILE)
    queries = plan(only, states)
    log("  Ola Maps: {} searches planned, {} of {} monthly requests already used".format(
        len(queries), usage.used, cap))
    found, info = {}, {"queries": 0, "stopped": "", "errors": 0}

    def run(item):
        q, st, d, loc, radius = item
        try:
            return q, st, d, search(http, key, q, usage, loc, radius), None
        except (Budget, PermissionError):
            raise
        except Exception as err:
            return q, st, d, [], err

    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for i, (q, st, d, items, err) in enumerate(pool.map(run, queries), 1):
                if err:
                    info["errors"] += 1
                for it in items:
                    if not ola_candidate(it):
                        continue
                    where_st, where_d = geo.locate(it["address"], st)
                    if where_st and where_st != st:
                        continue  # a result from another state; that state's own searches cover it
                    key_ = it["id"] or (it["name"].lower(), it["address"].lower())
                    if key_ not in found:
                        it["state"] = st
                        it["district"] = where_d or d
                        it["query"] = q
                        found[key_] = it
                info["queries"] = i
                if i % 500 == 0:
                    log("  Ola Maps: {}/{} searches, {} shelters found".format(i, len(queries), len(found)))
    except Budget as err:
        info["stopped"] = str(err)
        log("  Ola Maps stopped: {}".format(err))

    places = list(found.values())
    if with_details and not info["stopped"]:
        log("  Ola Maps: reading details (phone, website) for {} places".format(len(places)))

        def det(p):
            if not p["id"]:
                return p, None
            try:
                return p, details(http, key, p["id"], usage)
            except (Budget, PermissionError):
                raise
            except Exception:
                return p, None
        try:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                for p, dt in pool.map(det, places):
                    # Ignore details that describe a different place.
                    if dt and dt.get("name") and token_overlap(dt["name"], p["name"]) < 0.6:
                        dt = None
                    if dt:
                        p["phones"] = dt["phones"]
                        p["website"] = dt["website"]
                        if dt["address"] and len(dt["address"]) > len(p["address"]):
                            p["address"] = dt["address"]
                        p["lat"] = p["lat"] or dt["lat"]
                        p["lng"] = p["lng"] or dt["lng"]
        except Budget as err:
            info["stopped"] = str(err)
            log("  Ola Maps details stopped: {}".format(err))

    orgs = [to_org(p) for p in places]
    info.update(found=len(orgs), requests_this_month=usage.used)
    log("  Ola Maps: {} shelters and groups found; {} requests used this month".format(len(orgs), usage.used))
    return orgs, info


def to_org(p):
    website = p.get("website", "")
    if website and not website.lower().startswith(("http://", "https://")):
        website = "https://" + website
    social = []
    if any(s in website.lower() for s in ("facebook.com", "instagram.com")):
        social, website = [website], ""
    return Org(
        name=p["name"],
        source="Ola Maps",
        confidence="medium",
        state=p.get("state", "Karnataka"),
        district=p["district"],
        address=p["address"],
        phones=p.get("phones", []),
        website=website,
        social=social,
        lat=str(p["lat"]) if p["lat"] != "" else "",
        lon=str(p["lng"]) if p["lng"] != "" else "",
        notes=["Listed on Ola Maps"],
    )


CHECKS = [
    # (what it tests, path, params, where: a district in Karnataka or a PIN code)
    ("sweep style, Dakshina Kannada", "/autocomplete",
     {"input": "animal trust", "radius": "40000", "strictbounds": "true"}, "Dakshina Kannada"),
    ("sweep style, near Surathkal", "/autocomplete",
     {"input": "animal", "radius": "15000", "strictbounds": "true"}, "575019"),
    ("sweep style, near Mudar (Karkala)", "/autocomplete",
     {"input": "animal", "radius": "15000", "strictbounds": "true"}, "574122"),
    ("sweep style, gaushala in Udupi", "/autocomplete",
     {"input": "gaushala", "radius": "40000", "strictbounds": "true"}, "Udupi"),
    ("same without strictbounds", "/autocomplete", {"input": "gaushala", "radius": "40000"}, "Udupi"),
    ("details for the first place found", "/details", {}, ""),
]


def check(http, key, log=print):
    """A few test calls (6 requests), printed in short, to confirm the key and
    that the sweep's search style finds animal groups. True if it does."""
    first_id, found = "", 0
    for n, (label, path, params, where) in enumerate(CHECKS):
        params = dict(params, api_key=key)
        if where.isdigit():
            lat, lon = geo.pin_location(where)
            params["location"] = "{},{}".format(lat, lon)
        elif where:
            params["location"] = _loc("Karnataka", where)
        if path == "/details":
            if not first_id:
                log("{}: skipped (nothing found to look up)".format(label))
                continue
            params["place_id"] = first_id
        try:
            resp = http.get(BASE + path, params=params, retries=0, headers={"X-Request-Id": str(uuid.uuid4())})
        except Exception as err:
            log("{}: request failed ({})".format(label, err))
            continue
        if resp.status_code in (401, 403):
            log("HTTP {}: Ola Maps rejected the key. {}".format(resp.status_code, resp.text[:300]))
            return False
        try:
            body = resp.json()
        except ValueError:
            body = {}
        if path == "/details":
            d = parse_details(body)
            log("{}: HTTP {}, {} | phones {} | website {}".format(label, resp.status_code, d["name"] or "(no name)",
                                                                ", ".join(d["phones"]) or "none", d["website"] or "none"))
            continue
        items = parse_items(body)
        kept = [it for it in items if ola_candidate(it)]
        if path == "/autocomplete":
            found += len(kept)
            if kept and not first_id:
                first_id = kept[0]["id"]
        log("{}: HTTP {}, {} places, {} kept {}".format(label, resp.status_code, len(items), len(kept),
                                                       "" if items else "(" + (resp.text[:160] or "empty") + ")"))
        for it in items[:5]:
            log("    [{}] {} | {}".format("keep" if ola_candidate(it) else "skip", it["name"], it["address"][:80]))
    return found > 0


def load_key(explicit=""):
    if explicit:
        return explicit.strip()
    if os.environ.get("OLA_MAPS_API_KEY"):
        return os.environ["OLA_MAPS_API_KEY"].strip()
    try:
        with open(os.path.expanduser("~/.config/ka-ngo-scraper/ola_maps_key"), encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return ""
