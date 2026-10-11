"""OpenStreetMap (free, no key): animal shelters and animal or wildlife NGOs
mapped inside Karnataka, via the public Overpass API."""

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

QUERY = """
[out:json][timeout:180];
area["ISO3166-2"="IN-KA"][admin_level=4]->.ka;
(
  nwr["amenity"="animal_shelter"](area.ka);
  nwr["office"~"^(ngo|association|charity|foundation|non_profit)$"]["name"~"%(re)s",i](area.ka);
  nwr["amenity"="social_facility"]["name"~"%(re)s",i](area.ka);
  nwr["social_facility:for"="animals"](area.ka);
  nwr["amenity"="animal_breeding"]["name"~"gau|go ?shala|goshala|gaushala|cow",i](area.ka);
  nwr["club"]["name"~"wildlife|nature|bird|conservation",i](area.ka);
);
out center tags;
""" % {"re": NAME_RE}


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
    info = {"endpoint": "", "elements": 0, "errors": []}
    for url in ENDPOINTS:
        try:
            resp = http.post(url, data={"data": QUERY}, timeout=240)
            if resp.status_code != 200:
                info["errors"].append("{} HTTP {}".format(url, resp.status_code))
                continue
            payload = resp.json()
            orgs = parse(payload)
            info.update(endpoint=url, elements=len(payload.get("elements", [])))
            log("  OpenStreetMap: {} places, {} kept".format(info["elements"], len(orgs)))
            return orgs, info
        except Exception as err:
            info["errors"].append("{} {}".format(url, err))
    log("  OpenStreetMap: no endpoint answered ({})".format("; ".join(info["errors"])))
    return [], info
