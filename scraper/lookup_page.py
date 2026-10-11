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

from .classify import categories
from .dataset import SNAPSHOT_DATE
from .export import sort_key

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
STATIC = ["index.html", "styles.css", "app.js", "favicon.svg", "vercel.json", "robots.txt"]


def _safe_url(u):
    u = (u or "").strip()
    return u if u.lower().startswith(("http://", "https://")) else ""


def _host(u):
    return (urlparse(u).netloc or "").replace("www.", "")


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


def payload(orgs, generated=None):
    data = [record(o) for o in sorted(orgs, key=sort_key)]
    meta = {
        "date": (generated or date.today()).strftime("%d %b %Y").lstrip("0"),
        "awbi_date": SNAPSHOT_DATE,
        "count": len(data),
        "ola": any("Ola Maps" in o.sources for o in orgs),
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
    blob = json.dumps(payload(orgs, generated), ensure_ascii=False, separators=(",", ":"))
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
    os.makedirs(os.path.join(out_dir, "data"), exist_ok=True)
    for name in STATIC:
        shutil.copyfile(os.path.join(WEB, name), os.path.join(out_dir, name))
    with open(os.path.join(out_dir, "data", "ngos.json"), "w", encoding="utf-8") as fh:
        json.dump(payload(orgs, generated), fh, ensure_ascii=False, separators=(",", ":"))
    return out_dir
