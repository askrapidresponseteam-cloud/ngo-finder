"""Ola Maps (Krutrim) Places API: the main map source.

Why Ola: 100,000 free requests a month with no billing needed inside the
free tier, and its terms allow showing its data alongside your own in an
app, as long as the app credits "Ola Maps" and says the data is available
under the Open Database License. The lookup site shows that credit.

A full sweep (every district, taluk town and Bengaluru locality, then
details for each shelter found) uses roughly 2,000 to 3,000 requests. A
counter on disk stops at --ola-max requests per calendar month (default
90,000) and requests are spaced to stay far below Ola's per-minute limits.

The exact JSON shape is read defensively (Google-style "predictions" or
"results", "geometry.location", etc). Run `bash run.sh --ola-check` once to
see a raw response and what was parsed from it.
"""

import os
import uuid
from concurrent.futures import ThreadPoolExecutor

from .. import districts, geo
from ..enrich import norm_phone
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


def plan(only=None, states=None):
    """(query, state, district) for the sweep. Karnataka gets the deeper
    taluk-level plan; every other district in India gets NATIONAL_QUERIES."""
    out = []
    if not states or "Karnataka" in states:
        ka_only = [d for d in (only or []) if d in districts.DISTRICTS] or None
        if not only or ka_only:
            out += [(q, "Karnataka", d) for q, d in query_plan(ka_only, DISTRICT_QUERIES, TOWN_QUERIES,
                                                                 LOCALITY_QUERIES)]
    for st in geo.states():
        if st == "Karnataka" or (states and st not in states):
            continue
        for d in geo.districts_of(st):
            if only and d not in only:
                continue
            for q in NATIONAL_QUERIES:
                out.append(("{} in {} district, {}".format(q, d, st), st, d))
    return out


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
        if r.get(k):
            n = norm_phone(str(r[k])) or str(r[k]).strip()
            if n and n not in phones:
                phones.append(n)
    loc = (r.get("geometry") or {}).get("location") or {}
    return {"name": (r.get("name") or "").strip(), "phones": phones, "website": (r.get("website") or "").strip(),
            "address": (r.get("formatted_address") or "").strip(),
            "lat": loc.get("lat", ""), "lng": loc.get("lng", "")}


def text_search(http, key, query, usage):
    usage.take()
    return parse_items(_get(http, "/textsearch", {"input": query}, key))


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
        q, st, d = item
        try:
            return q, st, d, text_search(http, key, q, usage), None
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
                    if not candidate(it["name"], it["address"], it["types"], it["closed"], require_state=False):
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
                if i % 100 == 0:
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


def check(http, key, query="animal shelter in Udupi, Karnataka", log=print):
    """One search, printed raw, to confirm the key and the response format."""
    import json
    resp = http.get(BASE + "/textsearch", params={"input": query, "api_key": key}, retries=0,
                    headers={"X-Request-Id": str(uuid.uuid4())})
    log("HTTP {}".format(resp.status_code))
    log(resp.text[:1500])
    try:
        items = parse_items(resp.json())
    except ValueError:
        items = []
    log("")
    log("Parsed {} places:".format(len(items)))
    for it in items[:10]:
        keep = candidate(it["name"], it["address"], it["types"], it["closed"], require_state=False)
        log("  [{}] {} | {} | {},{}".format("keep" if keep else "skip", it["name"], it["address"],
                                           it["lat"], it["lng"]))
    return resp.status_code == 200 and bool(items)


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
