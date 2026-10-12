"""Build the lookup site.

Two outputs from the same files in scraper/web:
  * build_site(): a static folder for Vercel (index.html, styles.css, app.js,
    data/ngos.json, vercel.json, favicon, robots.txt)
  * write_html(): one self-contained HTML file that works offline from the
    Desktop, with the styles, script and data inlined

Everything scraped is shown with textContent in the page, never as HTML,
and only http(s), tel: and mailto: links are kept.
"""

import json
import os
import shutil
from datetime import date
from urllib.parse import urlparse

from . import geo, networks
from .classify import categories
from .dataset import SNAPSHOT_DATE
from .export import sort_key
from .sources import ola_places

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
STATIC = ["index.html", "styles.css", "app.js", "favicon.svg", "vercel.json", "robots.txt", "join.html", "admin.html"]
STATIC_DIRS = ["fed", "vendor"]  # federation pages and the self-hosted Firebase SDK


def _safe_url(u):
    u = (u or "").strip()
    return u if u.lower().startswith(("http://", "https://")) else ""


def _host(u):
    return (urlparse(u).netloc or "").replace("www.", "")


# Long dashes (figure dash to horizontal bar) are never shown; scraped names use plain hyphens.
LONG_DASHES = {c: "-" for c in (0x2012, 0x2013, 0x2014, 0x2015)}


def _tidy(value):
    if isinstance(value, str):
        return value.translate(LONG_DASHES)
    if isinstance(value, list):
        return [_tidy(v) for v in value]
    if isinstance(value, dict):
        return {k: _tidy(v) for k, v in value.items()}
    return value


def _valid_place(rec):
    st = rec["st"]
    if st != "Unknown" and st not in geo.states():
        rec["st"], rec["d"] = "Unknown", "Unknown"
    elif rec["d"] != "Unknown" and rec["d"] not in geo.districts_of(st):
        rec["d"] = "Unknown"
    return rec


def _dedupe(records):
    """Same name, state, district and AWBI code twice: keep the fuller record."""
    out = {}
    for r in records:
        key = (r["n"].lower(), r["st"], r["d"], r["ac"])
        old = out.get(key)
        if old is None or len(json.dumps(r)) > len(json.dumps(old)):
            out[key] = r
    keep = set(id(r) for r in out.values())
    return [r for r in records if id(r) in keep]


def record(org):
    cats = [c for c in (org.categories or categories(org.name, org.snippet, " ".join(org.aka)))
            if c in ("animal", "wildlife", "cattle")]
    if not cats and any(s.startswith("AWBI") for s in org.sources):
        cats = ["animal"]
    srcs = []
    for u in org.source_urls + [p.get("source", "") for p in org.people]:
        u = _safe_url(u)
        if u and u not in srcs:
            srcs.append(u)
    return {
        "n": org.name,
        "k": org.aka,
        "c": cats,
        "st": org.state or "Unknown",
        "d": org.district or "Unknown",
        "a": org.city,
        "ad": org.address,
        "ra": org.reg_address,
        "p": org.phones,
        "e": org.emails,
        "w": _safe_url(org.website),
        "s": [u for u in (_safe_url(x) for x in org.social) if u],
        "ac": org.awbi_code,
        "av": org.awbi_valid_upto,
        "src": org.sources,
        "sr": srcs,
        "u": org.confidence == "low" or not cats,
        "m": ("https://www.google.com/maps/place/?q=place_id:" + org.place_id) if org.place_id else (
            "https://www.google.com/maps?q={},{}".format(org.lat, org.lon) if org.lat and org.lon else ""),
        "nt": [n for n in org.notes if n and not n.startswith(("AWBI recognised AWO", "OSM type"))],
        "pp": [{"n": p["name"], "r": p.get("role", ""), "u": _safe_url(p.get("source", "")),
                "h": _host(p.get("source", ""))} for p in org.people],
    }


def _num(x):
    try:
        return round(float(x), 2)
    except (TypeError, ValueError):
        return None


def geography():
    """Every state with its districts as [name, lat, lon] (lat and lon may be null)."""
    out = {}
    for s in geo.states():
        out[s] = [[d] + [_num(v) for v in geo.centre(s, d)] for d in geo.districts_of(s)]
    return out


def state_shapes():
    """State outlines for the map (see tools/build_map.py), or nothing if missing."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "india_states_map.json")
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return {}
    return {"shapes": data.get("states", {}), "credit": data.get("credit", ""), "map_credit": data.get("credit", "")}


def payload(orgs, generated=None):
    data = _dedupe([networks.apply(_valid_place(_tidy(record(o)))) for o in sorted(orgs, key=sort_key)])
    data = [r for r in data if r["sr"] or r["m"] or r["ad"]]  # nothing to check it against: leave out
    # Map listings found by name alone must clearly be an animal group (see ola_places.name_ok).
    data = [r for r in data if r["src"] != ["Ola Maps"] or ola_places.name_ok(r["n"])]
    meta = {
        "date": (generated or date.today()).strftime("%d %b %Y").lstrip("0"),
        "awbi_date": SNAPSHOT_DATE,
        "count": len(data),
        "ola": any("Ola Maps" in o.sources for o in orgs),
        "states": geography(),
    }
    return {"meta": meta, "orgs": data}


def _read(name):
    with open(os.path.join(WEB, name), encoding="utf-8") as fh:
        return fh.read()


def _between(html, tag, replacement):
    start, end = "<!--{}-->".format(tag), "<!--/{}-->".format(tag)
    a, b = html.index(start), html.index(end) + len(end)
    return html[:a] + replacement + html[b:]


def build(orgs, generated=None):
    """One self-contained HTML page (styles, script and data inlined)."""
    data = payload(orgs, generated)
    data["meta"].update(state_shapes())
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    blob = blob.replace("</", "<\\/").replace("<!--", "<\\!--")
    html = _read("index.html")
    html = _between(html, "STYLES", "<style>\n" + _read("styles.css") + "</style>")
    html = _between(html, "DATA", '<script id="data" type="application/json">' + blob + "</script>")
    html = _between(html, "SCRIPT", "<script>\n" + _read("app.js").replace("</", "<\\/") + "</script>")
    html = html.replace('<link rel="icon" href="favicon.svg" type="image/svg+xml">', "")
    return html


def write_html(orgs, path, generated=None):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(build(orgs, generated))
    return path


def build_site(orgs, out_dir, generated=None):
    """Static site folder ready for `vercel deploy`."""
    copy_static(out_dir)
    with open(os.path.join(out_dir, "data", "ngos.json"), "w", encoding="utf-8") as fh:
        json.dump(payload(orgs, generated), fh, ensure_ascii=False, separators=(",", ":"))
    # The map outlines never change with the data, so they ship as their own file.
    with open(os.path.join(out_dir, "data", "india-map.json"), "w", encoding="utf-8") as fh:
        json.dump(state_shapes(), fh, separators=(",", ":"))
    return out_dir


def copy_static(out_dir):
    """Pages, styles, scripts and the federation files, without touching the data."""
    os.makedirs(os.path.join(out_dir, "data"), exist_ok=True)
    for name in STATIC:
        shutil.copyfile(os.path.join(WEB, name), os.path.join(out_dir, name))
    for name in STATIC_DIRS:
        target = os.path.join(out_dir, name)
        shutil.rmtree(target, ignore_errors=True)
        shutil.copytree(os.path.join(WEB, name), target, ignore=shutil.ignore_patterns("mock.js"))
    return out_dir
