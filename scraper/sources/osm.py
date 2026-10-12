"""OpenStreetMap (free, no key): animal shelters and animal or wildlife NGOs
mapped anywhere in India, via the public Overpass API."""

from .. import geo
from ..classify import is_relevant, looks_governmental
from ..models import Org

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

NAME_RE = (
    "animal|wildlife|wild life|spca|blue cross|rescue|stray|dog|cat|pet|bird|"
    "snake|reptile|turtle|elephant|tiger|conservation|nature|gau|go ?shala|"
    "goshala|gaushala|panjrapole|pinjrapole|cow|prani|karuna|compassion|"
    "voiceless|paws|people for animals|cupa|charlie"
)

# India in tiles (south, west, north, east): one query for the whole country
# times out on the public servers.
TILES = [(lat, lon, lat + 8, lon + 8) for lat in (6, 14, 22, 30) for lon in (68, 76, 84, 92)
         if not (lat == 6 and lon == 68) and not (lat == 30 and lon == 92)]

QUERY = """
[out:json][timeout:180];
(
  nwr["amenity"="animal_shelter"](%(bb)s);
  nwr["office"~"^(ngo|association|charity|foundation|non_profit)$"]["name"~"%(re)s",i](%(bb)s);
  nwr["amenity"="social_facility"]["name"~"%(re)s",i](%(bb)s);
  nwr["social_facility:for"="animals"](%(bb)s);
  nwr["amenity"="animal_breeding"]["name"~"gau|go ?shala|goshala|gaushala|cow",i](%(bb)s);
  nwr["amenity"="veterinary"]["name"~"spca|blue cross|people for animals|animal welfare|trust|society",i](%(bb)s);
  nwr["club"]["name"~"wildlife|nature|bird|conservation",i](%(bb)s);
);
out center tags;
"""


def _addr(tags):
    keys = ["addr:housenumber", "addr:street", "addr:suburb", "addr:city",
            "addr:district", "addr:postcode"]
    return ", ".join(tags[k] for k in keys if tags.get(k)) or tags.get("addr:full", "")


def parse(payload):
    """Turn an Overpass JSON payload into Org records."""
    orgs = []
    for el in payload.get("elements", []):
        tags = el.get("tags", {}) or {}
        name = tags.get("name:en") or tags.get("name") or ""
        if not name or looks_governmental(name):
            continue
        kind = tags.get("amenity") or tags.get("office") or tags.get("club") or ""
        if kind != "animal_shelter" and not is_relevant(name, tags.get("description", "")):
            continue
        lat = el.get("lat") or (el.get("center") or {}).get("lat") or ""
        lon = el.get("lon") or (el.get("center") or {}).get("lon") or ""
        if tags.get("addr:country", "IN").upper() not in ("IN", "IND", "INDIA"):
            continue
        state = geo.normalize_state(tags.get("addr:state", ""))
        near_state, near_district = geo.nearest(lat, lon)
        if not near_state and not state:
            continue  # outside India (the tiles reach into neighbouring countries)
        state = state or near_state
        phones = [p.strip() for k in ("phone", "contact:phone", "contact:mobile")
                  for p in (tags.get(k) or "").split(";") if p.strip()]
        emails = [e.strip() for k in ("email", "contact:email")
                  for e in (tags.get(k) or "").split(";") if e.strip()]
        social = [tags[k] for k in ("contact:facebook", "contact:instagram", "facebook", "instagram")
                  if tags.get(k)]
        osm_url = "https://www.openstreetmap.org/{}/{}".format(el.get("type", "node"), el.get("id", ""))
        orgs.append(Org(
            name=name,
            source="OpenStreetMap",
            confidence="medium",
            state=state,
            district=near_district if state == near_state else "",
            city=tags.get("addr:district") or tags.get("addr:city") or "",
            address=_addr(tags),
            phones=phones,
            emails=emails,
            website=tags.get("website") or tags.get("contact:website") or "",
            social=social,
            lat=str(lat),
            lon=str(lon),
            source_urls=[osm_url],
            notes=["OSM type: " + kind] if kind else [],
        ))
    return orgs


def fetch(http, log=print):
    """Every tile from the first server that answers it; a failed tile is skipped."""
    info = {"endpoint": "", "elements": 0, "errors": [], "tiles": 0}
    orgs, seen = [], set()
    for tile in TILES:
        bb = "{},{},{},{}".format(*tile)
        for url in ENDPOINTS:
            try:
                resp = http.post(url, data={"data": QUERY % {"bb": bb, "re": NAME_RE}}, timeout=240)
                if resp.status_code != 200:
                    info["errors"].append("{} {} HTTP {}".format(bb, url, resp.status_code))
                    continue
                payload = resp.json()
            except Exception as err:
                info["errors"].append("{} {} {}".format(bb, url, err))
                continue
            info["tiles"] += 1
            info["endpoint"] = url
            info["elements"] += len(payload.get("elements", []))
            for o in parse(payload):
                if o.source_urls[0] not in seen:
                    seen.add(o.source_urls[0])
                    orgs.append(o)
            break
    log("  OpenStreetMap: {} of {} map tiles answered, {} places, {} kept".format(
        info["tiles"], len(TILES), info["elements"], len(orgs)))
    return orgs, info
