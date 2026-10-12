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
                "people for animals", "wildlife rescue", "snake rescue", "cow shelter",
                "gowshala", "goushala", "gau shala", "panjrapole", "jeev daya", "jeevraksha", "pashu", "karuna",
                "dog rescue", "cat rescue", "bird", "pet rescue", "animal hospital", "nandi", "kamdhenu",
                "gopal goshala"]
# Asked around each extra point inside a district.
POINT_TERMS = ["animal", "gaushala", "rescue", "shelter", "goshala", "dog", "cow", "jeev"]
CENTRE_RADIUS = 40000  # metres
POINT_RADIUS = 15000
PINS_PER_POINT = 10    # one extra point per this many PIN codes in a district...
MAX_POINTS = 8         # ...up to this many
KA_PINS_PER_POINT, KA_MAX_POINTS = 6, 20
CACHE_DAYS = 30        # a repeated search within this many days is answered from disk, free
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


# Only animal welfare NGOs, shelters (gaushalas included) and wildlife groups belong
# in the directory. A map listing is kept only if its name says so plainly:
#   1. a word only cow shelters use (gaushala, pinjrapole, gau seva, jeev daya...), or
#   2. a known animal welfare network (SPCA, People For Animals, Blue Cross...), or
#   3. "strays" or "stray animals", or
#   4. an animal word (animal, dog, cow, wildlife...) together with either a rescue or
#      shelter word (rescue, shelter, welfare, protection...) or an NGO word (trust,
#      society, foundation, samiti, organisation...).
# "Animal Care", "Animal House", "Dog Care Centre" and the like are mostly vet clinics,
# labs, gyms and shops, so an animal word with only "care" or "centre" is not enough.
GAUSHALA_NAME = re.compile(
    r"go ?shala|go ?sala|gou ?sala|gow ?sala|goshal|gau ?shala|gaushal|gausala|gaushaala|gow ?shala|gowshal|gou ?shala|goushal|"
    r"pinjra|panjra|pinjara|panjara|\b(gau|go|gou|gow)[ -]?(seva|sewa|sadan|dham|raksha|rakshan|mata|ashram|ashrama|aashram|sanvardhan|samvardhan|sanrakshan|samrakshan|samrakshana|palan|nivas|dhaam|swarga)|gausadan|gaudham|gaumata|govansh|gosamrakshan|gorakshan|"
    r"\bjee?v ?(daya|raksha)|\bjiv ?(daya|raksha)|jivdaya|jeevdaya|prani ?(daya|mitra|seva|kalyan)", re.I)
NETWORK_NAME = re.compile(
    r"\bs\.?p\.?c\.?a\b|people'?s? for animal|\bpfa\b|blue cross|animal aid|friends of animals|wildlife sos|"
    r"animal birth control|\babc cent|compassion unlimited|\bcupa\b|voice of stray|save (the )?animals", re.I)
STRAYS_NAME = re.compile(r"\bstrays\b|stray animals?\b", re.I)
# Animal words that are also common in names of shops, housing societies and temples
# (bird, cow, pet, pashu) count only next to a rescue word, never next to "society" alone.
ANIMAL_WORD = re.compile(
    r"animal|\bstray|fauna|wild ?life|\bdogs?\b|\bcats?\b|\bbirds?\b|\bcows?\b|cattle|\bpets?\b|\bpaws?\b|canine|feline|"
    r"horses?\b|donkeys?\b|turtles?\b|elephants?\b|monkeys?\b|vultures?\b|snakes?\b|reptiles?\b|\bsarp|\bpashu(?!pat)|\bpasu\b|"
    r"\bprani\b|bovine|\bjee?v(?!an)|\bjiv(?!an)|voiceless|cruelty|humane|compassion", re.I)
STRONG_ANIMAL_WORD = re.compile(
    r"animal|\bstray|fauna|wild ?life|\bdogs?\b|\bcats?\b|\bpaws\b|canine|feline|snakes?\b|reptiles?\b|\bsarp|\bprani\b|"
    r"\bjee?v(?!an)|\bjiv(?!an)|voiceless|cruelty|humane", re.I)
RESCUE_WORD = re.compile(
    r"rescue|resque|shelter|welfare|sanctuary|haven|adoption|rehab|refuge|feeding|protection|conservation|recovery|"
    r"raksha|rakshak|rakshan|daya\b|kalyan|mitra|ashray|aashray|\bseva\b|\bsewa\b|care home|home for", re.I)
NGO_WORD = re.compile(
    r"trust\b|society|foundation|samiti|\bsangh|sanstha|organi[sz]ation|assoc|\bngo\b|federation|alliance|collective|"
    r"mission\b|network\b|forum\b|parishad|\bmandal", re.I)
# Businesses, places and addresses that happen to use those words.
NOT_A_GROUP_NAME = re.compile(
    r"\bgym\b|\bbar\b|kitchen|animal planet|design|atelier|\bmedia\b|entertainment|factory|cinema|consultan|emporium|"
    r"nutrition|\btimes\b|parking|cremat|kidney|netting|monkey catcher|control service|surgery|medicos|touris|\bvilla\b|"
    r"tailor|jewel|electronics\b|electonics|granite|crusher|makeup|beauty|boutique|garment|textile|travels|transport|"
    r"\bmats?\b|insurance|\bdr\b\.?\s|\bpvt\b|\bltd\b|(?<!un)limited|housing|co[- ]?op|graveyard|swimming|\bpool\b|credit|dugdh|utpadak|sahyog|"
    r"welfare board|deliver|\bvidya\b|seva office|pashu seva cent|\bbuilding\b|\bcomplex\b|\bexpress\b|petrochem|"
    r"birds? sanctuary|feeding point|experimental|\bpaid\b|\bbest\b|cemetery(?!.*shelter)|playground|"
    # places and businesses named after a gaushala: "GauShala More", "Goshala Bazar", "Goshala Auto Centre"
    r"\bmore\b|\bmod\b|bazar|\bpara\b|\bbasti\b|ground|community hall|anganwadi|vidyalaya|public place|talab|"
    r"muktimarg|motors|showroom|tollgate|creamery|water pump|milk|bhojnal|wellness|arogya|\bland\b|electrics|"
    r"auto cent|baked|\bvihar\b|infocity|campus|\bmela\b|\bri office", re.I)
# A street address or locality saved as the name: "1/13, Near Old Goshala", "Goshala Line".
ADDRESS_NAME = re.compile(
    r"^\d|^(gj|sh|nh)[ -]?\d|\b(room|plot|ward|house|flat|shop) ?no\b|\bbehind\b|\bline\b|\bmohalla\b|\bward\b|\bbass\b|"
    r"\bplot\b", re.I)
# Places that look like animal groups but are something else unless a gaushala.
ANIMAL_HOUSE = re.compile(r"animal house", re.I)
CARE_FOR = re.compile(r"care for (cows|animals|strays|dogs)", re.I)
FARM = re.compile(r"\bfarms?\b", re.I)
# ...and does not name something else that happens to use those words.
NOT_ANIMAL_NGO = re.compile(
    r"loans?\b|finance|layout|residency|realty|builders?\b|developers?\b|construction|architect|guest ?house|"
    r"\boyo\b|paying guest|\bhotel|resort|convention|\bbus\b|book|gift|\bcave|rock shelter|pilgrim|yatri|"
    r"training|husbandry|department|directorate|night shelter|homeless(?! animal)|women|nari|flood|cyclone|\bfire\b|"
    r"disaster|old ?age|orphan|child|\bboys\b|girls|rain basera|food shelter|dairy|\bmilk|meat|chicken|"
    r"poultry|\bfish|\bfeeds?\b|bird sanctuary|wildlife sanctuary|national park|tiger reserve|\bzoo\b|"
    r"\bforest\b|range office|museum|statue|\bsalon|grooming|kennel club|\bshow\b|cafe|\bfood\b|"
    r"\bsquad|police|facility|genetics|division|institute|university|college|research|\bmandi|"
    r"market|^near\b|\bnear (the )?(gau|go)|in ?front|\bopp\b|opposite|maidan|kingdom|health ?care|animal health\b|"
    r"restaurant|biryani|\bdhaba|bakery|sweets|petrol|pet ?(shop|store|mart|zone|food|world|planet|house)|"
    r"\bdairy|ghee|panchgavya|gobar|\bgas\b|photo|studio|tattoo|school|academy", re.I)


# Government offices and labs, vets, breeders, pet businesses and other services.
NOT_A_SHELTER = re.compile(
    r"for sale|\bsale\b|breeder|breeding|puppies|kennel|boarding|day ?care|hostel|grooming|salon|spa\b|"
    r"veterinary|\bvet\b|\bvets\b|chikitsa|aspatal|pashu ?(seva|sewa) ?kendra|bima seva|kisan seva|jan seva|rajkiya|government|\bgovt\b|"
    r"quarantine|certification|\bayog\b|commission|officer|director|husbandary|investigation|laboratory|\blab\b|"
    r"(welfare|reserve) office\b|garbhadhan|insemination|watering|"
    r"\bltd\b|\bpvt\b|private limited|\bllp\b|pharma|medical|diagnostic|ayurved|homeo|nursing|"
    r"pet ?(clinic|hospital|care center|care centre|ct\b|scan|lab)|\bclinic\b|\bhospital\b(?!.*(animal|rescue|trust|welfare|gau|go ?shala))", re.I)

def name_ok(name):
    n = name or ""
    gaushala = GAUSHALA_NAME.search(n)
    rescue = ANIMAL_WORD.search(n) and RESCUE_WORD.search(n)
    group = (gaushala or NETWORK_NAME.search(n) or STRAYS_NAME.search(n) or CARE_FOR.search(n) or rescue
             or (STRONG_ANIMAL_WORD.search(n) and NGO_WORD.search(n)))
    if not group:
        return False
    if (NOT_A_GROUP.search(n) or NOT_ANIMAL_NGO.search(n) or NOT_A_SHELTER.search(n) or NOT_A_GROUP_NAME.search(n)
            or ADDRESS_NAME.search(n)):
        return False
    if ANIMAL_HOUSE.search(n) and not gaushala:
        return False  # college and lab animal houses
    # A farm is a business unless it is also a gaushala, shelter or sanctuary.
    return bool(gaushala or rescue) or not FARM.search(n)


def ola_candidate(item):
    """A listing worth keeping: plausibly an NGO, and animal-related by name."""
    if not candidate(item["name"], item["address"], item["types"], item["closed"], require_state=False):
        return False
    if NOT_A_GROUP.search(item["name"]):
        return False
    return name_ok(item["name"])


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


def _phones_anywhere(obj, out, depth=0):
    """Every value under a key that mentions phone, however deep Ola puts it."""
    if depth > 4:
        return
    if isinstance(obj, dict):
        for k, v in obj.items():
            if "phone" in str(k).lower() and isinstance(v, (str, int)):
                t = str(v).strip()
                if t and t.lower() not in EMPTY:
                    n = norm_phone(t) or t
                    if n not in out:
                        out.append(n)
            elif isinstance(v, (dict, list)):
                _phones_anywhere(v, out, depth + 1)
    elif isinstance(obj, list):
        for v in obj:
            _phones_anywhere(v, out, depth + 1)


def parse_details(data):
    r = data.get("result") or data.get("place") or {}
    if isinstance(r, list):
        r = r[0] if r and isinstance(r[0], dict) else {}
    phones = []
    for k in ("formatted_phone_number", "international_phone_number", "phone", "phone_number"):
        if r.get(k) and str(r[k]).strip().lower() not in EMPTY:
            n = norm_phone(str(r[k])) or str(r[k]).strip()
            if n and n not in phones:
                phones.append(n)
    _phones_anywhere(r, phones)
    loc = (r.get("geometry") or {}).get("location") or {}
    site = str(r.get("website") or r.get("url_website") or "").strip()
    if site.lower() in EMPTY or " " in site or "." not in site:
        site = ""
    elif not site.lower().startswith(("http://", "https://")):
        site = "https://" + site
    return {"name": (r.get("name") or "").strip(), "phones": phones, "website": site,
            "address": (r.get("formatted_address") or "").strip(),
            "lat": loc.get("lat", ""), "lng": loc.get("lng", ""), "keys": sorted(r.keys())}


STRICT = {"on": True}  # keep results inside the radius; switched off if Ola rejects the option


_CACHE = {}


def _cache():
    if "c" not in _CACHE:
        from ..net import Cache
        _CACHE["c"] = Cache(folder=os.path.join(os.path.expanduser("~/.cache/ka-ngo-scraper"), "ola"),
                            max_age_days=CACHE_DAYS)
    return _CACHE["c"]


def search(http, key, term, usage, location="", radius=CENTRE_RADIUS):
    """Autocomplete, answered from the 30-day disk cache when the same search was made before."""
    ck = "ola|{}|{}|{}|{}".format(term, location, radius, STRICT["on"])
    hit = _cache().get(ck)
    if hit is not None:
        return hit
    items = _search(http, key, term, usage, location, radius)
    _cache().put(ck, items)
    return items


def _search(http, key, term, usage, location="", radius=CENTRE_RADIUS):
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


# Checked 12 Oct 2026 (Ola Maps check workflow): both /details and /details/advanced
# return phone and website as "NA" or empty for animal groups, so only the basic call
# is made. Add "/details/advanced" back here if Ola starts filling contact fields.
DETAIL_PATHS = ("/details",)


def details(http, key, place_id, usage, stats=None):
    """Phone and website for one place. Basic details first; when that has no phone
    or website, the advanced details (which carry contact fields) are asked too.
    Answers are kept on disk for CACHE_DAYS so a monthly run does not pay twice."""
    stats = stats if stats is not None else {}
    ck = "ola-details|" + place_id
    hit = _cache().get(ck)
    if hit is not None:
        stats["cached"] = stats.get("cached", 0) + 1
        return hit
    best = None
    for path in DETAIL_PATHS:
        usage.take()
        try:
            d = parse_details(_get(http, path, {"place_id": place_id}, key))
        except OlaError as err:
            stats[path + " error"] = stats.get(path + " error", 0) + 1
            stats.setdefault("last error", str(err)[:200])
            continue
        stats[path + " ok"] = stats.get(path + " ok", 0) + 1
        if d["phones"]:
            stats[path + " with phone"] = stats.get(path + " with phone", 0) + 1
        if best is None:
            best = d
        else:
            best["phones"] = best["phones"] or d["phones"]
            best["website"] = best["website"] or d["website"]
            best["address"] = best["address"] or d["address"]
        if best["phones"] and best["website"]:
            break
    if best is not None:
        _cache().put(ck, best)
    return best


def _notice(text):
    """A line the GitHub run page shows as a notice (and the API can read back)."""
    if os.environ.get("GITHUB_ACTIONS"):
        print("::notice::" + text.replace("\n", " "), flush=True)


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
    stats = {}
    # Details run even when the search budget ran out: what is left of it goes to phones.
    if with_details:
        log("  Ola Maps: reading details (phone, website) for {} places".format(len(places)))

        def det(p):
            if not p["id"]:
                stats["no place id"] = stats.get("no place id", 0) + 1
                return p, None
            try:
                return p, details(http, key, p["id"], usage, stats)
            except (Budget, PermissionError):
                raise
            except Exception as err:
                stats["failed"] = stats.get("failed", 0) + 1
                stats.setdefault("last error", str(err)[:200])
                return p, None
        try:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                for p, dt in pool.map(det, places):
                    # Ignore details that describe a different place.
                    if dt and dt.get("name") and token_overlap(dt["name"], p["name"]) < 0.6:
                        stats["other place"] = stats.get("other place", 0) + 1
                        dt = None
                    if dt:
                        p["phones"] = dt["phones"]
                        p["website"] = dt["website"]
                        if dt["phones"]:
                            stats["places with phone"] = stats.get("places with phone", 0) + 1
                        if dt["address"] and len(dt["address"]) > len(p["address"]):
                            p["address"] = dt["address"]
                        p["lat"] = p["lat"] or dt["lat"]
                        p["lng"] = p["lng"] or dt["lng"]
        except Budget as err:
            info["stopped"] = (info["stopped"] + "; " if info["stopped"] else "") + "details: " + str(err)
            log("  Ola Maps details stopped: {}".format(err))
    info["details"] = stats
    summary = "Ola Maps details for {} places: {}".format(
        len(places), ", ".join("{} {}".format(k, v) for k, v in sorted(stats.items())) or "none made")
    log("  " + summary)
    _notice(summary)
    if info["stopped"]:
        _notice("Ola Maps stopped early: " + info["stopped"])

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
    ("advanced details for the same place", "/details/advanced", {}, ""),
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
        if path.startswith("/details"):
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
        if path.startswith("/details"):
            d = parse_details(body)
            line = "{}: HTTP {}, {} | phones {} | website {} | fields {}".format(
                label, resp.status_code, d["name"] or "(no name)", ", ".join(d["phones"]) or "none",
                d["website"] or "none", ",".join(d["keys"]) or (resp.text[:160] or "empty"))
            r = body.get("result") or {}
            raw = "; ".join("{}={!r}".format(k, r.get(k)) for k in
                            ("formatted_phone_number", "international_phone_number", "website", "url"))
            log(line)
            _notice(line)
            _notice("{} raw contact fields: {}".format(label, raw[:400]))
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
